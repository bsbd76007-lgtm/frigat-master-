/**
 * FRIGAT — Ledger Service
 *
 * The ONLY place balances are mutated. Every mutation runs inside
 * prisma.$transaction and is paired with a Transaction ledger row, so the
 * wallet balance and the transaction history can never diverge.
 *
 * Concurrency safety:
 *   Debits use a *guarded* updateMany — `where: { balance: { gte: amount } }`.
 *   Postgres evaluates the predicate and the decrement atomically, so two
 *   concurrent bets can never drive a balance negative (no double-spend),
 *   even under Read Committed isolation and without explicit row locks.
 */

import { Prisma, TransactionType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { recordPlay } from './streak.service';
import { auditWithin } from './audit.service';
import { assertWagerAllowed } from './riskConfig.service';

const D = Prisma.Decimal;

export class InsufficientFundsError extends Error {
  constructor() {
    super('Insufficient funds');
    this.name = 'InsufficientFundsError';
  }
}

export class WalletNotFoundError extends Error {
  constructor() {
    super('Wallet not found');
    this.name = 'WalletNotFoundError';
  }
}

export class AccountFrozenError extends Error {
  constructor() {
    super('Account is frozen');
    this.name = 'AccountFrozenError';
  }
}

function toAmount(amount: string | number, field = 'amount'): Prisma.Decimal {
  let dec: Prisma.Decimal;
  try {
    dec = new D(amount);
  } catch {
    throw new Error(`ledger: invalid ${field}`);
  }
  if (!dec.isFinite() || dec.lessThanOrEqualTo(0)) {
    throw new Error(`ledger: ${field} must be a positive finite number`);
  }
  return dec;
}

export interface ProcessBetInput {
  userId: string;
  amount: string; // decimal string
  gameType: string;
  currency?: string;
}

export interface ProcessBetResult {
  transactionId: string;
  walletId: string;
  balance: string; // new balance after debit
}

/**
 * Atomically debits a bet stake.
 * Throws InsufficientFundsError if balance < amount (no partial state written).
 */
export async function processBet(
  input: ProcessBetInput
): Promise<ProcessBetResult> {
  const currency = input.currency ?? 'USD';
  const amount = toAmount(input.amount, 'bet amount');

  // Maintenance mode + per-game caps, read from the runtime risk config.
  await assertWagerAllowed(input.gameType, amount);

  const result = await prisma.$transaction(async (tx) => {
    // Freeze is enforced here because this is the single gate every wager
    // passes through, whatever the game. Checking it in the socket layer alone
    // would leave a connection opened before the freeze able to keep betting.
    const account = await tx.user.findUnique({
      where: { id: input.userId },
      select: { frozen: true },
    });
    if (account?.frozen) throw new AccountFrozenError();

    const wallet = await tx.wallet.findUnique({
      where: { userId_currency: { userId: input.userId, currency } },
      select: { id: true },
    });
    if (!wallet) throw new WalletNotFoundError();

    // Guarded atomic debit — only succeeds if funds are sufficient.
    const debited = await tx.wallet.updateMany({
      where: { id: wallet.id, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });

    if (debited.count !== 1) {
      // Predicate failed → insufficient funds. Transaction rolls back cleanly.
      throw new InsufficientFundsError();
    }

    const bet = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.BET,
        amount,
        status: 'COMPLETED',
      },
      select: { id: true },
    });

    const updated = await tx.wallet.findUniqueOrThrow({
      where: { id: wallet.id },
      select: { balance: true },
    });

    return {
      transactionId: bet.id,
      walletId: wallet.id,
      balance: updated.balance.toString(),
    };
  });

  // Streak is recorded after the debit commits, and only for real wagers.
  // STREAK_RESTORE routes through this same gate so it inherits the freeze and
  // funds checks — but paying to restore a streak is not playing, and counting
  // it would let a player buy a streak day outright.
  //
  // Deliberately not awaited into the caller's path: the stake is already
  // taken and the round is live, so a streak bookkeeping failure must not
  // surface as a failed bet. It is idempotent per day, so a lost update
  // self-corrects on the player's next wager.
  if (input.gameType !== 'STREAK_RESTORE') {
    void recordPlay(input.userId).catch(() => {
      /* streak accounting is not worth failing a settled wager over */
    });
  }

  return result;
}

