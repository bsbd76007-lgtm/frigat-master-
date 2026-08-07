/**
 * FRIGAT — Admin REST routes
 *
 * Every route here is gated by `requireAdmin`. The web dashboard is a
 * convenience surface on top of this API, not a substitute for it.
 *
 * Money is aggregated in SQL as Decimal and serialised as strings — summing
 * Decimal(18,8) through JS numbers would lose cents at scale.
 */

import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { requireAdmin } from './auth';
import { activeSocketCount } from '../websocket/socket.server';

const D = Prisma.Decimal;

export interface AdminMetrics {
  /** Gross Gaming Revenue = total wagered − total paid out. */
  ggr: string;
  totalWagered: string;
  totalPayout: string;
  totalPlayers: number;
  activeConnections: number;
  totalBets: number;
  /** Payout ÷ wagered, as a percentage string. */
  rtpPercent: string;
  /**
   * Realised house edge: GGR ÷ wagered, as a percentage. The complement of
   * rtpPercent, surfaced separately because it is the number an operator
   * actually watches — and because reading it as `100 − rtp` in the UI would
   * reintroduce float drift on values the API deliberately sends as strings.
   */
  houseEdgePercent: string;
  /** Distinct players who placed at least one bet since UTC midnight. */
  activePlayersToday: number;
  /** Bets placed since UTC midnight. */
  betsToday: number;
  /** Wagered − paid out since UTC midnight. */
  ggrToday: string;
  /** Count and value of withdrawals awaiting an approval decision. */
  pendingWithdrawalCount: number;
  pendingWithdrawalAmount: string;
  generatedAt: string;
}

export function registerAdminRoutes(app: FastifyInstance) {
  app.get(
    '/api/admin/metrics',
    { preHandler: requireAdmin },
    async (): Promise<AdminMetrics> => {
      // UTC midnight, so "today" means the same window regardless of where the
      // admin viewing it happens to be. Reporting that silently followed the
      // reader's timezone would make two admins disagree about revenue.
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
          // Distinct bettors today. groupBy over userId rather than a count of
          // sessions — one player placing 500 bets is one active player.
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

      // Guarded against a zero denominator: a fresh install has no wagers, and
      // dividing there would yield NaN in the operator's headline metric.
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

  /**
   * Per-game performance. Answers the question the games desk actually asks:
   * is any game paying out more than its configured edge says it should?
   *
   * `winRatePercent` counts sessions that returned more than the stake — not
   * sessions with any payout at all. A Mines cashout at 0.9× returns money but
   * is a loss for the player, and counting it as a win would overstate the
   * rate on exactly the games where it matters most.
   */
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
        // Prisma cannot compare two columns inside groupBy, so the win tally is
        // a raw query. Column names are quoted for Postgres' case folding.
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
        // Busiest game first — that is where an edge anomaly costs most.
        .sort((a, b) => b.bets - a.bets);

      return { games, generatedAt: new Date().toISOString() };
    }
  );
}
