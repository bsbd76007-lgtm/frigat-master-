/**
 * FRIGAT — Cryptomus payment routes
 *
 *   POST /api/payments/deposit    open an invoice        (player JWT)
 *   POST /api/payments/withdraw   request a payout       (player JWT)
 *   POST /api/payments/webhook    provider status update (MD5 signature)
 *   GET  /api/payments/history    own deposits/withdrawals (player JWT)
 *   GET  /api/payments/config     whether sandbox mode is offered
 *
 * Outside production only:
 *   POST /api/payments/mock-deposit   credit own balance, no gateway (player JWT)
 *   POST /api/payments/mock-withdraw  debit own balance, no gateway  (player JWT)
 *
 * The webhook is deliberately unauthenticated in the JWT sense — Cryptomus has
 * no session and cannot present one. Its signature *is* the credential, and it
 * is checked before the body is trusted for anything.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { config } from '../config';
import { identityFromRequest } from '../http/auth';
import { pushBalanceToUser } from '../websocket/socket.server';
import {
  createDeposit,
  createWithdrawal,
  handleWebhook,
  isSupportedCurrency,
  listDeposits,
  listWithdrawals,
  mockDeposit,
  mockWithdraw,
  SUPPORTED_CURRENCIES,
  AccountFrozenError,
  InsufficientFundsError,
  InvalidSignatureError,
  PaymentConfigError,
  PaymentProviderError,
  WalletNotFoundError,
} from '../services/payment.service';

const MOCK_MAX_AMOUNT = 10_000;

/** Positive decimal with at most 8 fraction digits, matching Decimal(18, 8). */
const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,8})?$/;

function isValidAmount(value: unknown): value is string {
  return typeof value === 'string' && AMOUNT_PATTERN.test(value) && Number(value) > 0;
}

function isPlausibleAddress(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 20 &&
    value.length <= 128 &&
    /^[a-zA-Z0-9:_-]+$/.test(value)
  );
}

export function registerPaymentRoutes(app: FastifyInstance) {
  app.post<{
    Body: { amount?: string; currency?: string; network?: string };
  }>('/api/payments/deposit', async (req, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });

    const { amount, currency, network } = req.body ?? {};

    if (!isValidAmount(amount)) {
      return reply
        .code(400)
        .send({ error: 'amount must be a positive decimal string (max 8 dp)' });
    }
    if (!isSupportedCurrency(currency)) {
      return reply.code(400).send({
        error: 'unsupported_currency',
        supported: SUPPORTED_CURRENCIES,
      });
    }
    if (network !== undefined && typeof network !== 'string') {
      return reply.code(400).send({ error: 'network must be a string' });
    }

    try {
      return await createDeposit({
        userId: identity.userId,
        amount,
        currency,
        network,
      });
    } catch (err) {
      return replyForPaymentError(err, reply, req);
    }
  });

  app.post<{
    Body: { amount?: string; currency?: string; address?: string; network?: string };
  }>('/api/payments/withdraw', async (req, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });

    const { amount, currency, address, network } = req.body ?? {};

    if (!isValidAmount(amount)) {
      return reply
        .code(400)
        .send({ error: 'amount must be a positive decimal string (max 8 dp)' });
    }
    if (!isSupportedCurrency(currency)) {
      return reply.code(400).send({
        error: 'unsupported_currency',
        supported: SUPPORTED_CURRENCIES,
      });
    }
    if (!isPlausibleAddress(address)) {
      return reply.code(400).send({ error: 'invalid_address' });
    }
    if (network !== undefined && typeof network !== 'string') {
      return reply.code(400).send({ error: 'network must be a string' });
    }

    try {
      return await createWithdrawal({
        userId: identity.userId,
        amount,
        currency,
        address,
        network,
      });
    } catch (err) {
      return replyForPaymentError(err, reply, req);
    }
  });

  // ── Provider webhook ──
  //
  // Always answers 200 once the signature checks out, even for an invoice we do
  // not recognise. Cryptomus retries any non-2xx, and retrying a callback we
  // will never be able to match is pointless noise. A bad signature gets a 403
  // and is logged — that is either a misconfiguration or a forgery attempt.
  app.post<{ Body: Record<string, unknown> }>(
    '/api/payments/webhook',
    async (req, reply) => {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        return reply.code(400).send({ error: 'invalid_body' });
      }

      try {
        const result = await handleWebhook(body);

        if (result.credited) {
          pushBalanceToUser(result.credited.userId, result.credited.balance);
          req.log.info(
            {
              userId: result.credited.userId,
              amount: result.credited.amount,
            },
            'deposit credited'
          );
        }

        return reply.code(200).send({ received: true, handled: result.handled });
      } catch (err) {
        if (err instanceof InvalidSignatureError) {
          req.log.warn({ ip: req.ip }, 'rejected payment webhook with bad signature');
          return reply.code(403).send({ error: 'invalid_signature' });
        }
        if (err instanceof PaymentConfigError) {
          req.log.error('payment webhook received but Cryptomus is not configured');
          return reply.code(503).send({ error: 'payments_unavailable' });
        }
        // Genuine server-side failure: 500 so the provider redelivers and the
        // deposit is not silently dropped.
        req.log.error({ err }, 'payment webhook processing failed');
        return reply.code(500).send({ error: 'webhook_processing_failed' });
      }
    }
  );

  // ── Sandbox endpoints ──
  //
  // Registered only outside production. These credit and debit real balances
  // with no gateway and no verification, so in production they must not exist
  // as routes at all — a 404 is the only safe behaviour for an endpoint that
  // mints money.
  if (config.mockPaymentsEnabled) {
    registerMockRoutes(app);
    app.log.warn(
      'sandbox payment endpoints are ENABLED (NODE_ENV is not production) — ' +
        '/api/payments/mock-deposit and /api/payments/mock-withdraw credit real balances'
    );
  }

  app.get('/api/payments/config', async () => ({
    sandbox: config.mockPaymentsEnabled,
    currencies: SUPPORTED_CURRENCIES,
  }));

  app.get('/api/payments/history', async (req, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });

    const [deposits, withdrawals] = await Promise.all([
      listDeposits(identity.userId),
      listWithdrawals(identity.userId),
    ]);

    return { deposits, withdrawals };
  });
}