export interface ProcessWinInput {
  userId: string;
  betId: string; // the originating BET transaction id (for traceability/idempotency)
  payoutAmount: string; // decimal string, > 0
  currency?: string;
}

export interface ProcessWinResult {
  transactionId: string;
  balance: string;
}

/**
 * Atomically credits a payout in its own isolated transaction.
 *
 * Idempotency: keyed off the originating betId via the (unique) txHash column,
 * so a retried or duplicated settlement credits the wallet at most once.
 */
export async function processWin(
  input: ProcessWinInput
): Promise<ProcessWinResult> {
  const currency = input.currency ?? 'USD';
  const payout = toAmount(input.payoutAmount, 'payout amount');
  const idempotencyKey = `win:${input.betId}`;

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({
      where: { userId_currency: { userId: input.userId, currency } },
      select: { id: true, balance: true },
    });
    if (!wallet) throw new WalletNotFoundError();

    // Idempotency guard: if this win was already recorded, return current state.
    const existing = await tx.transaction.findUnique({
      where: { txHash: idempotencyKey },
      select: { id: true },
    });
    if (existing) {
      return {
        transactionId: existing.id,
        balance: wallet.balance.toString(),
      };
    }

    const win = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.WIN,
        amount: payout,
        status: 'COMPLETED',
        txHash: idempotencyKey,
      },
      select: { id: true },
    });

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: payout } },
      select: { balance: true },
    });

    return { transactionId: win.id, balance: updated.balance.toString() };
  });
}

export interface AwardBonusInput {
  userId: string;
  amount: string;
  currency?: string;
}

export interface AwardBonusResult {
  transactionId: string;
  balance: string;
}

export async function awardBonus(
  input: AwardBonusInput
): Promise<AwardBonusResult> {
  const currency = input.currency ?? 'USD';
  const amount = toAmount(input.amount, 'bonus amount');

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { userId_currency: { userId: input.userId, currency } },
      update: {},
      create: { userId: input.userId, currency, balance: new D(0) },
      select: { id: true },
    });

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: amount } },
      select: { balance: true },
    });

    const bonusTx = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.DEPOSIT,
        amount,
        status: 'COMPLETED',
        txHash: `bonus:${input.userId}:${Date.now()}:${Math.random()
          .toString(36)
          .slice(2, 10)}`,
      },
      select: { id: true },
    });

    return { transactionId: bonusTx.id, balance: updated.balance.toString() };
  });
}

export interface TransferBetweenUsersInput {
  fromUserId: string;
  toUserId: string;
  amount: string;
  currency?: string;
}

export interface TransferBetweenUsersResult {
  fromBalance: string;
  toBalance: string;
}

/**
 * Credits daily streak cashback.
 *
 * Separate from `awardBonus` only in the transaction type it writes:
 * BONUS_CASHBACK is what the once-a-day guard in streak.routes matches on, and
 * keeping it distinct from DEPOSIT stops bonus credits inflating deposit
 * reporting with money that never entered the platform.
 */
export async function creditCashback(
  input: AwardBonusInput
): Promise<AwardBonusResult> {
  const currency = input.currency ?? 'USD';
  const amount = toAmount(input.amount, 'cashback amount');

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { userId_currency: { userId: input.userId, currency } },
      update: {},
      create: { userId: input.userId, currency, balance: new D(0) },
      select: { id: true },
    });

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: amount } },
      select: { balance: true },
    });

    const row = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.BONUS_CASHBACK,
        amount,
        status: 'COMPLETED',
        txHash: `cashback:${input.userId}:${Date.now()}`,
      },
      select: { id: true },
    });

    return { transactionId: row.id, balance: updated.balance.toFixed(8) };
  });
}

