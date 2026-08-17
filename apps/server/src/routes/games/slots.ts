/**
 * FRIGAT — Slots REST route
 *
 * POST /api/games/slots/spin — authenticated, server-authoritative, one spin.
 *
 * ── Why this one is REST when the others are not ───────────────────────────
 * Every other instant game settles over the authenticated WebSocket (see
 * limbo.routes.ts for the reasoning). Slots is reachable both ways: the engine
 * is registered in INSTANT_ENGINES, so a SPIN frame over the socket settles
 * down the identical path, and this endpoint exists for callers that only speak
 * REST. Both routes converge on the same three primitives — processBet,
 * nextSeedContext, processWin — so there is exactly one place money moves.
 *
 * The catch REST creates is the header balance: `useBalance` on the client only
 * updates from BALANCE / BET_ACCEPTED / GAME_RESULT socket frames, by design.
 * So after settling, this route pushes the new balance down the player's own
 * socket via `pushBalanceToUser`. The HTTP response carries `newBalance` too —
 * for a REST-only client — but the browser's header updates because of the
 * push, not because the component wrote a number into a hook.
 *
 * ── Ordering ───────────────────────────────────────────────────────────────
 * Debit first, then draw. Resolving the spin before taking the stake would open
 * a window where a losing spin can be abandoned (dropped connection, closed
 * tab) after the outcome is known. The stake is committed before the seed nonce
 * is consumed, so an interrupted request is a settled loss, not a free look.
 */

import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';

import { identityFromRequest } from '../../http/auth';
import { prisma } from '../../config/prisma';
import {
  processBet,
  processWin,
  InsufficientFundsError,
  WalletNotFoundError,
  AccountFrozenError,
} from '../../services/ledger.service';
import { nextSeedContext } from '../../services/provableFair.service';
import { capPayout } from '../../services/riskConfig.service';
import { pushBalanceToUser } from '../../websocket/socket.server';
import { spin } from '../../engines/slots.engine';
import {
  BET_LIMITS,
  SLOTS_PAYLINES,
  SLOTS_PAYLINE_NAMES,
  SLOTS_PAYTABLE,
  SLOTS_REELS,
  SLOTS_ROWS,
  SLOTS_SYMBOLS,
} from '../../config/game.config';

const D = Prisma.Decimal;
const GAME_TYPE = 'SLOTS';

interface SpinBody {
  betAmount?: number | string;
  currency?: string;
}

/**
 * Normalises the stake to a decimal string, or explains why it cannot be.
 *
 * Accepts a number because that is what the documented payload sends, but it is
 * converted through Decimal immediately and every downstream step is a string —
 * a float stake would round against the 8dp ledger column.
 */
function parseStake(raw: unknown): { amount: string } | { error: string } {
  if (raw === undefined || raw === null || raw === '') {
    return { error: 'betAmount is required' };
  }
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    return { error: 'betAmount must be a number' };
  }
  if (typeof raw === 'number' && !Number.isFinite(raw)) {
    return { error: 'betAmount must be a finite number' };
  }

  let amount: Prisma.Decimal;
  try {
    amount = new D(raw);
  } catch {
    return { error: 'betAmount must be a number' };
  }
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    return { error: 'betAmount must be greater than zero' };
  }
  if (amount.lessThan(new D(BET_LIMITS.min))) {
    return { error: `betAmount is below the minimum of ${BET_LIMITS.min}` };
  }
  if (amount.greaterThan(new D(BET_LIMITS.max))) {
    return { error: `betAmount is above the maximum of ${BET_LIMITS.max}` };
  }

  return { amount: amount.toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN).toString() };
}

