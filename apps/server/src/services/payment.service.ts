/**
 * FRIGAT — Cryptomus Payment Service
 *
 * Deposits (invoices) and withdrawals (payouts) against the Cryptomus API.
 *
 * Two rules shape everything here:
 *
 *   1. This service never mutates a balance by hand. Credits and debits go
 *      through ledger.service inside the same $transaction that moves the
 *      gateway row, so a wallet balance can never disagree with the ledger.
 *
 *   2. Webhooks are untrusted input. Cryptomus retries until it receives a 200,
 *      and anyone can POST to a public URL — so every webhook is signature-
 *      checked, and crediting is guarded on `Payment.transactionId IS NULL`.
 *      A replay of a genuine webhook is a no-op, not a second credit.
 *
 * Signing (both directions) is MD5 over base64(body) + apiKey. The payout
 * endpoints are signed with a *different* key to the payment ones.
 */

import { createHash, timingSafeEqual } from 'crypto';
import { Prisma, TransactionType, type CryptoPaymentStatus } from '@prisma/client';

import { config } from '../config';
import {
  NOWPAYMENTS_PROVIDER,
  createNowPayment,
  createPayout,
  isPayoutConfigured,
  mapNowPaymentsStatus,
  networkLabelFor,
  payCurrencyFor,
} from './nowpayments.service';
import { prisma } from '../config/prisma';
import {
  requestWithdrawal,
  rejectWithdrawal,
  AccountFrozenError,
  WalletNotFoundError,
} from './ledger.service';

const D = Prisma.Decimal;

export const SUPPORTED_CURRENCIES = ['USDT', 'BTC', 'ETH', 'LTC'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

const DEFAULT_NETWORK: Record<SupportedCurrency, string | undefined> = {
  USDT: 'tron',
  BTC: undefined,
  ETH: undefined,
  LTC: undefined,
};

const LEDGER_CURRENCY = 'USD';

/** Marks a withdrawal an operator has to send by hand. */
export const MANUAL_PROVIDER = 'MANUAL_ADMIN';

export function isSupportedCurrency(value: unknown): value is SupportedCurrency {
  return (
    typeof value === 'string' &&
    (SUPPORTED_CURRENCIES as readonly string[]).includes(value)
  );
}

export class PaymentConfigError extends Error {
  constructor() {
    super('Cryptomus credentials are not configured');
    this.name = 'PaymentConfigError';
  }
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

export class InvalidSignatureError extends Error {
  constructor() {
    super('Webhook signature verification failed');
    this.name = 'InvalidSignatureError';
  }
}

export {
  AccountFrozenError,
  InsufficientFundsError,
  WalletNotFoundError,
} from './ledger.service';

function signPayload(rawBody: string, apiKey: string): string {
  return createHash('md5')
    .update(Buffer.from(rawBody).toString('base64') + apiKey)
    .digest('hex');
}

function signaturesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface CryptomusEnvelope<T> {
  state: number;
  result?: T;
  message?: string;
  errors?: Record<string, unknown>;
}

async function cryptomusRequest<T>(
  path: string,
  body: Record<string, unknown>,
  keyKind: 'payment' | 'payout' = 'payment'
): Promise<T> {
  const { merchantId, apiKey, payoutApiKey, apiBase } = config.cryptomus;
  const signingKey = keyKind === 'payout' ? payoutApiKey || apiKey : apiKey;

  if (!merchantId || !signingKey) throw new PaymentConfigError();

  const rawBody = JSON.stringify(body);

  // A hung payment call must not hold a request open indefinitely.
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 15_000);

  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        merchant: merchantId,
        sign: signPayload(rawBody, signingKey),
      },
      body: rawBody,
      signal: abort.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new PaymentProviderError('payment provider timed out');
    }
    throw new PaymentProviderError(
      err instanceof Error ? err.message : 'payment provider unreachable'
    );
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let envelope: CryptomusEnvelope<T>;
  try {
    envelope = JSON.parse(text) as CryptomusEnvelope<T>;
  } catch {
    throw new PaymentProviderError(
      `payment provider returned a non-JSON response (${response.status})`,
      response.status
    );
  }

  if (!response.ok || envelope.state !== 0 || !envelope.result) {
    throw new PaymentProviderError(
      envelope.message ?? `payment provider rejected the request (${response.status})`,
      response.status
    );
  }

  return envelope.result;
}

