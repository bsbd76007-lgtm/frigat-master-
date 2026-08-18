import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Prisma, Role } from '@prisma/client';

import { prisma } from '../config/prisma';
import {
  processBet,
  processWin,
  getBalance,
  InsufficientFundsError,
  AccountFrozenError,
} from '../services/ledger.service';

/**
 * Ledger invariants.
 *
 * These are the assertions worth having: every one describes a way the house
 * or the player loses money that a type checker cannot see. They run against a
 * real Postgres because the guarantees under test — atomic debits, unique
 * constraints, transaction rollback — are the database's, not the code's.
 */

let userId: string;

async function seedPlayer(balance: string, opts: { frozen?: boolean } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `p-${Math.random().toString(16).slice(2)}@test.local`,
      passwordHash: 'x',
      role: Role.USER,
      frozen: opts.frozen ?? false,
      wallets: { create: { currency: 'USD', balance: new Prisma.Decimal(balance) } },
    },
    select: { id: true },
  });
  return user.id;
}

beforeEach(async () => {
  userId = await seedPlayer('100');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('processBet', () => {
  it('debits exactly once and reports the new balance', async () => {
    const result = await processBet({ userId, amount: '25', gameType: 'DICE' });
    expect(result.balance).toBe('75');
    expect(await getBalance(userId)).toBe('75');
  });

  it('refuses a bet larger than the balance', async () => {
    await expect(
      processBet({ userId, amount: '100.00000001', gameType: 'DICE' })
    ).rejects.toBeInstanceOf(InsufficientFundsError);
    expect(await getBalance(userId)).toBe('100');
  });

  it('refuses a frozen account', async () => {
    const frozen = await seedPlayer('100', { frozen: true });
    await expect(
      processBet({ userId: frozen, amount: '1', gameType: 'DICE' })
    ).rejects.toBeInstanceOf(AccountFrozenError);
    expect(await getBalance(frozen)).toBe('100');
  });

  /**
   * The one that matters. Ten simultaneous bets of 20 against a balance of
   * 100: exactly five may win. A read-then-write debit would let more through
   * and drive the wallet negative — the classic way a casino pays out money it
   * never held.
   */
  it('cannot be raced into an overdraft', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () => processBet({ userId, amount: '20', gameType: 'DICE' }))
    );

    const accepted = attempts.filter((a) => a.status === 'fulfilled').length;
    const rejected = attempts.filter((a) => a.status === 'rejected').length;

    expect(accepted).toBe(5);
    expect(rejected).toBe(5);
    expect(await getBalance(userId)).toBe('0');
  });

  it('never leaves a negative balance, whatever the race', async () => {
    await Promise.allSettled(
      Array.from({ length: 25 }, () => processBet({ userId, amount: '7', gameType: 'DICE' }))
    );
    const balance = new Prisma.Decimal(await getBalance(userId));
    expect(balance.greaterThanOrEqualTo(0)).toBe(true);
  });

  it('writes one BET row per accepted debit, and none per rejection', async () => {
    await Promise.allSettled(
      Array.from({ length: 10 }, () => processBet({ userId, amount: '20', gameType: 'DICE' }))
    );
    const bets = await prisma.transaction.count({
      where: { wallet: { userId }, type: 'BET' },
    });
    expect(bets).toBe(5);
  });
});

describe('processWin', () => {
  it('credits the payout once', async () => {
    const bet = await processBet({ userId, amount: '10', gameType: 'DICE' });
    await processWin({ userId, betId: bet.transactionId, payoutAmount: '30' });
    expect(await getBalance(userId)).toBe('120');
  });

  /**
   * A settlement retried after a timeout must not pay twice. The guard is a
   * unique txHash of `win:<betId>`; this proves the second call is a no-op
   * rather than a second credit.
   */
  it('is idempotent when the same bet settles twice', async () => {
    const bet = await processBet({ userId, amount: '10', gameType: 'DICE' });

    await processWin({ userId, betId: bet.transactionId, payoutAmount: '30' });
    await processWin({ userId, betId: bet.transactionId, payoutAmount: '30' });

    expect(await getBalance(userId)).toBe('120');
    expect(
      await prisma.transaction.count({ where: { wallet: { userId }, type: 'WIN' } })
    ).toBe(1);
  });

  it('is idempotent even when both settlements land at once', async () => {
    const bet = await processBet({ userId, amount: '10', gameType: 'DICE' });

    await Promise.allSettled([
      processWin({ userId, betId: bet.transactionId, payoutAmount: '30' }),
      processWin({ userId, betId: bet.transactionId, payoutAmount: '30' }),
    ]);

    expect(
      await prisma.transaction.count({ where: { wallet: { userId }, type: 'WIN' } })
    ).toBe(1);
    expect(await getBalance(userId)).toBe('120');
  });
});
