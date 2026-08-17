/**
 * FRIGAT — Payment routes
 *
 *   POST /api/payments/deposit              open an invoice          (player JWT)
 *   POST /api/payments/withdraw             request a payout         (player JWT)
 *   POST /api/payments/webhook              Cryptomus status update  (MD5 sign)
 *   POST /api/payments/nowpayments/webhook  NOWPayments IPN          (HMAC-SHA512)
 *   GET  /api/payments/history              own deposits/withdrawals (player JWT)
 *   GET  /api/payments/config               supported deposit currencies
 *
 * Deposits open against whichever gateway `config.paymentsProvider` names, but
 * BOTH callbacks stay registered: invoices opened before a provider switch must
 * still be able to settle from the gateway that created them.
 *
 * Both webhooks are deliberately unauthenticated in the JWT sense — a payment
 * gateway has no session and cannot present one. The signature *is* the
 * credential, and it is checked before the body is trusted for anything.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  NowPaymentsError,
  verifyIpnSignature,
} from '../services/nowpayments.service';
import { identityFromRequest } from '../http/auth';
import { pushBalanceToUser } from '../websocket/socket.server';
import {
  createDeposit,
  createWithdrawal,
  handleWebhook,
  handleNowPaymentsIpn,
  isSupportedCurrency,
  listDeposits,
  listWithdrawals,
  SUPPORTED_CURRENCIES,
  AccountFrozenError,
  InsufficientFundsError,
  InvalidSignatureError,
  PaymentConfigError,
  PaymentProviderError,
  WalletNotFoundError,
} from '../services/payment.service';


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
      const result = await createWithdrawal({
        userId: identity.userId,
        amount,
        currency,
        address,
        network,
      });

      // The stake is already reserved, so the header must stop showing money
      // the player can no longer spend. The socket frame is what useBalance
      // listens to — returning the balance in this body alone would leave the
      // header stale until the next game event.
      pushBalanceToUser(identity.userId, result.balance);
      req.log.info(
        {
          userId: identity.userId,
          withdrawalId: result.withdrawalId,
          amount: result.amount,
          awaitingReview: result.review === true,
        },
        result.review
          ? 'withdrawal reserved and queued for admin review'
          : 'withdrawal reserved and dispatched'
      );

      return {
        success: true,
        message: result.review
          ? 'Withdrawal request submitted for review.'
          : 'Withdrawal request submitted.',
        // The details stay on the response: the modal shows the reserved amount
        // and the balance left, and a client that only reads `success` is free
        // to ignore them.
        ...result,
      };
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

  // ── NOWPayments IPN ──
  //
  // Separate from the Cryptomus webhook above because the two sign differently:
  // Cryptomus puts a `sign` field in the body, NOWPayments sends an HMAC-SHA512
  // of the sorted body in `x-nowpayments-sig`. One route trying to guess which
  // scheme applies is a route that can be talked into checking the weaker one.
  app.post<{ Body: Record<string, unknown> }>(
    '/api/payments/nowpayments/webhook',
    async (req, reply) => {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        return reply.code(400).send({ error: 'invalid_body' });
      }

      let authentic: boolean;
      try {
        authentic = verifyIpnSignature(body, req.headers['x-nowpayments-sig']);
      } catch (err) {
        req.log.error({ err }, 'NOWPayments IPN received but no IPN secret is configured');
        return reply.code(503).send({ error: 'payments_unavailable' });
      }

      if (!authentic) {
        req.log.warn({ ip: req.ip }, 'rejected NOWPayments IPN with bad signature');
        return reply.code(403).send({ error: 'invalid_signature' });
      }

      try {
        const result = await handleNowPaymentsIpn(body);

        if (result.credited) {
          pushBalanceToUser(result.credited.userId, result.credited.balance);
          req.log.info(
            { userId: result.credited.userId, amount: result.credited.amount },
            'deposit credited (nowpayments)'
          );
        }

        return reply.code(200).send({ received: true, handled: result.handled });
      } catch (err) {
        // 500 so NOWPayments redelivers rather than dropping a paid deposit.
        req.log.error({ err }, 'NOWPayments IPN processing failed');
        return reply.code(500).send({ error: 'webhook_processing_failed' });
      }
    }
  );

  // There are deliberately NO sandbox endpoints. Balances move only through a
  // verified gateway callback or an audited admin adjustment; an endpoint that
  // mints money on request is indistinguishable from a bug once it exists, and
  // gating it on NODE_ENV only moves the mistake one deploy away.

  app.get('/api/payments/config', async () => ({
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
  if (err instanceof NowPaymentsError) {
    // A credential or account problem at the gateway is ours to fix, not the
    // player's: log the provider's own wording, but answer with a generic
    // 503 rather than passing its 401/403 through — a payment gateway
    // rejecting *our* key must never surface as the player being forbidden.
    const credentialProblem = err.status === 401 || err.status === 403;
    if (credentialProblem) {
      req.log.error({ err }, 'NOWPayments rejected our API key — deposits are down');
      return reply.code(503).send({ error: 'payments_unavailable' });
    }
    req.log.error({ err }, 'nowpayments request failed');
    return reply.code(502).send({ error: 'provider_error', detail: err.message });
  }
  throw err;
}