export async function transferBetweenUsers(
  input: TransferBetweenUsersInput
): Promise<TransferBetweenUsersResult> {
  const currency = input.currency ?? 'USD';
  const amount = toAmount(input.amount, 'transfer amount');

  return prisma.$transaction(async (tx) => {
    const fromWallet = await tx.wallet.findUnique({
      where: { userId_currency: { userId: input.fromUserId, currency } },
      select: { id: true, balance: true },
    });
    if (!fromWallet) throw new WalletNotFoundError();

    const toWallet = await tx.wallet.upsert({
      where: { userId_currency: { userId: input.toUserId, currency } },
      update: {},
      create: { userId: input.toUserId, currency, balance: new D(0) },
      select: { id: true },
    });

    const debited = await tx.wallet.updateMany({
      where: { id: fromWallet.id, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    if (debited.count !== 1) {
      throw new InsufficientFundsError();
    }

    await tx.transaction.create({
      data: {
        walletId: fromWallet.id,
        type: TransactionType.WITHDRAWAL,
        amount,
        status: 'COMPLETED',
        txHash: `tip:${input.fromUserId}:${input.toUserId}:${Date.now()}:${Math.random()
          .toString(36)
          .slice(2, 10)}`,
      },
    });

    const updatedTo = await tx.wallet.update({
      where: { id: toWallet.id },
      data: { balance: { increment: amount } },
      select: { balance: true },
    });

    const updatedFrom = await tx.wallet.findUniqueOrThrow({
      where: { id: fromWallet.id },
      select: { balance: true },
    });

    await tx.transaction.create({
      data: {
        walletId: toWallet.id,
        type: TransactionType.DEPOSIT,
        amount,
        status: 'COMPLETED',
        txHash: `tip:${input.fromUserId}:${input.toUserId}:${Date.now()}:${Math.random()
          .toString(36)
          .slice(2, 10)}`,
      },
    });

    return {
      fromBalance: updatedFrom.balance.toString(),
      toBalance: updatedTo.balance.toString(),
    };
  });
}

// ─────────────────────────────────────────────
// RevShare referral engine
// ─────────────────────────────────────────────

export interface SettleAffiliateRewardInput {
  /** The player whose bet just settled (the downline). */
  userId: string;
  /** Originating BET transaction id — the idempotency key for this reward. */
  betId: string;
  /** Stake that was debited, decimal string. */
  stake: string;
  /** Amount credited back, decimal string. Omit or '0' for a total loss. */
  payout?: string;
  currency?: string;
}

export interface AffiliateRewardResult {
  transactionId: string;
  referrerId: string;
  /** Reward credited, 8dp decimal string. */
  amount: string;
  /** Referrer's affiliateBalance after the credit. */
  affiliateBalance: string;
  /** True when this betId had already paid out and nothing changed. */
  replayed: boolean;
}

/**
 * Pays a referrer their RevShare cut of a downline's *net* loss.
 *
 * Net loss is stake − payout, so a bet that returned more than it cost earns
 * the referrer nothing; there is no reward on a winning or break-even bet.
 * Returns null whenever nothing is owed — no referrer, a net win, or a cut that
 * rounds to zero — so the caller can treat "not applicable" and "paid" alike.
 *
 * Idempotent on `betId` via the unique txHash column, matching processWin. A
 * replayed settlement therefore reports the original reward instead of paying
 * the referrer a second time.
 *
 * The reward is *not* debited from anyone. It is platform revenue share, so it
 * is minted against the house the same way a WIN is, and lands in the
 * referrer's `affiliateBalance` rather than their wagerable `balance`.
 */
export async function settleAffiliateReward(
  input: SettleAffiliateRewardInput
): Promise<AffiliateRewardResult | null> {
  const currency = input.currency ?? 'USD';
  const stake = toAmount(input.stake, 'stake');
  const payout = input.payout ? new D(input.payout) : new D(0);
  if (!payout.isFinite() || payout.lessThan(0)) {
    throw new Error('ledger: payout must be a non-negative finite number');
  }

  const netLoss = stake.minus(payout);
  if (netLoss.lessThanOrEqualTo(0)) return null; // won or broke even

  const idempotencyKey = `affiliate:${input.betId}`;

  const attempt = () => prisma.$transaction(async (tx) => {
    const player = await tx.user.findUnique({
      where: { id: input.userId },
      select: { referredById: true },
    });
    const referrerId = player?.referredById;
    if (!referrerId) return null;

    // A self-referral would pay a user for losing their own money. Registration
    // already rejects it; this is the backstop for rows written another way.
    if (referrerId === input.userId) return null;

    const existing = await tx.transaction.findUnique({
      where: { txHash: idempotencyKey },
      select: {
        id: true,
        amount: true,
        wallet: { select: { userId: true, affiliateBalance: true } },
      },
    });
    if (existing) {
      return {
        transactionId: existing.id,
        referrerId: existing.wallet.userId,
        amount: existing.amount.toFixed(8),
        affiliateBalance: existing.wallet.affiliateBalance.toString(),
        replayed: true,
      };
    }

    const referrer = await tx.user.findUnique({
      where: { id: referrerId },
      select: { revSharePercentage: true },
    });
    // Referrer deleted between the bet and its settlement — nothing to pay.
    if (!referrer) return null;

    const pct = referrer.revSharePercentage;
    if (pct.lessThanOrEqualTo(0)) return null;

    // ROUND_DOWN, matching payoutOf: the platform never pays out a fraction it
    // did not earn, and repeated rewards can't drift upward a satoshi at a time.
    const reward = netLoss
      .mul(pct)
      .dividedBy(100)
      .toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
    if (reward.lessThanOrEqualTo(0)) return null; // dust — below 1e-8

    // Created on demand: a referrer who has never funded an account still has
    // earnings to collect, and must not lose them for want of a wallet row.
    const wallet = await tx.wallet.upsert({
      where: { userId_currency: { userId: referrerId, currency } },
      update: {},
      create: { userId: referrerId, currency, balance: new D(0) },
      select: { id: true },
    });

    const credited = await tx.wallet.update({
      where: { id: wallet.id },
      data: { affiliateBalance: { increment: reward } },
      select: { affiliateBalance: true },
    });

    const record = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.AFFILIATE_REWARD,
        amount: reward,
        status: 'COMPLETED',
        txHash: idempotencyKey,
      },
      select: { id: true },
    });

    return {
      transactionId: record.id,
      referrerId,
      amount: reward.toFixed(8),
      affiliateBalance: credited.affiliateBalance.toString(),
      replayed: false,
    };
  });

  try {
    return await attempt();
  } catch (err) {
    // Two settlements of the same bet raced: both read no existing row, both
    // inserted, and Postgres rejected the loser on the unique txHash index.
    // The reward *was* credited exactly once, so retry to read it back rather
    // than surfacing a constraint error for a correctly-handled duplicate.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return attempt();
    }
    throw err;
  }
}