const STATUS_MAP: Record<string, CryptoPaymentStatus> = {
  paid: 'PAID',
  paid_over: 'PAID_OVER',
  confirm_check: 'CONFIRMING',
  confirmations: 'CONFIRMING',
  check: 'PENDING',
  process: 'PENDING',
  wrong_amount: 'WRONG_AMOUNT',
  wrong_amount_waiting: 'WRONG_AMOUNT',
  cancel: 'CANCELLED',
  canceled: 'CANCELLED',
  fail: 'FAILED',
  system_fail: 'FAILED',
  refund_process: 'FAILED',
  refund_fail: 'FAILED',
  refund_paid: 'FAILED',
  locked: 'PENDING',
  expired: 'EXPIRED',
};

function mapStatus(raw: unknown): CryptoPaymentStatus {
  if (typeof raw !== 'string') return 'PENDING';
  return STATUS_MAP[raw.toLowerCase()] ?? 'PENDING';
}

function isSettled(status: CryptoPaymentStatus): boolean {
  return status === 'PAID' || status === 'PAID_OVER' || status === 'CONFIRMED';
}

function isPayoutFailure(status: CryptoPaymentStatus): boolean {
  return status === 'FAILED' || status === 'CANCELLED' || status === 'EXPIRED';
}

export interface CreateDepositInput {
  userId: string;
  /** Decimal string, validated by the route. */
  amount: string;
  currency: SupportedCurrency;
  network?: string;
}

/** Deposits are quoted in this and paid in the asset the player picks. */
const PRICE_CURRENCY = 'USD';

export interface CreateDepositResult {
  paymentId: string;
  /** Asset amount to send, in `currency`. */
  amount: string;
  currency: string;
  /** What that is worth, and what the ledger credits on settlement. */
  priceAmount: string;
  priceCurrency: string;
  status: CryptoPaymentStatus;
  address: string | null;
  payUrl: string | null;
  network: string | null;
  expiresAt: string | null;
}

interface CryptomusInvoice {
  uuid: string;
  order_id: string;
  amount: string;
  /** What the payer actually has to send, in `payer_currency`. */
  payer_amount?: string | null;
  payer_currency?: string | null;
  address?: string | null;
  url?: string | null;
  network?: string | null;
  status?: string;
  expired_at?: number | null;
}

export async function createDeposit(
  input: CreateDepositInput
): Promise<CreateDepositResult> {
  const amount = new D(input.amount);
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    throw new Error('payment: deposit amount must be positive');
  }

  // A frozen account must not be able to move money in either direction.
  const account = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { frozen: true },
  });
  if (!account) throw new WalletNotFoundError();
  if (account.frozen) throw new AccountFrozenError();

  const orderId = `dep_${input.userId}_${Date.now().toString(36)}`;

  if (config.paymentsProvider === NOWPAYMENTS_PROVIDER) {
    return createNowPaymentsDeposit(input, amount, orderId);
  }

  const network = input.network ?? DEFAULT_NETWORK[input.currency];

  // Priced in USD, payable in the chosen asset.
  //
  // This used to send `currency: input.currency`, which told Cryptomus the
  // *price* was 100 BTC — so a "$100" deposit invoiced a hundred bitcoin. The
  // amount a player types is fiat; `to_currency` is what they pay it in, and
  // the provider does the conversion at its own live rate. Inventing a rate
  // here would mean quoting a price the settlement side does not honour.
  const invoice = await cryptomusRequest<CryptomusInvoice>('/payment', {
    amount: amount.toFixed(2),
    currency: PRICE_CURRENCY,
    to_currency: input.currency,
    order_id: orderId,
    ...(network ? { network } : {}),
    ...(config.cryptomus.webhookUrl ? { url_callback: config.cryptomus.webhookUrl } : {}),
    ...(config.cryptomus.returnUrl ? { url_return: config.cryptomus.returnUrl } : {}),
  });

  const record = await prisma.payment.create({
    data: {
      userId: input.userId,
      // The invoice's fiat value — settlement credits this, so it must not be
      // overwritten with the asset amount shown to the payer.
      amount,
      currency: input.currency,
      status: mapStatus(invoice.status),
      paymentId: invoice.uuid,
      address: invoice.address ?? null,
      payUrl: invoice.url ?? null,
    },
    select: { status: true },
  });

  return {
    paymentId: invoice.uuid,
    // The asset amount the provider computed, when it gives one. Falling back
    // to the USD figure would put "100" next to "BTC" again.
    amount: invoice.payer_amount ?? invoice.amount ?? amount.toFixed(2),
    currency: invoice.payer_currency ?? input.currency,
    /** What the deposit is worth, which is what the ledger credits. */
    priceAmount: amount.toFixed(2),
    priceCurrency: PRICE_CURRENCY,
    status: record.status,
    address: invoice.address ?? null,
    payUrl: invoice.url ?? null,
    network: invoice.network ?? network ?? null,
    expiresAt: invoice.expired_at
      ? new Date(invoice.expired_at * 1000).toISOString()
      : null,
  };
}

