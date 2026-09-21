import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { requireAdmin } from './auth';
import { activeSocketCount } from '../websocket/socket.server';

const D = Prisma.Decimal;

export interface AdminMetrics {
  ggr: string;
  totalWagered: string;
  totalPayout: string;
  totalPlayers: number;
  activeConnections: number;
  totalBets: number;
  rtpPercent: string;
  houseEdgePercent: string;
  activePlayersToday: number;
  betsToday: number;
  ggrToday: string;
  pendingWithdrawalCount: number;
  pendingWithdrawalAmount: string;
  generatedAt: string;
}

export function registerAdminRoutes(app: FastifyInstance) {
  app.get(
    '/api/admin/metrics',
    { preHandler: requireAdmin },
    async (): Promise<AdminMetrics> => {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);

      const [totals, totalPlayers, today, activeToday, pendingWithdrawals] =
        await Promise.all([
          prisma.gameSession.aggregate({
            _sum: { betAmount: true, payout: true },
            _count: { _all: true },
          }),
          prisma.user.count(),
          prisma.gameSession.aggregate({
            _sum: { betAmount: true, payout: true },
            _count: { _all: true },
            where: { createdAt: { gte: startOfDay } },
          }),
          prisma.gameSession.groupBy({
            by: ['userId'],
            where: { createdAt: { gte: startOfDay } },
          }),
          prisma.transaction.aggregate({
            where: { type: 'WITHDRAWAL', status: 'PENDING' },
            _sum: { amount: true },
            _count: { _all: true },
          }),
        ]);

      const wagered = totals._sum.betAmount ?? new D(0);
      const payout = totals._sum.payout ?? new D(0);
      const ggr = wagered.minus(payout);

      const rtp = wagered.isZero() ? new D(0) : payout.dividedBy(wagered).times(100);
      const houseEdge = wagered.isZero() ? new D(0) : ggr.dividedBy(wagered).times(100);

      const wageredToday = today._sum.betAmount ?? new D(0);
      const payoutToday = today._sum.payout ?? new D(0);

      return {
        ggr: ggr.toFixed(8),
        totalWagered: wagered.toFixed(8),
        totalPayout: payout.toFixed(8),
        totalPlayers,
        activeConnections: activeSocketCount(),
        totalBets: totals._count._all,
        rtpPercent: rtp.toDecimalPlaces(2, D.ROUND_DOWN).toString(),
        houseEdgePercent: houseEdge.toDecimalPlaces(2, D.ROUND_DOWN).toString(),
        activePlayersToday: activeToday.length,
        betsToday: today._count._all,
        ggrToday: wageredToday.minus(payoutToday).toFixed(8),
        pendingWithdrawalCount: pendingWithdrawals._count._all,
        pendingWithdrawalAmount: (
          pendingWithdrawals._sum.amount ?? new D(0)
        ).toFixed(8),
        generatedAt: new Date().toISOString(),
      };
    }
  );

  app.get(
    '/api/admin/game-analytics',
    { preHandler: requireAdmin },
    async () => {
      const [totals, wins] = await Promise.all([
        prisma.gameSession.groupBy({
          by: ['gameType'],
          _sum: { betAmount: true, payout: true },
          _count: { _all: true },
        }),
        prisma.$queryRaw<Array<{ gameType: string; wins: bigint }>>`
          SELECT "gameType", COUNT(*)::bigint AS wins
          FROM "GameSession"
          WHERE "payout" > "betAmount"
          GROUP BY "gameType"
        `,
      ]);

      const winsByGame = new Map(wins.map((row) => [row.gameType, Number(row.wins)]));

      const games = totals
        .map((row) => {
          const wagered = row._sum.betAmount ?? new D(0);
          const payout = row._sum.payout ?? new D(0);
          const ggr = wagered.minus(payout);
          const bets = row._count._all;
          const won = winsByGame.get(row.gameType) ?? 0;

          return {
            gameType: row.gameType,
            bets,
            wagered: wagered.toFixed(8),
            payout: payout.toFixed(8),
            ggr: ggr.toFixed(8),
            houseEdgePercent: wagered.isZero()
              ? '0'
              : ggr.dividedBy(wagered).times(100).toDecimalPlaces(2, D.ROUND_DOWN).toString(),
            rtpPercent: wagered.isZero()
              ? '0'
              : payout.dividedBy(wagered).times(100).toDecimalPlaces(2, D.ROUND_DOWN).toString(),
            winRatePercent:
              bets === 0 ? '0' : ((won / bets) * 100).toFixed(2),
            wins: won,
          };
        })
        .sort((a, b) => b.bets - a.bets);

      return { games, generatedAt: new Date().toISOString() };
    }
  );
}
