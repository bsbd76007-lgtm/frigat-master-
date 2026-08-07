/**
 * FRIGAT — Game config routes aggregator.
 * One import in index.ts registers every game-specific REST route.
 */

import type { FastifyInstance } from 'fastify';
import { registerLimboRoutes } from './limbo.routes';
import { registerKenoRoutes } from './keno.routes';
import { registerRtpRoutes } from './rtp.routes';
import { registerBetRoutes } from './bets.routes';
import { registerBetDetailRoutes } from './betDetail.routes';
import { registerPresenceRoutes } from './presence.routes';

export function registerGameRoutes(app: FastifyInstance) {
  registerLimboRoutes(app);
  registerKenoRoutes(app);
  registerRtpRoutes(app);
  registerBetRoutes(app);
  registerBetDetailRoutes(app);
  registerPresenceRoutes(app);
}
