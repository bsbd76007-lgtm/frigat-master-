/**
 * FRIGAT — Server Environment Configuration
 * Fails fast on missing critical secrets.
 */

import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';


// Load apps/server/.env first (server-specific), then the repo-root .env that
// the Prisma CLI also reads. dotenv never overwrites an already-set variable,
// so the real process environment always wins.
loadEnv({ path: resolve(__dirname, '../../.env') });
loadEnv({ path: resolve(__dirname, '../../../../.env') });

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/**
 * The deployed web app, pinned so the frontend keeps working even if the
 * origin variables on the host are missing, renamed or mistyped.
 */
const DEPLOYED_WEB_ORIGIN = 'https://frigat-web.onrender.com';

/**
 * Splits a comma-separated origin list.
 *
 * The trailing slash is stripped because `CLIENT_URL` is normally a page URL
 * ("https://app.example.com/") while a browser's `Origin` header never carries
 * a path or a trailing slash. Comparing the two verbatim never matches, which
 * looks exactly like the origin not being configured at all.
 */
function splitOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function dedupe(origins: string[]): string[] {
  return [...new Set(origins)];
}

export const config = {
  env: optional('NODE_ENV', 'development'),
  host: optional('HOST', '0.0.0.0'),
  port: parseInt(optional('PORT', '4000'), 10),

  // In production JWT_SECRET must be set; in dev we allow a fallback but warn.
  jwtSecret:
    process.env.JWT_SECRET ??
    (process.env.NODE_ENV === 'production'
      ? required('JWT_SECRET')
      : 'dev-only-insecure-secret-change-me'),

  /** Lifetime of a session token issued by /api/auth/*. */
  jwtExpiresIn: optional('JWT_EXPIRES_IN', '12h'),

  databaseUrl: optional(
    'DATABASE_URL',
    'postgresql://frigat:frigat@localhost:5432/frigat?schema=public'
  ),

  redisUrl: optional('REDIS_URL', 'redis://localhost:6379'),

  /**
   * Outbound mail. With no host set, mailer.service logs messages instead of
   * sending them — see the note there about why that is development-only.
   */
  smtp: {
    host: optional('SMTP_HOST', ''),
    port: parseInt(optional('SMTP_PORT', '587'), 10),
    user: optional('SMTP_USER', ''),
    pass: optional('SMTP_PASS', ''),
    from: optional('SMTP_FROM', 'FRIGAT <no-reply@frigat.local>'),
  },

  // There is no sandbox-payments switch. Balances move only through a verified
  // gateway callback or an audited admin adjustment.

  /**
   * NOWPayments credentials.
   *
   * Present but NOT yet wired to a provider client: the live deposit path in
   * payment.service.ts still speaks to Cryptomus. Surfaced here so the keys are
   * validated config rather than loose strings in .env, and so switching
   * providers is a code change in one service rather than a hunt for env names.
   *
   * `ipnSecret` signs NOWPayments' IPN callbacks (HMAC-SHA512 over the sorted
   * JSON body). Any webhook handler added later must verify it before crediting
   * anything — an unverified callback is an open door onto the ledger.
   */
  nowpayments: {
    apiKey: optional('NOWPAYMENTS_API_KEY', ''),
    ipnSecret: optional('NOWPAYMENTS_IPN_SECRET', ''),
    apiBase: optional('NOWPAYMENTS_API_BASE', 'https://api.nowpayments.io/v1'),
    /**
     * Where NOWPayments posts payment updates. Must be a public HTTPS URL, so
     * it is empty in local development — an invoice still opens and can be
     * paid, it just will not be credited until a callback can reach us.
     */
    ipnCallbackUrl: optional('NOWPAYMENTS_IPN_CALLBACK_URL', ''),
    /**
     * Payout credentials. Separate from the API key on purpose: NOWPayments
     * will not let an API key alone move money out, so these are what turn
     * automatic withdrawals on. Without them, withdrawals still work — they
     * queue for admin review instead of being dispatched.
     */
    payoutEmail: optional('NOWPAYMENTS_PAYOUT_EMAIL', ''),
    payoutPassword: optional('NOWPAYMENTS_PAYOUT_PASSWORD', ''),
  },

  /**
   * Which gateway opens new deposits. NOWPayments takes over as soon as it has
   * an API key, and Cryptomus stays reachable either way so invoices opened
   * before the switch can still settle from their own webhook.
   */
  paymentsProvider: optional(
    'PAYMENTS_PROVIDER',
    process.env.NOWPAYMENTS_API_KEY ? 'NOWPAYMENTS' : 'CRYPTOMUS'
  ).toUpperCase(),

  cryptomus: {
    merchantId: optional('CRYPTOMUS_MERCHANT_ID', ''),
    apiKey: optional('CRYPTOMUS_API_KEY', ''),
    payoutApiKey: optional('CRYPTOMUS_PAYOUT_API_KEY', ''),
    apiBase: optional('CRYPTOMUS_API_BASE', 'https://api.cryptomus.com/v1'),
    webhookUrl: optional('CRYPTOMUS_WEBHOOK_URL', ''),
    returnUrl: optional('CRYPTOMUS_RETURN_URL', ''),
  },

  /**
   * Accounts that sign in with a password alone, skipping the emailed second
   * factor. Every ADMIN already bypasses; this is for designated dev or
   * break-glass addresses that are not admins.
   *
   * Kept in the environment rather than in source deliberately: a hard-coded
   * address here would be a permanent bypass that ships in the repository and
   * follows every deployment, including ones that never wanted it.
   */
  otpBypassEmails: optional('AUTH_OTP_BYPASS_EMAILS', '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),

  /**
   * Cloudflare Turnstile. With no secret set the check bypasses — see
   * utils/turnstile.ts for exactly when that is and is not allowed.
   */
  turnstile: {
    secretKey: optional('TURNSTILE_SECRET_KEY', ''),
    /**
     * Deliberate kill switch for a first deploy, before the Cloudflare keys
     * exist. Must be set to the literal 'true' or '1' — nothing infers it, so
     * bot protection can never switch itself off because a variable was
     * forgotten. Every skipped check is logged.
     */
    disabled: ['true', '1'].includes(optional('TURNSTILE_DISABLED', '').toLowerCase()),
    verifyUrl: optional(
      'TURNSTILE_VERIFY_URL',
      'https://challenges.cloudflare.com/turnstile/v0/siteverify'
    ),
  },

  /**
   * Allowed browser origins.
   *
   * The *union* of every source rather than the first one that happens to be
   * set. CORS_ORIGIN is what most hosting platforms name the variable,
   * CLIENT_URL is what Render emits for a linked frontend, and WEB_ORIGINS is
   * the name this server shipped with. Each may carry a comma-separated list.
   *
   * Reading only the first defined name — which this did, via `??` — meant
   * that setting CORS_ORIGIN on a deployment silently discarded everything
   * WEB_ORIGINS still listed, and the drop was invisible until a browser call
   * failed in production.
   *
   * The deployed web app is pinned in code so a missing or mistyped variable
   * on Render cannot lock the frontend out of its own API. Localhost is added
   * only outside production: a live API has no reason to trust an origin any
   * attacker can host on their own machine.
   */
  webOrigins: dedupe([
    DEPLOYED_WEB_ORIGIN,
    ...splitOrigins(process.env.CORS_ORIGIN),
    ...splitOrigins(process.env.CLIENT_URL),
    ...splitOrigins(process.env.WEB_ORIGINS),
    ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000']),
  ]),
} as const;

if (config.env !== 'production' && !process.env.JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.warn(
    '[config] JWT_SECRET not set — using insecure dev fallback. Do NOT use in production.'
  );
}
