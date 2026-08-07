/**
 * FRIGAT — Keno REST routes
 *
 * Same split as limbo.routes.ts: bets settle over the WebSocket
 * (`INSTANT_ENGINES.KENO`, dispatched from `handleInstantBet`), never here.
 * This route only publishes the board's public shape — tile/draw/pick counts
 * and the paytable — for a non-socket client. The Next.js dashboard reads the
 * identical constants directly from @frigat/shared instead of calling this.
 */

import type { FastifyInstance } from 'fastify';
import {
  KENO_DRAW_COUNT,
  KENO_MAX_PICKS,
  KENO_PAYTABLE,
  KENO_TILE_COUNT,
  HOUSE_EDGE,
} from '../../config/game.config';

export function registerKenoRoutes(app: FastifyInstance) {
  app.get('/api/games/keno/config', async () => ({
    tileCount: KENO_TILE_COUNT,
    drawCount: KENO_DRAW_COUNT,
    maxPicks: KENO_MAX_PICKS,
    paytable: KENO_PAYTABLE,
    houseEdge: HOUSE_EDGE.KENO,
  }));
}