/**
 * Opens a NOWPayments invoice and records it.
 *
 * The row is written with `provider: 'NOWPAYMENTS'` so the callback handler can
 * tell later which gateway's rules apply to it — the two disagree about what a
 * partial payment means, and about which field carries the amount to credit.
 */
async function createNowPaymentsDeposit(
  input: CreateDepositInput,
  amount: Prisma.Decimal,
  orderId: string
): Promise<CreateDepositResult> {
  const payment = await createNowPayment({
    amount: amount.toFixed(2),
    currency: input.currency,
    orderId,
  });

  const paymentId = String(payment.payment_id);
  const status = mapNowPaymentsStatus(payment.payment_status);

  await prisma.payment.create({
    data: {
      userId: input.userId,
      amount,
      currency: input.currency,
      status,
      provider: NOWPAYMENTS_PROVIDER,
      paymentId,
      address: payment.pay_address ?? null,
      // NOWPayments returns an address to pay, not a hosted checkout page.
      payUrl: null,
    },
    select: { id: true },
  });

  return {
    paymentId,
    // NOWPayments already priced in USD (`price_amount`) and returns the asset
    // amount to send, so only the reporting needed aligning with Cryptomus.
    amount: payment.pay_amount != null ? String(payment.pay_amount) : amount.toFixed(2),
    currency: input.currency,
    priceAmount: amount.toFixed(2),
    priceCurrency: PRICE_CURRENCY,
    status,
    address: payment.pay_address ?? null,
    payUrl: null,
    network: networkLabelFor(input.currency),
    expiresAt: payment.valid_until ?? payment.expiration_estimate_date ?? null,
  };
}

export async function listDeposits(userId: string, take = 20) {
  const rows = await prisma.payment.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      amount: true,
      currency: true,
      status: true,
      paymentId: true,
      txHash: true,
      address: true,
      payUrl: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    ...row,
    amount: row.amount.toFixed(8),
    createdAt: row.createdAt.toISOString(),
  }));
}

export interface WebhookResult {
  handled: boolean;
  credited?: {
    userId: string;
    balance: string;
    amount: string;
  };
}

