/**
 * FRIGAT — VIP & daily bonus routes
 *
 *   GET  /api/vip/me              tier, wagered volume, claimable rakeback
 *   POST /api/vip/claim-rakeback  credit the claimable amount
 *   POST /api/bonus/spin          claim the daily wheel spin
 *   POST /api/vip/daily-wheel     deprecated alias of /api/bonus/spin
 *
 * All reward maths lives in bonus.service; these handlers only translate
 * between HTTP and that service, so the eligibility and idempotency guards
 * cannot be bypassed by calling a different endpoint.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { identityFromRequest } from './auth';
import { pushBalanceToUser } from '../websocket/socket.server';
import { WalletNotFoundError } from '../services/ledger.service';
import {
  claimRakeback,
  getVipStatus,
  spinDailyWheel,
  NothingToClaimError,
  WheelNotReadyError,
  VIP_TIERS,
  WHEEL_SEGMENTS,
} from '../services/bonus.service';

export function registerVipRoutes(app: FastifyInstance) {
  app.get('/api/vip/config', async () => ({
    tiers: VIP_TIERS,
    wheel: WHEEL_SEGMENTS.map((segment) => ({
      prize: segment.prize,
      weight: segment.weight,
    })),
  }));

  app.get('/api/vip/me', async (req, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });

    const currency = (req.query as { currency?: string }).currency;
    return getVipStatus({ userId: identity.userId, currency });
  });

  app.post('/api/vip/claim-rakeback', async (req, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });

    const currency = (req.body as { currency?: string })?.currency;

    try {
      const result = await claimRakeback({ userId: identity.userId, currency });
      pushBalanceToUser(identity.userId, result.balance);
      return result;
    } catch (err) {
      if (err instanceof NothingToClaimError) {
        return reply.code(409).send({ error: 'nothing_to_claim' });
      }
      if (err instanceof WalletNotFoundError) {
        return reply.code(404).send({ error: 'wallet_not_found' });
      }
      throw err;
    }
  });

  const handleSpin = async (req: FastifyRequest, reply: FastifyReply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });

    const currency = (req.body as { currency?: string })?.currency;

    try {
      const result = await spinDailyWheel({ userId: identity.userId, currency });
      pushBalanceToUser(identity.userId, result.balance);
      return result;
    } catch (err) {
      if (err instanceof WheelNotReadyError) {
        return reply.code(409).send({
          error: 'wheel_not_ready',
          nextAvailableAt: err.nextAvailableAt.toISOString(),
        });
      }
      if (err instanceof WalletNotFoundError) {
        return reply.code(404).send({ error: 'wallet_not_found' });
      }
      if (err instanceof Error && err.message === 'bonus: account is frozen') {
        return reply.code(409).send({ error: 'account_frozen' });
      }
      throw err;
    }
  };

  app.post('/api/bonus/spin', handleSpin);
  app.post('/api/vip/daily-wheel', handleSpin);
}