function registerMockRoutes(app: FastifyInstance) {
  app.post<{ Body: { amount?: string; currency?: string } }>(
    '/api/payments/mock-deposit',
    async (req, reply) => {
      const identity = identityFromRequest(req);
      if (!identity) return reply.code(401).send({ error: 'unauthorized' });

      const amount = req.body?.amount ?? '50';
      const currency = req.body?.currency;

      if (!isValidAmount(amount)) {
        return reply.code(400).send({ error: 'amount must be a positive decimal string' });
      }
      if (Number(amount) > MOCK_MAX_AMOUNT) {
        return reply
          .code(400)
          .send({ error: 'amount_too_large', max: String(MOCK_MAX_AMOUNT) });
      }
      if (currency !== undefined && !isSupportedCurrency(currency)) {
        return reply.code(400).send({ error: 'unsupported_currency' });
      }

      try {
        const result = await mockDeposit({
          userId: identity.userId,
          amount,
          currency,
        });

        pushBalanceToUser(identity.userId, result.balance);
        req.log.info(
          { userId: identity.userId, amount: result.amount },
          'sandbox deposit credited'
        );

        return { sandbox: true, ...result };
      } catch (err) {
        return replyForPaymentError(err, reply, req);
      }
    }
  );

  app.post<{ Body: { amount?: string; currency?: string; address?: string } }>(
    '/api/payments/mock-withdraw',
    async (req, reply) => {
      const identity = identityFromRequest(req);
      if (!identity) return reply.code(401).send({ error: 'unauthorized' });

      const { amount, currency, address } = req.body ?? {};

      if (!isValidAmount(amount)) {
        return reply.code(400).send({ error: 'amount must be a positive decimal string' });
      }
      if (currency !== undefined && !isSupportedCurrency(currency)) {
        return reply.code(400).send({ error: 'unsupported_currency' });
      }

      try {
        const result = await mockWithdraw({
          userId: identity.userId,
          amount,
          currency,
          address: typeof address === 'string' ? address : undefined,
        });

        pushBalanceToUser(identity.userId, result.balance);
        req.log.info(
          { userId: identity.userId, amount: result.amount },
          'sandbox withdrawal settled'
        );

        return { sandbox: true, ...result };
      } catch (err) {
        return replyForPaymentError(err, reply, req);
      }
    }
  );
}

function replyForPaymentError(
  err: unknown,
  reply: FastifyReply,
  req: FastifyRequest
) {
  if (err instanceof InsufficientFundsError) {
    return reply.code(409).send({ error: 'insufficient_funds' });
  }
  if (err instanceof AccountFrozenError) {
    return reply.code(409).send({ error: 'account_frozen' });
  }
  if (err instanceof WalletNotFoundError) {
    return reply.code(404).send({ error: 'wallet_not_found' });
  }
  if (err instanceof PaymentConfigError) {
    req.log.error('payment attempted but Cryptomus credentials are missing');
    return reply.code(503).send({ error: 'payments_unavailable' });
  }
  if (err instanceof PaymentProviderError) {
    req.log.error({ err }, 'cryptomus request failed');
    return reply.code(502).send({ error: 'provider_error', detail: err.message });
  }
  throw err;
}