export function registerSlotsRoutes(app: FastifyInstance) {
  /**
   * Public configuration: symbols, weights-free paytable, paylines and limits.
   * The web client reads these from @frigat/shared at build time; this exists
   * for any other client, and for verifying a settled spin by hand.
   */
  app.get('/api/games/slots/config', async () => ({
    reels: SLOTS_REELS,
    rows: SLOTS_ROWS,
    symbols: SLOTS_SYMBOLS,
    paytable: SLOTS_PAYTABLE,
    paylines: SLOTS_PAYLINES,
    paylineNames: SLOTS_PAYLINE_NAMES,
    betLimits: BET_LIMITS,
  }));

  app.post<{ Body: SpinBody }>('/api/games/slots/spin', async (req, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });

    const stake = parseStake(req.body?.betAmount);
    if ('error' in stake) {
      return reply.code(400).send({ error: 'invalid_bet', message: stake.error });
    }
    const { amount } = stake;
    const currency = typeof req.body?.currency === 'string' ? req.body.currency : 'USD';
    const { userId } = identity;

    // 1) Debit the stake atomically. A guarded updateMany inside the ledger's
    //    transaction is what makes concurrent spins unable to overdraw.
    let bet;
    try {
      bet = await processBet({ userId, amount, gameType: GAME_TYPE, currency });
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        return reply
          .code(402)
          .send({ error: 'insufficient_funds', message: 'Not enough balance for this bet' });
      }
      if (err instanceof AccountFrozenError) {
        return reply
          .code(403)
          .send({ error: 'account_frozen', message: 'This account cannot place bets' });
      }
      if (err instanceof WalletNotFoundError) {
        return reply
          .code(404)
          .send({ error: 'wallet_not_found', message: 'No wallet for this currency' });
      }
      // Risk limits and malformed amounts land here. The stake was NOT taken:
      // processBet throws before or inside its transaction, so nothing committed.
      req.log.warn({ err, userId }, 'slots: bet rejected');
      return reply.code(400).send({
        error: 'bet_rejected',
        message: err instanceof Error ? err.message : 'Bet rejected',
      });
    }

    // 2) Resolve against a fresh, nonce-advanced seed.
    const seed = await nextSeedContext(userId);
    const result = spin({}, seed);
    const resultData = result.resultData as {
      reelMatrix: string[][];
      winningLines: Array<{
        lineIndex: number;
        symbol: string;
        count: number;
        multiplier: number;
        cells: Array<[number, number]>;
      }>;
      lineCount: number;
    };

    // 3) Credit the win, if any. Capped by the same risk policy every game uses.
    let balance = bet.balance;
    let payout = '0';
    if (result.win && result.multiplier > 0) {
      const raw = new D(amount)
        .mul(new D(result.multiplier))
        .toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
      const capped = await capPayout(GAME_TYPE, raw);
      payout = capped.payout.toString();

      if (capped.payout.greaterThan(0)) {
        const credited = await processWin({
          userId,
          betId: bet.transactionId,
          payoutAmount: payout,
          currency,
        });
        balance = credited.balance;
      }
    }

    // 4) Log the round for history, audit and fairness verification.
    const session = await prisma.gameSession.create({
      data: {
        userId,
        gameType: GAME_TYPE,
        betAmount: new D(amount),
        payout: new D(payout),
        multiplier: result.multiplier,
        serverSeed: seed.serverSeed,
        clientSeed: seed.clientSeed,
        nonce: seed.nonce,
        resultData: resultData as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    // 5) Keep the live header in sync. The socket is the only thing useBalance
    //    listens to, so a REST settlement has to announce itself.
    pushBalanceToUser(userId, balance);

    // Payouts are per-line multiples of the *total* stake, so the amounts here
    // sum to totalWin exactly — the client never has to re-derive money.
    const winningLines = resultData.winningLines.map((line) => ({
      lineIndex: line.lineIndex,
      symbol: line.symbol,
      count: line.count,
      cells: line.cells,
      payout: new D(amount)
        .mul(new D(line.multiplier))
        .toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN)
        .toString(),
    }));

    return {
      sessionId: session.id,
      reelMatrix: resultData.reelMatrix,
      winningLines,
      totalWin: payout,
      newBalance: balance,
      betAmount: amount,
      multiplier: result.multiplier,
      // The hash was published before this spin; the seed itself is revealed
      // only on rotation, so a live serverSeed never leaves the server.
      hashedServerSeed: seed.hashedServerSeed,
      clientSeed: seed.clientSeed,
      nonce: seed.nonce,
    };
  });
}
