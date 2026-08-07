/**
 * FRIGAT — Single settled bet, with its fairness record.
 *
 * Backs the bet-details dialog opened from a row in the live feed. Public, for
 * the same reason /api/bets/recent is: every field here is already broadcast in
 * the LIVE_BET frame, and a fairness record a stranger cannot read is not much
 * of a fairness record.
 *
 * ── Why the server seed is conditional ─────────────────────────────────────
 * A round is verified by re-deriving it from (serverSeed, clientSeed, nonce).
 * But those three are also all that is needed to *predict* a round — and a
 * player's active seed pair keeps its serverSeed across every future bet on
 * that pair, with only the nonce advancing. Publishing the serverSeed of a
 * still-active pair would hand out next round's outcome, for that player and
 * for anyone reading their rows in the feed.
 *
 * So this mirrors the rule provableFair.service already enforces on rotation:
 * the hash is always shown (it is the commitment, published up front and safe
 * by construction), and the seed itself only once the pair is retired. Until
 * then the dialog shows the commitment and says the seed is still sealed.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { hashServerSeed } from '@frigat/shared';
import { prisma } from '../../config/prisma';
import { publicHandle } from './bets.routes';

export function registerBetDetailRoutes(app: FastifyInstance) {
  app.get('/api/bets/:id', async (req: FastifyRequest, reply) => {
    const { id } = req.params as { id: string };

    const bet = await prisma.gameSession.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        gameType: true,
        betAmount: true,
        payout: true,
        multiplier: true,
        serverSeed: true,
        clientSeed: true,
        nonce: true,
        createdAt: true,
      },
    });

    if (!bet) {
      return reply.status(404).send({ error: 'Bet not found' });
    }

    // Is the pair this round was decided on still live? Matching on the seed
    // itself rather than the user's *current* active pair: a player may have
    // rotated several times since, and what governs disclosure is the status of
    // this round's own seed, not the latest one.
    const stillActive = await prisma.provableSeed.findFirst({
      where: { userId: bet.userId, serverSeed: bet.serverSeed, active: true },
      select: { id: true },
    });
    const revealed = !stillActive;

    return {
      id: bet.id,
      userId: bet.userId,
      username: publicHandle(bet.userId),
      gameType: bet.gameType,
      // Money stays a string end to end — never through a JS number.
      betAmount: bet.betAmount.toString(),
      payout: bet.payout.toString(),
      multiplier: bet.multiplier,
      timestamp: bet.createdAt.getTime(),
      fairness: {
        // The commitment. Published before the bet, so always safe to show.
        hashedServerSeed: hashServerSeed(bet.serverSeed),
        serverSeed: revealed ? bet.serverSeed : null,
        revealed,
        clientSeed: bet.clientSeed,
        nonce: bet.nonce,
      },
    };
  });
}