export function verifyWebhookSignature(body: Record<string, unknown>): boolean {
  const { sign, ...rest } = body as { sign?: unknown } & Record<string, unknown>;
  if (typeof sign !== 'string' || sign.length === 0) return false;

  const apiKey = config.cryptomus.apiKey;
  if (!apiKey) throw new PaymentConfigError();

  const serialized = JSON.stringify(rest).replace(/\//g, '\\/');
  return signaturesMatch(signPayload(serialized, apiKey), sign);
}

/**
 * Handles a verified NOWPayments IPN.
 *
 * The signature is checked by the route before this is called — this function
 * assumes an authentic body and is not safe to call on an unverified one.
 *
 * Crediting rule: a `finished` invoice credits the USD figure the player asked
 * for (`payment.amount`), never `actually_paid`. NOWPayments reports
 * `actually_paid` in the *pay* currency, so crediting it would push satoshis
 * into a dollar balance. A `partially_paid` invoice is therefore recorded as
 * WRONG_AMOUNT and left for an operator: paying half an invoice must not buy a
 * full deposit, and auto-refunding is not this function's decision to make.
 */
export async function handleNowPaymentsIpn(
  body: Record<string, unknown>
): Promise<WebhookResult> {
  const paymentId =
    typeof body.payment_id === 'string' || typeof body.payment_id === 'number'
      ? String(body.payment_id)
      : null;
  if (!paymentId) return { handled: false };

  const status = mapNowPaymentsStatus(body.payment_status);
  const txHash =
    typeof body.payin_hash === 'string' && body.payin_hash.length > 0
      ? body.payin_hash
      : null;

  return settleDeposit({
    provider: NOWPAYMENTS_PROVIDER,
    paymentId,
    status,
    txHash,
    // Credit the invoiced USD price; see the note above.
    creditOverride: null,
  });
}

export async function handleWebhook(
  body: Record<string, unknown>
): Promise<WebhookResult> {
  if (!verifyWebhookSignature(body)) throw new InvalidSignatureError();

  const uuid = typeof body.uuid === 'string' ? body.uuid : null;
  if (!uuid) return { handled: false };

  const status = mapStatus(body.status);
  const txHash = typeof body.txid === 'string' ? body.txid : null;

  if (body.type === 'payout') {
    return handlePayoutWebhook(uuid, status, txHash);
  }

  return handleDepositWebhook(uuid, status, txHash, body);
}

async function handleDepositWebhook(
  uuid: string,
  status: CryptoPaymentStatus,
  txHash: string | null,
  body: Record<string, unknown>
): Promise<WebhookResult> {
  // Cryptomus prices the invoice in the asset itself and reports what actually
  // landed, so the received figure — not the invoiced one — is what gets
  // credited. NOWPayments works the other way round; see handleNowPaymentsIpn.
  const receivedRaw =
    (typeof body.merchant_amount === 'string' && body.merchant_amount) ||
    (typeof body.payment_amount === 'string' && body.payment_amount) ||
    null;

  let received: Prisma.Decimal | null = null;
  if (receivedRaw) {
    try {
      const parsed = new D(receivedRaw);
      if (parsed.isFinite() && parsed.greaterThan(0)) received = parsed;
    } catch {
      received = null;
    }
  }

  return settleDeposit({
    provider: 'CRYPTOMUS',
    paymentId: uuid,
    status,
    txHash,
    creditOverride: received,
  });
}

interface SettleDepositInput {
  /** Which gateway is reporting, used for the ledger's fallback txHash. */
  provider: string;
  paymentId: string;
  status: CryptoPaymentStatus;
  txHash: string | null;
  /**
   * Amount to credit instead of the invoiced figure, when the gateway reports
   * what actually arrived in the ledger's own currency. Null credits
   * `payment.amount`.
   */
  creditOverride: Prisma.Decimal | null;
}

/**
 * The one place a confirmed deposit becomes balance, whichever gateway
 * reported it.
 *
 * Idempotency is the `transactionId IS NULL` guard inside the transaction: both
 * providers retry callbacks until they get a 200, and a redelivery must update
 * the invoice without crediting a second time.
 */
async function settleDeposit(input: SettleDepositInput): Promise<WebhookResult> {
  const { paymentId, status, txHash } = input;

  const payment = await prisma.payment.findUnique({
    where: { paymentId },
    select: { id: true, userId: true, amount: true, transactionId: true },
  });

  // An unknown invoice is not an error worth retrying — 200 it so the provider
  // stops redelivering, but do not create a payment we never opened.
  if (!payment) return { handled: false };

  const received = input.creditOverride;

  if (!isSettled(status) || payment.transactionId) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status,
        ...(txHash ? { txHash } : {}),
        ...(received ? { paidAmount: received } : {}),
      },
    });
    return { handled: true };
  }

  const creditAmount = received ?? payment.amount;

  const outcome = await prisma.$transaction(async (tx) => {
    // Claim this invoice. `transactionId: null` is the idempotency guard: a
    // concurrent delivery that already credited leaves count 0 here.
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, transactionId: null },
      data: {
        status,
        paidAmount: creditAmount,
        ...(txHash ? { txHash } : {}),
      },
    });
    if (claimed.count !== 1) return null;

    const wallet = await tx.wallet.upsert({
      where: {
        userId_currency: { userId: payment.userId, currency: LEDGER_CURRENCY },
      },
      update: {},
      create: {
        userId: payment.userId,
        currency: LEDGER_CURRENCY,
        balance: new D(0),
      },
      select: { id: true },
    });

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: creditAmount } },
      select: { balance: true },
    });

    const ledgerRow = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.DEPOSIT,
        amount: creditAmount,
        status: 'COMPLETED',
        // Unique per invoice even before a chain hash exists, so the ledger's
        // unique txHash still blocks a double credit.
        txHash: txHash ?? `${input.provider.toLowerCase()}:${paymentId}`,
      },
      select: { id: true },
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: { transactionId: ledgerRow.id },
    });

    return { balance: updated.balance.toString() };
  });

  if (!outcome) return { handled: true };

  return {
    handled: true,
    credited: {
      userId: payment.userId,
      balance: outcome.balance,
      amount: creditAmount.toFixed(8),
    },
  };
}

