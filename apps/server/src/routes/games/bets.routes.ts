import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../config/prisma';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export function publicHandle(userId: string): string {
  const digest = createHash('sha256').update(`frigat:handle:${userId}`).digest('hex');
  return `Player_${digest.slice(0, 6)}`;
}

export function registerBetRoutes(app: FastifyInstance) {
  app.get('/api/bets/recent', async (req: FastifyRequest) => {
    const raw = Number((req.query as { limit?: string } | undefined)?.limit);
    const limit = Number.isFinite(raw)
      ? Math.min(Math.max(Math.trunc(raw), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const rows = await prisma.gameSession.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        userId: true,
        gameType: true,
        betAmount: true,
        payout: true,
        multiplier: true,
        createdAt: true,
      },
    });

    return {
      bets: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        username: publicHandle(row.userId),
        gameType: row.gameType,
        // Decimal → string: these are money values and must not go through a
        // JS number on the way to the client.
        betAmount: row.betAmount.toString(),
        payout: row.payout.toString(),
        multiplier: row.multiplier,
        timestamp: row.createdAt.getTime(),
      })),
    };
  });
}
