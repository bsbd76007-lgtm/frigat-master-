import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';

import { identityFromRequest } from './auth';
import { prisma } from '../config/prisma';
import { creditCashback, processBet } from '../services/ledger.service';
import { pushBalanceToUser } from '../websocket/socket.server';
import {
  getStreak,
  quoteCashback,
  utcDayStart,
  STREAK_MILESTONES,
} from '../services/streak.service';

const D = Prisma.Decimal;

export function registerStreakRoutes(app: FastifyInstance) {
  app.get('/api/streak/me', async (req: FastifyRequest, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.status(401).send({ error: 'unauthorized' });

    const state = await getStreak(identity.userId);
    return { ...state, milestones: STREAK_MILESTONES };
  });

  app.get('/api/streak/cashback', async (req: FastifyRequest, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.status(401).send({ error: 'unauthorized' });

    const quote = await quoteCashback(identity.userId);
    const claimedToday = await hasClaimedToday(identity.userId);
    return { ...quote, claimedToday, claimable: quote.eligible && !claimedToday };
  });

  app.post('/api/streak/cashback', async (req: FastifyRequest, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.status(401).send({ error: 'unauthorized' });

    // Re-quoted server-side rather than trusting an amount from the client:
    // the figure the UI showed is a display of this same calculation, not an
    // input to it.
    const quote = await quoteCashback(identity.userId);
    if (!quote.eligible) {
      return reply
        .status(400)
        .send({ error: 'nothing_to_claim', message: 'No cashback owed for yesterday.' });
    }

    if (await hasClaimedToday(identity.userId)) {
      return reply
        .status(409)
        .send({ error: 'already_claimed', message: 'Cashback already claimed today.' });
    }

    const credited = await creditCashback({
      userId: identity.userId,
      amount: quote.amount,
      currency: 'USD',
    });

    pushBalanceToUser(identity.userId, credited.balance);
    return { amount: quote.amount, rate: quote.rate, balance: credited.balance };
  });

  app.post('/api/streak/restore', async (req: FastifyRequest, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.status(401).send({ error: 'unauthorized' });

    const state = await getStreak(identity.userId);
    if (!state.restoreAvailable || state.restorableStreak <= 0) {
      return reply
        .status(400)
        .send({ error: 'nothing_to_restore', message: 'No streak available to restore.' });
    }

    const cost = new D(state.streakRestoreCost);
    if (cost.lessThanOrEqualTo(0)) {
      return reply
        .status(400)
        .send({ error: 'nothing_to_restore', message: 'No restore price set.' });
    }

    // Claim the offer BEFORE charging for it. This conditional update is the
    // serialisation point: `restorableStreak: { gt: 0 }` means exactly one of N
    // concurrent requests can win, because the loser's update matches no row.
    // Previously the offer was cleared unconditionally AFTER the debit, so two
    // requests 5ms apart both read restoreAvailable, both charged, and the
    // player paid twice for one restore.
    const restored = state.restorableStreak + 1;
    const claim = await prisma.user.updateMany({
      where: { id: identity.userId, restorableStreak: { gt: 0 } },
      data: {
        currentStreak: restored,
        longestStreak: Math.max(state.longestStreak, restored),
        lastPlayedDate: utcDayStart(new Date()),
        restorableStreak: 0,
        streakRestoreCost: new D(0),
        // streakBrokenAt is deliberately NOT cleared here. It is what
        // getStreak uses to decide the offer is still inside its window, so
        // clearing it before the charge succeeds would make the rollback below
        // unable to put the offer back. It is cleared after the debit lands.
      },
    });
    if (claim.count === 0) {
      return reply
        .status(409)
        .send({ error: 'already_restored', message: 'Streak already restored.' });
    }

    // Charged through the ledger like any other debit, so it lands in the
    // transaction history and respects the frozen-account gate. A direct
    // wallet decrement would bypass both.
    let debited;
    try {
      debited = await processBet({
        userId: identity.userId,
        amount: cost.toFixed(8),
        currency: 'USD',
        gameType: 'STREAK_RESTORE',
      });
    } catch (err) {
      // The offer was already claimed above, so a failed debit has to give it
      // back — otherwise a player who was briefly short, or frozen mid-request,
      // silently loses a restore they never paid for.
      // streakBrokenAt is not exposed on StreakState, so it is read back from
      // the row rather than reconstructed — restoring the offer must not
      // invent a break date.
      await prisma.user
        .update({
          where: { id: identity.userId },
          data: {
            currentStreak: state.currentStreak,
            restorableStreak: state.restorableStreak,
            streakRestoreCost: cost,
          },
        })
        .catch(() => undefined);

      const name = (err as Error)?.name;
      if (name === 'InsufficientFundsError') {
        return reply
          .status(400)
          .send({ error: 'insufficient_funds', message: 'Not enough balance to restore.' });
      }
      if (name === 'AccountFrozenError') {
        return reply.status(403).send({ error: 'account_frozen' });
      }
      throw err;
    }

    // Paid for: the break is now fully healed and the offer cannot be re-quoted.
    await prisma.user.update({
      where: { id: identity.userId },
      data: { streakBrokenAt: null },
    });

    const updated = {
      currentStreak: restored,
      longestStreak: Math.max(state.longestStreak, restored),
    };

    pushBalanceToUser(identity.userId, debited.balance);
    return {
      currentStreak: updated.currentStreak,
      longestStreak: updated.longestStreak,
      charged: cost.toFixed(8),
      balance: debited.balance,
    };
  });
}

async function hasClaimedToday(userId: string): Promise<boolean> {
  const dayStart = utcDayStart(new Date());

  const existing = await prisma.transaction.findFirst({
    where: {
      wallet: { userId },
      type: 'BONUS_CASHBACK',
      createdAt: { gte: dayStart },
    },
    select: { id: true },
  });
  return existing !== null;
}