async function handlePayoutWebhook(
  uuid: string,
  status: CryptoPaymentStatus,
  txHash: string | null
): Promise<WebhookResult> {
  const withdrawal = await prisma.withdrawal.findUnique({
    where: { paymentId: uuid },
    select: { id: true, status: true, transactionId: true },
  });
  if (!withdrawal) return { handled: false };

  await prisma.withdrawal.update({
    where: { id: withdrawal.id },
    data: { status, ...(txHash ? { txHash } : {}) },
  });

  if (isPayoutFailure(status) && !isPayoutFailure(withdrawal.status)) {
    try {
      await rejectWithdrawal({
        transactionId: withdrawal.transactionId,
        auditWithin: async () => undefined,
      });
    } catch {
      /* no-op */
    }
  }

  return { handled: true };
}

export interface CreateWithdrawalInput {
  userId: string;
  amount: string;
  currency: SupportedCurrency;
  address: string;
  network?: string;
}

export interface CreateWithdrawalResult {
  /**
   * True when no payout gateway was configured and the request is waiting on an
   * operator. The funds are reserved either way; this only tells the client
   * whether a machine or a human is going to send them.
   */
  review?: boolean;
  withdrawalId: string;
  status: CryptoPaymentStatus;
  amount: string;
  currency: string;
  address: string;
  balance: string;
}

interface CryptomusPayout {
  uuid: string;
  status?: string;
  txid?: string | null;
}

/**
 * Hands a reserved withdrawal to NOWPayments Mass Payouts.
 *
 * A created batch is "accepted", not "sent" — NOWPayments holds it for 2FA
 * verification — so the row stays PENDING and only moves on when the payout
 * callback says so. If the gateway refuses the batch outright the hold is
 * released, because money reserved against a payout that will never happen is
 * money quietly taken from the player.
 */
async function dispatchNowPaymentsPayout(
  input: CreateWithdrawalInput,
  amount: Prisma.Decimal,
  withdrawalId: string,
  reserved: { transactionId: string; balance: string }
): Promise<CreateWithdrawalResult> {
  try {
    const batch = await createPayout([
      {
        address: input.address,
        currency: payCurrencyFor(input.currency),
        amount: amount.toFixed(8),
      },
    ]);

    const leg = batch.withdrawals?.[0];
    const updated = await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        provider: NOWPAYMENTS_PROVIDER,
        paymentId: leg?.id ?? batch.id,
        status: mapNowPaymentsStatus(leg?.status),
        ...(leg?.hash ? { txHash: leg.hash } : {}),
      },
      select: { id: true, status: true },
    });

    return {
      withdrawalId: updated.id,
      status: updated.status,
      amount: amount.toFixed(8),
      currency: input.currency,
      address: input.address,
      balance: reserved.balance,
    };
  } catch (err) {
    await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'FAILED' },
    });
    await rejectWithdrawal({
      transactionId: reserved.transactionId,
      auditWithin: async () => undefined,
    }).catch(() => undefined);
    throw err;
  }
}

