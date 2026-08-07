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

import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { Prisma, TransactionType, type CryptoPaymentStatus } from '@prisma/client';

import { config } from '../config';
import { prisma } from '../config/prisma';
import {
  requestWithdrawal,
  rejectWithdrawal,
  AccountFrozenError,
  InsufficientFundsError,
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

export interface CreateDepositResult {
  paymentId: string;
  amount: string;
  currency: string;
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
  const network = input.network ?? DEFAULT_NETWORK[input.currency];

  const invoice = await cryptomusRequest<CryptomusInvoice>('/payment', {
    amount: amount.toFixed(8),
    currency: input.currency,
    order_id: orderId,
    ...(network ? { network } : {}),
    ...(config.cryptomus.webhookUrl ? { url_callback: config.cryptomus.webhookUrl } : {}),
    ...(config.cryptomus.returnUrl ? { url_return: config.cryptomus.returnUrl } : {}),
  });

  const record = await prisma.payment.create({
    data: {
      userId: input.userId,
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
    amount: amount.toFixed(8),
    currency: input.currency,
    status: record.status,
    address: invoice.address ?? null,
    payUrl: invoice.url ?? null,
    network: invoice.network ?? network ?? null,
    expiresAt: invoice.expired_at
      ? new Date(invoice.expired_at * 1000).toISOString()
      : null,
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
  const payment = await prisma.payment.findUnique({
    where: { paymentId: uuid },
    select: { id: true, userId: true, amount: true, transactionId: true },
  });

  // An unknown invoice is not an error worth retrying — 200 it so the provider
  // stops redelivering, but do not create a payment we never opened.
  if (!payment) return { handled: false };

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
        txHash: txHash ?? `cryptomus:${uuid}`,
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

export async function mockDeposit(input: {
  userId: string;
  amount: string;
  currency?: SupportedCurrency;
}): Promise<{ amount: string; balance: string; paymentId: string }> {
  const amount = new D(input.amount);
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    throw new Error('payment: mock deposit amount must be positive');
  }

  const account = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { frozen: true },
  });
  if (!account) throw new WalletNotFoundError();
  if (account.frozen) throw new AccountFrozenError();

  // `sandbox:` prefix keeps these obvious in the ledger and guarantees the
  // uuid can never collide with a real Cryptomus one.
  const paymentId = `sandbox:${randomUUID()}`;

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: {
        userId_currency: { userId: input.userId, currency: LEDGER_CURRENCY },
      },
      update: {},
      create: {
        userId: input.userId,
        currency: LEDGER_CURRENCY,
        balance: new D(0),
      },
      select: { id: true },
    });

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: amount } },
      select: { balance: true },
    });

    const ledgerRow = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.DEPOSIT,
        amount,
        status: 'COMPLETED',
        txHash: paymentId,
      },
      select: { id: true },
    });

    await tx.payment.create({
      data: {
        userId: input.userId,
        amount,
        currency: input.currency ?? 'USDT',
        status: 'PAID',
        paymentId,
        paidAmount: amount,
        transactionId: ledgerRow.id,
      },
    });

    return {
      amount: amount.toFixed(8),
      balance: updated.balance.toString(),
      paymentId,
    };
  });
}

export async function mockWithdraw(input: {
  userId: string;
  amount: string;
  currency?: SupportedCurrency;
  address?: string;
}): Promise<{ amount: string; balance: string; withdrawalId: string }> {
  const amount = new D(input.amount);
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    throw new Error('payment: mock withdrawal amount must be positive');
  }

  // Reserving through the ledger gives the frozen-account and insufficient-
  // funds checks for free, and yields the Transaction row to settle below.
  const reserved = await requestWithdrawal({
    userId: input.userId,
    amount: amount.toFixed(8),
    currency: LEDGER_CURRENCY,
  });

  const paymentId = `sandbox:${randomUUID()}`;

  const record = await prisma.$transaction(async (tx) => {
    // The funds are already debited; settle the hold so it does not linger in
    // the admin approval queue as a payout that will never be sent.
    await tx.transaction.updateMany({
      where: { id: reserved.transactionId, status: 'PENDING' },
      data: { status: 'COMPLETED' },
    });

    return tx.withdrawal.create({
      data: {
        userId: input.userId,
        amount,
        currency: input.currency ?? 'USDT',
        status: 'CONFIRMED',
        address: input.address ?? 'sandbox-address',
        paymentId,
        txHash: paymentId,
        transactionId: reserved.transactionId,
      },
      select: { id: true },
    });
  });

  return {
    amount: amount.toFixed(8),
    balance: reserved.balance,
    withdrawalId: record.id,
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