export class NothingToClaimError extends Error {
  constructor() {
    super('No affiliate earnings to claim');
    this.name = 'NothingToClaimError';
  }
}

export interface ClaimAffiliateResult {
  transactionId: string;
  /** Amount swept, 8dp decimal string. */
  claimed: string;
  /** Wagerable balance after the sweep. */
  balance: string;
  /** Always '0' — the sweep is all-or-nothing. */
  affiliateBalance: string;
}

/**
 * Sweeps accrued RevShare earnings into the affiliate's wagerable balance.
 *
 * Not a deposit: no money enters the platform, it moves between two columns of
 * one wallet, so it is recorded as AFFILIATE_CLAIM.
 *
 * Concurrency: the decrement is a guarded updateMany on the *exact* amount read
 * (`affiliateBalance: { gte: amount }`), and the credit is derived from the
 * rows actually updated. Two simultaneous claims therefore cannot both sweep
 * the same earnings — the loser's predicate fails and it sees NothingToClaim
 * rather than double-crediting.
 *
 * Frozen accounts may still claim: a freeze stops wagering, and the money is
 * already the affiliate's. It simply becomes unspendable like the rest of
 * their balance.
 */
export async function claimAffiliateEarnings(input: {
  userId: string;
  currency?: string;
}): Promise<ClaimAffiliateResult> {
  const currency = input.currency ?? 'USD';

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({
      where: { userId_currency: { userId: input.userId, currency } },
      select: { id: true, affiliateBalance: true },
    });
    if (!wallet) throw new WalletNotFoundError();

    const amount = wallet.affiliateBalance;
    if (amount.lessThanOrEqualTo(0)) throw new NothingToClaimError();

    // Guarded: only sweeps if the full amount is still sitting there.
    const swept = await tx.wallet.updateMany({
      where: { id: wallet.id, affiliateBalance: { gte: amount } },
      data: {
        affiliateBalance: { decrement: amount },
        balance: { increment: amount },
      },
    });
    if (swept.count !== 1) throw new NothingToClaimError();

    const record = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.AFFILIATE_CLAIM,
        amount,
        status: 'COMPLETED',
      },
      select: { id: true },
    });

    const updated = await tx.wallet.findUniqueOrThrow({
      where: { id: wallet.id },
      select: { balance: true, affiliateBalance: true },
    });

    return {
      transactionId: record.id,
      claimed: amount.toFixed(8),
      balance: updated.balance.toString(),
      affiliateBalance: updated.affiliateBalance.toString(),
    };
  });
}

