/**
 * HTTP route barrel — the single place every REST endpoint is mounted.
 *
 * `index.ts` builds the app (CORS, headers, websocket plugin, session guard)
 * and then calls this once. The split is deliberate: transport and policy
 * concerns live in the entrypoint, the map of what is served lives here, so
 * adding an endpoint never means editing bootstrap code.
 *
 * Ordering is not significant — Fastify matches by path, not registration
 * order — so these are grouped by domain to read as a table of contents.
 */

import type { FastifyInstance } from 'fastify';

import { registerHealthRoutes } from './health.routes';
import { registerAuthRoutes } from './auth.routes';
import { registerAdminRoutes } from './admin';
import { registerPaymentRoutes } from './payment.routes';
import { registerSupportRoutes } from './support.routes';
import { registerReferralRoutes } from './referral.routes';
import { registerVipRoutes } from './vip.routes';
import { registerStreakRoutes } from './streak.routes';
import { registerRewardsRoutes } from './rewards.routes';
import { registerRaffleRoutes } from './raffle.routes';
import { registerSeedRoutes } from './seed.routes';
import { registerGameRoutes } from './games';

export function registerRoutes(app: FastifyInstance) {
  registerHealthRoutes(app);

  // Public credential endpoints (register / login). Unauthenticated by design.
  registerAuthRoutes(app);

  // Everything under ./admin is behind requireAdmin.
  registerAdminRoutes(app);

  // Money: deposits and withdrawals. Withdrawals go through /api/payments/withdraw
  // only — it records the destination the admin payout queue needs.
  registerPaymentRoutes(app);

  registerSupportRoutes(app);

  // Player rewards and progression.
  registerReferralRoutes(app);
  registerVipRoutes(app);
  registerStreakRoutes(app);
  registerRewardsRoutes(app);
  registerRaffleRoutes(app);

  // Player-scoped provably-fair seeds (read active pair, rotate).
  registerSeedRoutes(app);

  registerGameRoutes(app);
}
