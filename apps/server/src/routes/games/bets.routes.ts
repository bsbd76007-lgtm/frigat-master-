/**
 * FRIGAT — Recent settled bets
 *
 * Backfills the live-bets ticker so it is not an empty table on load. Every
 * row is a real settled round read from GameSession — the same records the
 * fairness page verifies against — so the feed's "real-time action" label
 * stays true for the history as well as the live frames streaming on top.
 *
 * ── On usernames ───────────────────────────────────────────────────────────
 * FRIGAT has no display-name field: the socket labels every player 'player',
 * and the only human-readable identifier on the User model is their email.
 * Publishing emails in a feed any visitor can read would leak the account list
 * — so this derives a stable pseudonymous handle from the user id instead.
 *
 * Stable matters: the same player must read as the same handle across rows,
 * or the feed looks like far more distinct people than are actually playing.
 * Derived rather than stored so it costs no schema change, and it is a
 * one-way hash so a handle cannot be walked back to an account id.
 */

import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../config/prisma';

/** Rows returned when the caller does not ask for a specific count. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/**
 * A short, stable, non-reversible handle for a user id.
 *
 * Six hex characters is ~16.7M values: collisions are possible in principle,
 * but two players sharing a handle in a 20-row feed is a cosmetic coincidence,
 * not a correctness problem — nothing is keyed off it.
 */
export function publicHandle(userId: string): string {
  const digest = createHash('sha256').update(`frigat:handle:${userId}`).digest('hex');
  return `Player_${digest.slice(0, 6)}`;
}

export function registerBetRoutes(app: FastifyInstance) {
  // Public: the ticker renders before a visitor has signed in, and every field
  // returned is already broadcast over the LIVE_BET socket frame anyway.
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