/** Convenience read used by socket handlers to sync balance to the client. */
export async function getBalance(
  userId: string,
  currency = 'USD'
): Promise<string> {
  const wallet = await prisma.wallet.findUnique({
    where: { userId_currency: { userId, currency } },
    select: { balance: true },
  });
  if (!wallet) throw new WalletNotFoundError();
  return wallet.balance.toString();
}

// ─────────────────────────────────────────────
// Administrative adjustments
// ─────────────────────────────────────────────

export interface AdjustBalanceInput {
  userId: string;
  /** Positive decimal string; `direction` decides the sign. */
  amount: string;
  direction: 'CREDIT' | 'DEBIT';
  currency?: string;
  /**
   * Caller-supplied key making the write idempotent. A double-submitted form
   * or a retried request must not move money twice.
   */
  idempotencyKey: string;
  /**
   * Who is doing this and why. Written inside the SAME transaction as the
   * money movement, so an adjustment can never commit unaudited.
   */
  audit: { adminId: string; reason: string };
}

export interface AdjustBalanceResult {
  transactionId: string;
  balance: string;
  /** True when the key had already been applied and nothing changed. */
  replayed: boolean;
}

/**
 * Manual balance adjustment performed by an administrator.
 *
 * Recorded as a normal ledger Transaction (DEPOSIT for a credit, WITHDRAWAL for
 * a debit) so wallet balance and transaction history still reconcile — there is
 * no back door that mutates a balance without a paired row.
 *
 * A debit uses the same guarded updateMany as a bet, so an adjustment can never
 * drive a wallet negative. Frozen accounts are still adjustable on purpose:
 * freezing stops the player wagering, it must not stop an operator correcting
 * or refunding the account.
 */
export async function adjustBalance(
  input: AdjustBalanceInput
): Promise<AdjustBalanceResult> {
  const currency = input.currency ?? 'USD';
  const amount = toAmount(input.amount, 'adjustment amount');
  const idempotencyKey = `adj:${input.idempotencyKey}`;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findUnique({
      where: { txHash: idempotencyKey },
      select: { id: true, wallet: { select: { balance: true } } },
    });
    if (existing) {
      return {
        transactionId: existing.id,
        balance: existing.wallet.balance.toString(),
        replayed: true,
      };
    }

    // Create the wallet on demand so a credit can bootstrap a new account.
    const wallet = await tx.wallet.upsert({
      where: { userId_currency: { userId: input.userId, currency } },
      update: {},
      create: { userId: input.userId, currency, balance: new D(0) },
      select: { id: true },
    });

    if (input.direction === 'DEBIT') {
      const debited = await tx.wallet.updateMany({
        where: { id: wallet.id, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });
      if (debited.count !== 1) throw new InsufficientFundsError();
    } else {
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: amount } },
      });
    }

    const record = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type:
          input.direction === 'CREDIT'
            ? TransactionType.DEPOSIT
            : TransactionType.WITHDRAWAL,
        amount,
        status: 'COMPLETED',
        txHash: idempotencyKey,
      },
      select: { id: true },
    });

    const updated = await tx.wallet.findUniqueOrThrow({
      where: { id: wallet.id },
      select: { balance: true },
    });

    // Same transaction as the balance change: both land, or neither does.
    await auditWithin(tx, {
      adminId: input.audit.adminId,
      action: 'BALANCE_ADJUSTED',
      targetUserId: input.userId,
      details: {
        amount: input.amount,
        direction: input.direction,
        reason: input.audit.reason,
        transactionId: record.id,
        balanceAfter: updated.balance.toString(),
      },
    });

    return {
      transactionId: record.id,
      balance: updated.balance.toString(),
      replayed: false,
    };
  });
}

// ─────────────────────────────────────────────
// Withdrawals
// ─────────────────────────────────────────────

export class WithdrawalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WithdrawalStateError';
  }
}

/**
 * Player-initiated withdrawal request.
 *
 * Funds are debited (reserved) at request time, not at approval. That is what
 * makes "Reject & Refund" coherent — and it stops a player wagering money that
 * is already queued to leave the platform.
 */
