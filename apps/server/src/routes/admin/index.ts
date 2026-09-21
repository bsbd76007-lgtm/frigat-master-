/**
 * Admin route barrel.
 *
 * Every route registered here sits behind `requireAdmin` (middleware/auth.ts),
 * which is the real authorisation boundary — the web app's middleware.ts gates
 * navigation only, and anyone can curl this API directly.
 */

import type { FastifyInstance } from 'fastify';
import { registerAdminMetricsRoutes } from './metrics.routes';
import { registerAdminUserRoutes } from './users.routes';
import { registerAdminRiskRoutes } from './risk.routes';

export function registerAdminRoutes(app: FastifyInstance) {
  registerAdminMetricsRoutes(app);
  registerAdminUserRoutes(app);
  registerAdminRiskRoutes(app);
}
