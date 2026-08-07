/**
 * FRIGAT — Per-game RTP
 *
 * The launcher modal shows an RTP figure beside each game's title. That number
 * has to come from the same constant the engines settle against, otherwise it
 * is decoration that goes stale the moment an edge is retuned — and an RTP a
 * player cannot rely on is worse than no RTP at all.
 *
 * Two of these are not a simple `1 - edge`:
 *
 *  - ROULETTE has HOUSE_EDGE 0, because the edge is structural rather than
 *    applied: a single green zero on a 37-pocket wheel paying 36 for 1 gives
 *    36/37 = 97.30%. Reading HOUSE_EDGE.ROULETTE here would advertise 100%.
 *  - KENO's edge is baked into its paytable's calibration rather than applied
 *    multiplicatively, so the 0.02 constant is already the effective figure.
 *
 * Returned as a percentage rounded to two decimals — the precision a player
 * sees quoted elsewhere in the industry.
 */

import type { FastifyInstance } from 'fastify';
import type { GameType } from '@frigat/shared';
import { HOUSE_EDGE } from '../../config/game.config';

/** Pockets on the wheel; the single zero is what supplies the edge. */
const ROULETTE_POCKETS = 37;
/** Gross payout on a straight-up win, stake included. */
const ROULETTE_STRAIGHT_PAYOUT = 36;

export function rtpFor(game: GameType): number {
  if (game === 'ROULETTE') {
    return (ROULETTE_STRAIGHT_PAYOUT / ROULETTE_POCKETS) * 100;
  }
  return (1 - HOUSE_EDGE[game]) * 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function registerRtpRoutes(app: FastifyInstance) {
  // Public: the figure is a published property of the game, and the client
  // needs it before a player has signed in.
  app.get('/api/games/rtp', async () => {
    const games = Object.keys(HOUSE_EDGE) as GameType[];
    return {
      rtp: Object.fromEntries(games.map((g) => [g, round2(rtpFor(g))])),
    };
  });
}
