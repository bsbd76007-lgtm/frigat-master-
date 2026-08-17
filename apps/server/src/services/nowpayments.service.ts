/**
 * FRIGAT — NOWPayments gateway client
 *
 * Speaks the two calls a deposit needs — create a payment, and verify the IPN
 * that reports it paid — and nothing else. Crediting stays in payment.service:
 * this file never touches a wallet, so there is still exactly one place money
 * enters the ledger regardless of which gateway opened the invoice.
 *
 * ── Amount semantics ───────────────────────────────────────────────────────
 * The invoice is priced in USD (`price_amount` / `price_currency: usd`) and the
 * player settles it in the crypto they picked (`pay_currency`). That matters:
 * the ledger wallet is USD, so pricing in USD means the figure credited on
 * `finished` is the figure the player asked to deposit, whatever the asset did
 * between opening the invoice and paying it. Crediting `actually_paid` instead
 * would put crypto units into a USD balance.
 *
 * ── IPN signature ──────────────────────────────────────────────────────────
 * NOWPayments signs the callback with HMAC-SHA512 over the JSON body with its
 * top-level keys sorted, keyed by the IPN secret, and sends it in
 * `x-nowpayments-sig`. That is their reference implementation (PHP: `ksort`
 * then `json_encode` with unescaped slashes), and it is reproduced exactly
 * here — a signature scheme that is "close enough" verifies nothing.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { CryptoPaymentStatus } from '@prisma/client';

import { config } from '../config';

export const NOWPAYMENTS_PROVIDER = 'NOWPAYMENTS';

/** Currency codes NOWPayments knows, per asset we offer. */
const PAY_CURRENCY: Record<string, string> = {
  // TRC-20 specifically: the deposit modal already labels USDT as TRON, and an
  // unqualified "usdt" lets the gateway pick a chain the player was not shown.
  USDT: 'usdttrc20',
  BTC: 'btc',
  ETH: 'eth',
  LTC: 'ltc',
};

/** Network shown in the UI beside the address, per asset. */
const NETWORK_LABEL: Record<string, string> = {
  USDT: 'TRC-20',
  BTC: 'Bitcoin',
  ETH: 'ERC-20',
  LTC: 'Litecoin',
};

export function payCurrencyFor(currency: string): string {
  return PAY_CURRENCY[currency] ?? currency.toLowerCase();
}

export function networkLabelFor(currency: string): string | null {
  return NETWORK_LABEL[currency] ?? null;
}

export function isNowPaymentsConfigured(): boolean {
  return config.nowpayments.apiKey.length > 0;
}

export class NowPaymentsError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'NowPaymentsError';
  }
}

/**
 * Maps NOWPayments' payment_status onto the gateway status the schema already
 * models. `partially_paid` deliberately lands on WRONG_AMOUNT rather than a
 * settled state — see the note in payment.service about why a short payment is
 * not credited automatically.
 */
const STATUS_MAP: Record<string, CryptoPaymentStatus> = {
  waiting: 'PENDING',
  confirming: 'CONFIRMING',
  confirmed: 'CONFIRMED',
  sending: 'CONFIRMING',
  partially_paid: 'WRONG_AMOUNT',
  finished: 'PAID',
  failed: 'FAILED',
  refunded: 'CANCELLED',
  expired: 'EXPIRED',
};

export function mapNowPaymentsStatus(raw: unknown): CryptoPaymentStatus {
  if (typeof raw !== 'string') return 'PENDING';
  return STATUS_MAP[raw.toLowerCase()] ?? 'PENDING';
}

const REQUEST_TIMEOUT_MS = 15_000;

