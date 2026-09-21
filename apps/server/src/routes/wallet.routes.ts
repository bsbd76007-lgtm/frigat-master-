import type { FastifyInstance } from 'fastify';
import { identityFromRequest } from './auth';
import {
  requestWithdrawal,
  AccountFrozenError,
  InsufficientFundsError,
  WalletNotFoundError,
} from '../services/ledger.service';

export function registerWalletRoutes(app: FastifyInstance) {
  app.post<{ Body: { amount?: string; currency?: string } }>(
    '/api/wallet/withdraw',
    async (req, reply) => {
      const identity = identityFromRequest(req);
      if (!identity) return reply.code(401).send({ error: 'unauthorized' });

      const { amount, currency } = req.body ?? {};
      if (typeof amount !== 'string' || !/^\d+(\.\d{1,8})?$/.test(amount)) {
        return reply.code(400).send({ error: 'amount must be a positive decimal string' });
      }

      try {
        return await requestWithdrawal({
          userId: identity.userId,
          amount,
          currency,
        });
      } catch (err) {
        if (err instanceof InsufficientFundsError) {
          return reply.code(409).send({ error: 'insufficient_funds' });
        }
        if (err instanceof AccountFrozenError) {
          return reply.code(409).send({ error: 'account_frozen' });
        }
        if (err instanceof WalletNotFoundError) {
          return reply.code(404).send({ error: 'wallet_not_found' });
        }
        throw err;
      }
    }
  );
}
