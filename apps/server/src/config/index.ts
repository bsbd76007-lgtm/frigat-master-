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

  mockPaymentsEnabled: optional('NODE_ENV', 'development') !== 'production',

  cryptomus: {
    merchantId: optional('CRYPTOMUS_MERCHANT_ID', ''),
    apiKey: optional('CRYPTOMUS_API_KEY', ''),
    payoutApiKey: optional('CRYPTOMUS_PAYOUT_API_KEY', ''),
    apiBase: optional('CRYPTOMUS_API_BASE', 'https://api.cryptomus.com/v1'),
    webhookUrl: optional('CRYPTOMUS_WEBHOOK_URL', ''),
    returnUrl: optional('CRYPTOMUS_RETURN_URL', ''),
  },

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
