/**
 * FRIGAT — Limbo REST routes
 *
 * Actual bets do NOT go through here. Every instant game in this codebase —
 * Dice, Coinflip, Roulette, Plinko, and now Limbo — settles over the single
 * authenticated WebSocket (see websocket/socket.server.ts, `handleInstantBet`,
 * which already dispatches to `limbo.play` via INSTANT_ENGINES.LIMBO). That
 * socket is also what keeps the header's live balance in sync
 * (BALANCE / BET_ACCEPTED / GAME_RESULT frames feed useBalance on the client).
 * A second, REST-based way to move money would fork the one audited,
 * ledger-transacted path this platform relies on, for no upside — the web
 * client already holds that socket open on every dashboard page.
 *
 * What lives here instead is the game's public configuration: the legal
 * target-multiplier range. The Next.js client reads the same numbers straight
 * from @frigat/shared (see LIMBO in game.constants.ts) — no fetch needed for
 * a value baked into the bundle at build time. This endpoint exists for any
 * OTHER client (a mobile app, a third-party integration) that only speaks
 * REST and has no reason to import a TypeScript workspace package.
 */

import type { FastifyInstance } from 'fastify';
import { LIMBO, HOUSE_EDGE } from '../../config/game.config';

export function registerLimboRoutes(app: FastifyInstance) {
  app.get('/api/games/limbo/config', async () => ({
    minMultiplier: LIMBO.minMultiplier,
    maxMultiplier: LIMBO.maxMultiplier,
    houseEdge: HOUSE_EDGE.LIMBO,
  }));
}
