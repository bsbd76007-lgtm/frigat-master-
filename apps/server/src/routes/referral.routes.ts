/**
 * FRIGAT — Player referral routes
 *
 * Backs the affiliate dashboard: the player's own code, their downline stats,
 * and the sweep of accrued earnings into the wagerable balance.
 *
 * Everything here is scoped to the caller's own token. There is deliberately no
 * `:userId` parameter — an affiliate must not be able to read another
 * affiliate's earnings by guessing an id.
 */

import type { FastifyInstance } from 'fastify';
import { Prisma, TransactionType, TransactionStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { identityFromRequest } from './auth';
import {
  claimAffiliateEarnings,
  NothingToClaimError,
  WalletNotFoundError,
} from '../services/ledger.service';

export function registerReferralRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { currency?: string } }>(
    '/api/referrals/me',
    async (req, reply) => {
      const identity = identityFromRequest(req);
      if (!identity) return reply.code(401).send({ error: 'unauthorized' });

      const currency = req.query.currency ?? 'USD';
      const userId = identity.userId;

      const [me, totalInvited, activeDepositors, earned] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: {
            referralCode: true,
            revSharePercentage: true,
            wallets: {
              where: { currency },
              select: { affiliateBalance: true, currency: true },
            },
          },
        }),
        prisma.user.count({ where: { referredById: userId } }),
        prisma.user.count({
          where: {
            referredById: userId,
            wallets: {
              some: {
                transactions: {
                  some: {
                    type: TransactionType.DEPOSIT,
                    status: TransactionStatus.COMPLETED,
                  },
                },
              },
            },
          },
        }),
        prisma.transaction.aggregate({
          _sum: { amount: true },
          where: {
            type: TransactionType.AFFILIATE_REWARD,
            wallet: { userId, currency },
          },
        }),
      ]);

      if (!me) return reply.code(404).send({ error: 'not_found' });

      return {
        referralCode: me.referralCode,
        revSharePercentage: me.revSharePercentage.toFixed(2),
        totalInvited,
        activeDepositors,
        claimable: (me.wallets[0]?.affiliateBalance ?? new Prisma.Decimal(0)).toFixed(8),
        lifetimeEarned: (earned._sum.amount ?? new Prisma.Decimal(0)).toFixed(8),
        currency: me.wallets[0]?.currency ?? currency,
      };
    }
  );

  app.post<{ Body: { currency?: string } }>(
    '/api/referrals/claim',
    async (req, reply) => {
      const identity = identityFromRequest(req);
      if (!identity) return reply.code(401).send({ error: 'unauthorized' });

      try {
        return await claimAffiliateEarnings({
          userId: identity.userId,
          currency: req.body?.currency,
        });
      } catch (err) {
        if (err instanceof NothingToClaimError) {
          return reply.code(409).send({ error: 'nothing_to_claim' });
        }
        if (err instanceof WalletNotFoundError) {
          return reply.code(404).send({ error: 'wallet_not_found' });
        }
        throw err;
      }
    }
  );
}