export async function requestWithdrawal(input: {
  userId: string;
  amount: string;
  currency?: string;
}): Promise<{ transactionId: string; balance: string }> {
  const currency = input.currency ?? 'USD';
  const amount = toAmount(input.amount, 'withdrawal amount');

  return prisma.$transaction(async (tx) => {
    const account = await tx.user.findUnique({
      where: { id: input.userId },
      select: { frozen: true },
    });
    if (account?.frozen) throw new AccountFrozenError();

    const wallet = await tx.wallet.findUnique({
      where: { userId_currency: { userId: input.userId, currency } },
      select: { id: true },
    });
    if (!wallet) throw new WalletNotFoundError();

    const debited = await tx.wallet.updateMany({
      where: { id: wallet.id, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    if (debited.count !== 1) throw new InsufficientFundsError();

    const record = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.WITHDRAWAL,
        amount,
        status: 'PENDING',
      },
      select: { id: true },
    });

    const updated = await tx.wallet.findUniqueOrThrow({
      where: { id: wallet.id },
      select: { balance: true },
    });

    return { transactionId: record.id, balance: updated.balance.toString() };
  });
}

/**
 * Approves a pending withdrawal. Funds already left the wallet at request time,
 * so this only settles the ledger row — no second debit.
 *
 * The status transition is a guarded updateMany on `status: PENDING`. Two admins
 * clicking Approve at the same moment therefore produce exactly one settlement;
 * the loser sees a WithdrawalStateError rather than double-paying.
 */
export async function approveWithdrawal(input: {
  transactionId: string;
  auditWithin: (
    tx: Prisma.TransactionClient,
    details: Record<string, unknown>
  ) => Promise<unknown>;
}): Promise<{ transactionId: string; status: 'COMPLETED' }> {
  return prisma.$transaction(async (tx) => {
    const settled = await tx.transaction.updateMany({
      where: {
        id: input.transactionId,
        type: TransactionType.WITHDRAWAL,
        status: 'PENDING',
      },
      data: { status: 'COMPLETED' },
    });
    if (settled.count !== 1) {
      throw new WithdrawalStateError('withdrawal is not pending');
    }

    const row = await tx.transaction.findUniqueOrThrow({
      where: { id: input.transactionId },
      select: { amount: true, wallet: { select: { userId: true } } },
    });

    await input.auditWithin(tx, {
      transactionId: input.transactionId,
      amount: row.amount.toFixed(8),
      targetUserId: row.wallet.userId,
      outcome: 'APPROVED',
    });

    return { transactionId: input.transactionId, status: 'COMPLETED' as const };
  });
}

/**
 * Rejects a pending withdrawal and returns the reserved funds to the wallet.
 *
 * Same guarded transition as approval, so a double-click cannot refund twice.
 */
export async function rejectWithdrawal(input: {
  transactionId: string;
  auditWithin: (
    tx: Prisma.TransactionClient,
    details: Record<string, unknown>
  ) => Promise<unknown>;
}): Promise<{ transactionId: string; status: 'FAILED'; refunded: string; balance: string }> {
  return prisma.$transaction(async (tx) => {
    const rejected = await tx.transaction.updateMany({
      where: {
        id: input.transactionId,
        type: TransactionType.WITHDRAWAL,
        status: 'PENDING',
      },
      data: { status: 'FAILED' },
    });
    if (rejected.count !== 1) {
      throw new WithdrawalStateError('withdrawal is not pending');
    }

    const row = await tx.transaction.findUniqueOrThrow({
      where: { id: input.transactionId },
      select: { amount: true, walletId: true, wallet: { select: { userId: true } } },
    });

    // Return the reserved funds in the same transaction as the status change.
    const wallet = await tx.wallet.update({
      where: { id: row.walletId },
      data: { balance: { increment: row.amount } },
      select: { balance: true },
    });

    // Paired ledger row so the refund is visible in the transaction history
    // rather than appearing as an unexplained balance jump.
    await tx.transaction.create({
      data: {
        walletId: row.walletId,
        type: TransactionType.DEPOSIT,
        amount: row.amount,
        status: 'COMPLETED',
        txHash: `refund:${input.transactionId}`,
      },
    });

    await input.auditWithin(tx, {
      transactionId: input.transactionId,
      amount: row.amount.toFixed(8),
      targetUserId: row.wallet.userId,
      outcome: 'REJECTED_AND_REFUNDED',
      balanceAfter: wallet.balance.toString(),
    });

    return {
      transactionId: input.transactionId,
      status: 'FAILED' as const,
      refunded: row.amount.toFixed(8),
      balance: wallet.balance.toString(),
    };
  });
}
