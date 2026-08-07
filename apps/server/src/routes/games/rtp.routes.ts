import type { FastifyInstance } from 'fastify';
import type { GameType } from '@frigat/shared';
import { HOUSE_EDGE } from '../../config/game.config';

const ROULETTE_POCKETS = 37;
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
  app.get('/api/games/rtp', async () => {
    const games = Object.keys(HOUSE_EDGE) as GameType[];
    return {
      rtp: Object.fromEntries(games.map((g) => [g, round2(rtpFor(g))])),
    };
  });
}
