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
   * Enables the sandbox payment endpoints, which credit and debit real wallet
   * balances with no gateway involved.
   *
   * Hard-wired to `NODE_ENV !== 'production'` rather than its own env var: a
   * flag that can be switched on in production is a flag that eventually will
   * be, and this one mints money. The routes are not registered at all when
   * this is false, so they 404 rather than merely refusing.
   */
  mockPaymentsEnabled: optional('NODE_ENV', 'development') !== 'production',

  /**
   * Cryptomus payment gateway. Left empty in development so the server still
   * boots without payment credentials — payment.service refuses to call out
   * when they are missing rather than sending an unsigned request the provider
   * would reject anyway.
   *
   * `payoutApiKey` is a *separate* key to the payment one in the Cryptomus
   * dashboard; signing a payout with the payment key fails authentication.
   */
  cryptomus: {
    merchantId: optional('CRYPTOMUS_MERCHANT_ID', ''),
    apiKey: optional('CRYPTOMUS_API_KEY', ''),
    payoutApiKey: optional('CRYPTOMUS_PAYOUT_API_KEY', ''),
    apiBase: optional('CRYPTOMUS_API_BASE', 'https://api.cryptomus.com/v1'),
    /** Where Cryptomus POSTs status updates. Must be publicly reachable. */
    webhookUrl: optional('CRYPTOMUS_WEBHOOK_URL', ''),
    /** Where the hosted checkout returns the player after paying. */
    returnUrl: optional('CRYPTOMUS_RETURN_URL', ''),
  },

  /** Exact origins allowed to call the REST API from a browser. */
  webOrigins: optional('WEB_ORIGINS', 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
} as const;

if (config.env !== 'production' && !process.env.JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.warn(
    '[config] JWT_SECRET not set — using insecure dev fallback. Do NOT use in production.'
  );
}