export async function createWithdrawal(
  input: CreateWithdrawalInput
): Promise<CreateWithdrawalResult> {
  const amount = new D(input.amount);
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    throw new Error('payment: withdrawal amount must be positive');
  }

  // Reserve the funds. Throws InsufficientFundsError / AccountFrozenError,
  // which the route maps to 409s.
  const reserved = await requestWithdrawal({
    userId: input.userId,
    amount: amount.toFixed(8),
    currency: LEDGER_CURRENCY,
  });

  const network = input.network ?? DEFAULT_NETWORK[input.currency];

  const record = await prisma.withdrawal.create({
    data: {
      userId: input.userId,
      amount,
      currency: input.currency,
      address: input.address,
      network: network ?? null,
      status: 'PENDING',
      transactionId: reserved.transactionId,
    },
    select: { id: true },
  });

  // ── Dispatch ──
  //
  // Three outcomes, in order of preference. The important one is the last:
  // with no payout gateway configured, the request is *queued*, not refused.
  // The funds are already reserved and the row is already PENDING, so an
  // operator can settle it from the admin queue — failing here instead would
  // mean a platform that takes deposits and cannot pay anyone out.
  if (isPayoutConfigured()) {
    return dispatchNowPaymentsPayout(input, amount, record.id, reserved);
  }

  if (!config.cryptomus.merchantId || !config.cryptomus.payoutApiKey) {
    // Plan B: no gateway can send this, so an operator will. The funds stay
    // reserved (the ledger row is a PENDING WITHDRAWAL) and the request is
    // marked so it surfaces in the admin queue as needing a human, not as a
    // payout a provider is already working on.
    const queued = await prisma.withdrawal.update({
      where: { id: record.id },
      data: { provider: MANUAL_PROVIDER, status: 'PENDING_ADMIN_REVIEW' },
      select: { id: true, status: true },
    });

    return {
      withdrawalId: queued.id,
      status: queued.status,
      amount: amount.toFixed(8),
      currency: input.currency,
      address: input.address,
      balance: reserved.balance,
      review: true,
    };
  }

  let payout: CryptomusPayout;
  try {
    payout = await cryptomusRequest<CryptomusPayout>(
      '/payout',
      {
        amount: amount.toFixed(8),
        currency: input.currency,
        address: input.address,
        order_id: `wd_${record.id}`,
        is_subtract: '1', // the network fee comes out of the payout, not our float
        ...(network ? { network } : {}),
        ...(config.cryptomus.webhookUrl
          ? { url_callback: config.cryptomus.webhookUrl }
          : {}),
      },
      'payout'
    );
  } catch (err) {
    // The provider never accepted this payout, so the hold has no purpose.
    // Release it and mark the request failed.
    await prisma.withdrawal.update({
      where: { id: record.id },
      data: { status: 'FAILED' },
    });
    await rejectWithdrawal({
      transactionId: reserved.transactionId,
      auditWithin: async () => undefined,
    }).catch(() => undefined);
    throw err;
  }

  const updated = await prisma.withdrawal.update({
    where: { id: record.id },
    data: {
      paymentId: payout.uuid,
      status: mapStatus(payout.status),
      ...(payout.txid ? { txHash: payout.txid } : {}),
    },
    select: { id: true, status: true },
  });

  return {
    withdrawalId: updated.id,
    status: updated.status,
    amount: amount.toFixed(8),
    currency: input.currency,
    address: input.address,
    balance: reserved.balance,
  };
}

export async function listWithdrawals(userId: string, take = 20) {
  const rows = await prisma.withdrawal.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      amount: true,
      currency: true,
      status: true,
      address: true,
      txHash: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    ...row,
    amount: row.amount.toFixed(8),
    createdAt: row.createdAt.toISOString(),
  }));
}
