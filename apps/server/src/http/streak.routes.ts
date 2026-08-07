/**
 * FRIGAT — Daily streak routes
 *
 *   GET  /api/streak/me         current streak, milestone, restore offer
 *   GET  /api/streak/cashback   quote yesterday's cashback
 *   POST /api/streak/cashback   claim it
 *   POST /api/streak/restore    pay to reinstate a broken streak
 *
 * All maths lives in streak.service; these handlers only translate between HTTP
 * and that service, so the eligibility and idempotency guards cannot be
 * sidestepped by calling a different endpoint.
 */

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

    // Restored, then cleared: the offer is single-use, and leaving the price
    // set would let a second call charge again for a streak already back.
    const restored = state.restorableStreak + 1;
    const updated = await prisma.user.update({
      where: { id: identity.userId },
      data: {
        currentStreak: restored,
        longestStreak: Math.max(state.longestStreak, restored),
        lastPlayedDate: utcDayStart(new Date()),
        restorableStreak: 0,
        streakRestoreCost: new D(0),
        streakBrokenAt: null,
      },
      select: { currentStreak: true, longestStreak: true },
    });

    pushBalanceToUser(identity.userId, debited.balance);
    return {
      currentStreak: updated.currentStreak,
      longestStreak: updated.longestStreak,
      charged: cost.toFixed(8),
      balance: debited.balance,
    };
  });
}

/**
 * Has a cashback bonus already landed today?
 *
 * Read from the ledger rather than a flag on User, so the guard and the credit
 * cannot disagree — the transaction row is written in the same transaction
 * that moves the money.
 *
 * `awardBonus` mints its own random txHash, so there is no marker string to
 * match on; the claim is identified by a BONUS_CASHBACK-typed row created
 * today. That is why the type exists rather than reusing DEPOSIT.
 */
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
