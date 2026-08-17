/**
 * FRIGAT — Rewards hub API.
 *
 * Three endpoints behind one prefix, all requiring a session.
 *
 * The wheel route is a **delegate**, not a second implementation: it calls the
 * same `spinDailyWheel` that `/api/vip/daily-wheel` does, so both share
 * `User.lastDailyWheelSpinAt` and the once-per-24h limit holds across them. A
 * parallel wheel with its own timestamp would be a second free spin per day,
 * which on a real-money platform is simply a way to print money.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { identityFromRequest } from '../http/auth';
import { pushBalanceToUser } from '../websocket/socket.server';
import {
  spinDailyWheel,
  WheelNotReadyError,
  WHEEL_SEGMENTS,
} from '../services/bonus.service';
import {
  AccountFrozenError,
  CHECK_IN_LADDER,
  CheckInNotReadyError,
  claimTask,
  getCheckInStatus,
  PromoAlreadyRedeemedError,
  PromoNotFoundError,
  PromoUnavailableError,
  redeemPromoCode,
  TaskNotVerifiableError,
  TASKS,
} from '../services/rewards.service';

/** Shared auth preamble. Returns null when the request has already been answered. */
function requireUser(req: FastifyRequest, reply: FastifyReply): string | null {
  const identity = identityFromRequest(req);
  if (!identity) {
    void reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return identity.userId;
}

export function registerRewardsRoutes(app: FastifyInstance) {
  /**
   * GET /api/rewards/overview
   *
   * Everything the hub renders, in one round trip: wheel readiness, check-in
   * state and the task board. Three separate calls on page load would give the
   * client three chances to disagree with itself about what is claimable.
   */
  app.get('/api/rewards/overview', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return reply;

    const checkIn = await getCheckInStatus(userId);

    return reply.send({
      wheel: {
        segments: WHEEL_SEGMENTS.map((segment) => ({
          prize: segment.prize,
          weight: segment.weight,
        })),
      },
      checkIn,
      tasks: TASKS,
      ladder: CHECK_IN_LADDER,
    });
  });

  /**
   * POST /api/rewards/wheel/spin
   *
   * Delegates to the shared wheel service — see the note at the top of this
   * file about why this is not its own implementation.
   */
  app.post('/api/rewards/wheel/spin', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return reply;

    try {
      const result = await spinDailyWheel({ userId });
      // The header reads the balance from socket frames, never from a response
      // body, so the credit has to be pushed for the UI to follow it.
      pushBalanceToUser(userId, result.balance);
      return reply.send(result);
    } catch (err) {
      if (err instanceof WheelNotReadyError) {
        return reply.code(429).send({
          error: 'wheel_not_ready',
          message: 'Your next free spin is not available yet.',
          nextAvailableAt: err.nextAvailableAt.toISOString(),
        });
      }
      if (err instanceof Error && err.message.includes('frozen')) {
        return reply.code(403).send({
          error: 'account_frozen',
          message: 'This account cannot claim rewards.',
        });
      }
      throw err;
    }
  });

  /**
   * POST /api/rewards/promocode
   *
   * Failure reasons are deliberately specific — "expired" and "already
   * redeemed" are things a player can act on, and hiding them behind a generic
   * error just generates support tickets. Nothing here reveals whether an
   * *unknown* code exists, because the answer is the same either way.
   */
  app.post<{ Body: { code?: unknown } }>('/api/rewards/promocode', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return reply;

    const raw = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!raw || raw.length > 64) {
      return reply.code(400).send({
        error: 'invalid_code',
        message: 'Enter a promo code.',
      });
    }

    try {
      const result = await redeemPromoCode({ userId, code: raw });
      pushBalanceToUser(userId, result.balance);
      req.log.info({ userId, code: result.code }, 'promo code redeemed');
      return reply.send({ success: true, ...result });
    } catch (err) {
      if (err instanceof PromoNotFoundError) {
        return reply.code(404).send({
          error: 'promo_not_found',
          message: 'That code was not recognised.',
        });
      }
      if (err instanceof PromoAlreadyRedeemedError) {
        return reply.code(409).send({
          error: 'promo_already_redeemed',
          message: 'You have already used this code.',
        });
      }
      if (err instanceof PromoUnavailableError) {
        return reply.code(409).send({
          error: `promo_${err.reason}`,
          message:
            err.reason === 'expired'
              ? 'That code has expired.'
              : err.reason === 'exhausted'
                ? 'That code has been fully claimed.'
                : 'That code is no longer active.',
        });
      }
      if (err instanceof AccountFrozenError) {
        return reply.code(403).send({
          error: 'account_frozen',
          message: 'This account cannot claim rewards.',
        });
      }
      throw err;
    }
  });

  /**
   * POST /api/rewards/tasks/claim
   *
   * Only tasks the server can verify are payable. Anything else is refused
   * rather than paid on trust — see `TASKS` in the service.
   */
  app.post<{ Body: { taskId?: unknown } }>('/api/rewards/tasks/claim', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return reply;

    const taskId = typeof req.body?.taskId === 'string' ? req.body.taskId : '';
    if (!taskId) {
      return reply.code(400).send({ error: 'invalid_task', message: 'No task given.' });
    }

    try {
      const result = await claimTask({ userId, taskId });
      pushBalanceToUser(userId, result.balance);
      req.log.info({ userId, taskId, amount: result.amount }, 'task reward claimed');
      return reply.send({ success: true, taskId, ...result });
    } catch (err) {
      if (err instanceof CheckInNotReadyError) {
        return reply.code(429).send({
          error: 'already_claimed',
          message: 'You have already checked in today.',
          nextAvailableAt: err.nextAvailableAt.toISOString(),
        });
      }
      if (err instanceof TaskNotVerifiableError) {
        return reply.code(400).send({
          error: 'task_not_verifiable',
          message: 'That task cannot be verified yet, so it pays no reward.',
        });
      }
      if (err instanceof AccountFrozenError) {
        return reply.code(403).send({
          error: 'account_frozen',
          message: 'This account cannot claim rewards.',
        });
      }
      throw err;
    }
  });
}

export default registerRewardsRoutes;