async function request<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; bearer?: string }
): Promise<T> {
  if (!isNowPaymentsConfigured()) {
    throw new NowPaymentsError('NOWPayments API key is not configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${config.nowpayments.apiBase}${path}`, {
      method: init.method,
      headers: {
        'x-api-key': config.nowpayments.apiKey,
        ...(init.bearer ? { authorization: `Bearer ${init.bearer}` } : {}),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new NowPaymentsError('payment provider timed out');
    }
    throw new NowPaymentsError(
      err instanceof Error ? err.message : 'payment provider unreachable'
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new NowPaymentsError(
      `payment provider returned a non-JSON response (${response.status})`,
      response.status
    );
  }

  if (!response.ok) {
    const message =
      (parsed as { message?: string })?.message ??
      `payment provider rejected the request (${response.status})`;
    throw new NowPaymentsError(message, response.status);
  }

  return parsed as T;
}

/** Liveness probe. Used by the admin/config surface, never on the hot path. */
export async function nowPaymentsStatus(): Promise<{ message: string }> {
  return request<{ message: string }>('/status', { method: 'GET' });
}

// ─────────────────────────────────────────────
// Mass Payouts
//
// Payouts are a different animal from deposits. Creating one needs a *bearer
// JWT* on top of the API key, obtained from POST /v1/auth with the account's
// email and password — the API key alone cannot move money out, which is the
// correct design on NOWPayments' part. Beyond that, NOWPayments requires each
// payout batch to be verified with a 2FA code (POST /v1/payout/{id}/verify)
// before it is actually sent, and that code comes from a human's authenticator
// app. So this client can *create* a batch; it cannot complete one unattended.
//
// Consequence for us: with only an API key configured, withdrawals queue for
// admin review rather than failing. See createWithdrawal.
// ─────────────────────────────────────────────

export function isPayoutConfigured(): boolean {
  return (
    isNowPaymentsConfigured() &&
    config.nowpayments.payoutEmail.length > 0 &&
    config.nowpayments.payoutPassword.length > 0
  );
}

/** Exchanges the account credentials for a short-lived bearer token. */
async function authenticate(): Promise<string> {
  const auth = await request<{ token?: string }>('/auth', {
    method: 'POST',
    body: {
      email: config.nowpayments.payoutEmail,
      password: config.nowpayments.payoutPassword,
    },
  });
  if (!auth.token) {
    throw new NowPaymentsError('NOWPayments did not return a payout auth token');
  }
  return auth.token;
}

export interface PayoutRecipient {
  address: string;
  /** Asset code as NOWPayments names it, e.g. usdttrc20. */
  currency: string;
  amount: string;
}

export interface NowPaymentsPayoutBatch {
  id: string;
  withdrawals: Array<{
    id: string;
    address: string;
    currency: string;
    amount: string | number;
    status: string;
    hash?: string | null;
  }>;
}

/**
 * Creates a payout batch. The batch comes back in NOWPayments' own pending
 * state — typically `WAITING` for 2FA verification — so the caller must treat a
 * success here as "accepted for dispatch", never as "paid".
 */
export async function createPayout(
  recipients: PayoutRecipient[]
): Promise<NowPaymentsPayoutBatch> {
  if (!isPayoutConfigured()) {
    throw new NowPaymentsError('NOWPayments payout credentials are not configured');
  }
  const token = await authenticate();

  return request<NowPaymentsPayoutBatch>('/payout', {
    method: 'POST',
    body: { ipn_callback_url: config.nowpayments.ipnCallbackUrl || undefined, withdrawals: recipients },
    bearer: token,
  });
}

export interface NowPaymentsPayment {
  payment_id: number | string;
  payment_status: string;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  pay_currency: string;
  order_id?: string | null;
  /** Present only when the invoice carries a deadline. */
  expiration_estimate_date?: string | null;
  valid_until?: string | null;
  payin_extra_id?: string | null;
}

export interface CreatePaymentInput {
  /** USD price of the invoice, decimal string. */
  amount: string;
  /** Asset the player settles in (USDT / BTC / ETH / LTC). */
  currency: string;
  orderId: string;
  description?: string;
}

export async function createNowPayment(
  input: CreatePaymentInput
): Promise<NowPaymentsPayment> {
  return request<NowPaymentsPayment>('/payment', {
    method: 'POST',
    body: {
      price_amount: Number(input.amount),
      price_currency: 'usd',
      pay_currency: payCurrencyFor(input.currency),
      order_id: input.orderId,
      order_description: input.description ?? 'FRIGAT deposit',
      ...(config.nowpayments.ipnCallbackUrl
        ? { ipn_callback_url: config.nowpayments.ipnCallbackUrl }
        : {}),
    },
  });
}

/**
 * Serialises a callback body the way NOWPayments signs it: top-level keys in
 * alphabetical order, everything else left as-is.
 *
 * Only the top level is sorted, matching PHP's `ksort` on the decoded body —
 * sorting recursively would produce a different string and reject every genuine
 * callback.
 */
export function canonicalIpnPayload(body: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(body).sort()) sorted[key] = body[key];
  return JSON.stringify(sorted);
}

/**
 * Verifies `x-nowpayments-sig`.
 *
 * Returns false rather than throwing on a malformed or absent signature: an
 * unsigned callback is simply not authentic, and the route answers all of them
 * the same way so a prober learns nothing from the difference.
 */
export function verifyIpnSignature(
  body: Record<string, unknown>,
  signature: unknown
): boolean {
  const secret = config.nowpayments.ipnSecret;
  if (!secret) throw new NowPaymentsError('NOWPayments IPN secret is not configured');
  if (typeof signature !== 'string' || signature.length === 0) return false;

  const expected = createHmac('sha512', secret)
    .update(canonicalIpnPayload(body))
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature.trim().toLowerCase(), 'utf8');
  // Length must be compared first: timingSafeEqual throws on a mismatch, and
  // the length of a hex digest is not a secret.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
