/**
 * FRIGAT — Rewards: promo codes and the daily check-in.
 *
 * Both of these hand out real, wagerable money for something other than a
 * deposit, so both are written defensively:
 *
 *   - the *claim* is made with a conditional write, so two concurrent requests
 *     can never both succeed;
 *   - the credit runs through `awardBonus`, which moves the balance and writes
 *     the transaction row inside one `$transaction`;
 *   - the claim is committed **before** the credit, so a crash between them
 *     leaves an unpaid claim (recoverable, and visible in the logs) rather than
 *     a paid one that can be claimed again.
 *
 * The daily wheel is deliberately NOT here. It already exists in
 * `bonus.service.ts` keyed on `User.lastDailyWheelSpinAt`; a second
 * implementation with its own timestamp would let one player spin twice a day.
 */

import { Prisma } from '@prisma/client';

import { prisma } from '../config/prisma';
import { awardBonus } from './ledger.service';

// ─────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────

export class PromoNotFoundError extends Error {
  constructor() {
    super('promo: code not recognised');
    this.name = 'PromoNotFoundError';
  }
}

export class PromoUnavailableError extends Error {
  constructor(readonly reason: 'inactive' | 'expired' | 'exhausted') {
    super(`promo: code is ${reason}`);
    this.name = 'PromoUnavailableError';
  }
}

export class PromoAlreadyRedeemedError extends Error {
  constructor() {
    super('promo: already redeemed by this account');
    this.name = 'PromoAlreadyRedeemedError';
  }
}

export class AccountFrozenError extends Error {
  constructor() {
    super('rewards: account is frozen');
    this.name = 'AccountFrozenError';
  }
}

export class CheckInNotReadyError extends Error {
  constructor(readonly nextAvailableAt: Date) {
    super('rewards: already checked in today');
    this.name = 'CheckInNotReadyError';
  }
}

export class TaskNotVerifiableError extends Error {
  constructor(readonly taskId: string) {
    super(`rewards: task "${taskId}" cannot be verified server-side`);
    this.name = 'TaskNotVerifiableError';
  }
}

// ─────────────────────────────────────────────
// Promo codes
// ─────────────────────────────────────────────

/** Codes are case-insensitive; everything is compared uppercase. */
export function normalisePromoCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export interface PromoRedeemResult {
  code: string;
  amount: string;
  currency: string;
  balance: string;
}

/**
 * Redeems a code for a user.
 *
 * The interesting part is the reservation. `redemptionCount` is incremented
 * with a conditional `updateMany` that re-checks *every* limit in the predicate
 * — active, unexpired, and under the cap. Reading the row and then updating it
 * would leave a window where two requests both saw the last slot free.
 */
export async function redeemPromoCode(input: {
  userId: string;
  code: string;
}): Promise<PromoRedeemResult> {
  const code = normalisePromoCode(input.code);
  const now = new Date();

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { frozen: true },
  });
  if (!user) throw new PromoNotFoundError();
  if (user.frozen) throw new AccountFrozenError();

  const promo = await prisma.promoCode.findUnique({
    where: { code },
    select: {
      id: true,
      amount: true,
      currency: true,
      active: true,
      expiresAt: true,
      maxRedemptions: true,
      redemptionCount: true,
    },
  });
  if (!promo) throw new PromoNotFoundError();

  // Reported before the reservation purely so the player gets a useful reason.
  // The reservation re-checks all of it; this is a message, not a guard.
  if (!promo.active) throw new PromoUnavailableError('inactive');
  if (promo.expiresAt && promo.expiresAt <= now) throw new PromoUnavailableError('expired');
  if (promo.maxRedemptions !== null && promo.redemptionCount >= promo.maxRedemptions) {
    throw new PromoUnavailableError('exhausted');
  }

  // The per-user limit is the unique index on (promoCodeId, userId): the insert
  // below fails rather than this check having to be remembered.
  const existing = await prisma.promoRedemption.findUnique({
    where: { promoCodeId_userId: { promoCodeId: promo.id, userId: input.userId } },
    select: { id: true },
  });
  if (existing) throw new PromoAlreadyRedeemedError();

  // ── Reserve, then pay ──
  try {
    await prisma.$transaction(async (tx) => {
      const reserved = await tx.promoCode.updateMany({
        where: {
          id: promo.id,
          active: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          ...(promo.maxRedemptions === null
            ? {}
            : { redemptionCount: { lt: promo.maxRedemptions } }),
        },
        data: { redemptionCount: { increment: 1 } },
      });
      if (reserved.count !== 1) throw new PromoUnavailableError('exhausted');

      const row = await tx.promoRedemption.create({
        data: {
          promoCodeId: promo.id,
          userId: input.userId,
          amount: promo.amount,
        },
        select: { id: true },
      });
      return row.id;
    });
  } catch (err) {
    // A unique-constraint violation here is the per-user limit doing its job
    // against a racing duplicate request.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new PromoAlreadyRedeemedError();
    }
    throw err;
  }

  const credited = await awardBonus({
    userId: input.userId,
    amount: promo.amount.toString(),
    currency: promo.currency,
  });

  return {
    code,
    amount: promo.amount.toString(),
    currency: promo.currency,
    balance: credited.balance,
    // `redemptionId` is intentionally not returned: it is a receipt id the
    // player has no use for and support can find from the user id.
  } satisfies PromoRedeemResult & Record<string, unknown>;
}

// ─────────────────────────────────────────────
// Daily check-in
// ─────────────────────────────────────────────

/**
 * Reward ladder, in currency units, for consecutive check-in days.
 *
 * Caps at day 7 and then repeats: an unbounded ladder is an unbounded
 * liability, and by week two the number would be the reason to log in rather
 * than a reason to come back.
 */
export const CHECK_IN_LADDER = ['0.10', '0.15', '0.20', '0.30', '0.45', '0.65', '1.00'] as const;

export const CHECK_IN_STREAK_CAP = CHECK_IN_LADDER.length;

/** Midnight UTC of the day a timestamp falls in. */
function utcDay(at: Date): number {
  return Math.floor(at.getTime() / 86_400_000);
}

export function nextCheckInAt(last: Date | null | undefined): Date | null {
  if (!last) return null;
  if (utcDay(last) < utcDay(new Date())) return null;
  // Tomorrow, 00:00 UTC.
  return new Date((utcDay(last) + 1) * 86_400_000);
}

export interface CheckInStatus {
  available: boolean;
  streak: number;
  /** What the *next* check-in pays, whether or not it is available now. */
  nextReward: string;
  nextAvailableAt: string | null;
  ladder: readonly string[];
}

export async function getCheckInStatus(userId: string): Promise<CheckInStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastCheckInAt: true, checkInStreak: true },
  });
  if (!user) throw new PromoNotFoundError();

  const pending = nextCheckInAt(user.lastCheckInAt);
  const streakIfClaimed = projectStreak(user.lastCheckInAt, user.checkInStreak);

  return {
    available: pending === null,
    streak: user.checkInStreak,
    nextReward: CHECK_IN_LADDER[Math.min(streakIfClaimed, CHECK_IN_STREAK_CAP) - 1],
    nextAvailableAt: pending ? pending.toISOString() : null,
    ladder: CHECK_IN_LADDER,
  };
}

/**
 * What the streak becomes if the player checks in now.
 *
 * Consecutive means the previous check-in was *yesterday*. A gap of two or more
 * days restarts at 1 — otherwise a player who checked in once a month would
 * climb to the top of the ladder.
 */
function projectStreak(last: Date | null, current: number): number {
  if (!last) return 1;
  const gap = utcDay(new Date()) - utcDay(last);
  if (gap <= 0) return Math.max(1, current); // already claimed today
  if (gap === 1) return Math.min(current + 1, CHECK_IN_STREAK_CAP);
  return 1;
}

export interface CheckInResult {
  amount: string;
  streak: number;
  balance: string;
  nextAvailableAt: string;
}

export async function claimDailyCheckIn(userId: string): Promise<CheckInResult> {
  const now = new Date();
  const today = utcDay(now);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastCheckInAt: true, checkInStreak: true, frozen: true },
  });
  if (!user) throw new PromoNotFoundError();
  if (user.frozen) throw new AccountFrozenError();

  const pending = nextCheckInAt(user.lastCheckInAt);
  if (pending) throw new CheckInNotReadyError(pending);

  const streak = projectStreak(user.lastCheckInAt, user.checkInStreak);
  const amount = CHECK_IN_LADDER[streak - 1];

  // Atomic claim. The predicate matches only while the stored check-in is still
  // from an earlier UTC day, so two concurrent requests produce exactly one
  // match — the same shape the daily wheel uses.
  const startOfToday = new Date(today * 86_400_000);
  const claimed = await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [{ lastCheckInAt: null }, { lastCheckInAt: { lt: startOfToday } }],
    },
    data: { lastCheckInAt: now, checkInStreak: streak },
  });
  if (claimed.count !== 1) {
    throw new CheckInNotReadyError(new Date((today + 1) * 86_400_000));
  }

  const credited = await awardBonus({ userId, amount, currency: 'USD' });

  return {
    amount,
    streak,
    balance: credited.balance,
    nextAvailableAt: new Date((today + 1) * 86_400_000).toISOString(),
  };
}

// ─────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────

/**
 * The task board.
 *
 * `verifiable` is the important column. A task pays only when the server can
 * confirm it happened — the daily check-in can be (it is a server clock and a
 * stored timestamp), while "join our Telegram" cannot: nothing here talks to
 * Telegram, so a claim endpoint for it would pay anyone who pressed the button
 * without joining anything. Those are listed as links with no reward attached
 * until an integration exists to check them, and `claimTask` refuses them.
 */
export interface TaskDefinition {
  id: string;
  title: string;
  description: string;
  /** Null when the task pays nothing yet — see `verifiable`. */
  reward: string | null;
  verifiable: boolean;
  href?: string;
}

export const TASKS: readonly TaskDefinition[] = [
  {
    id: 'daily-checkin',
    title: 'Daily check-in',
    description: 'Come back each day for a bigger reward, up to day seven.',
    reward: 'ladder',
    verifiable: true,
  },
  {
    id: 'telegram-join',
    title: 'Join the Telegram channel',
    description:
      'Announcements, drops and support. No reward attached yet — nothing here can confirm a join.',
    reward: null,
    verifiable: false,
    href: 'https://t.me/frigat',
  },
  {
    id: 'x-follow',
    title: 'Follow on X',
    description: 'Same story: unverifiable from here, so it pays nothing for now.',
    reward: null,
    verifiable: false,
    href: 'https://x.com/frigat',
  },
];

export function findTask(id: string): TaskDefinition | undefined {
  return TASKS.find((task) => task.id === id);
}

/** Routes every claimable task. Today that is exactly one. */
export async function claimTask(input: {
  userId: string;
  taskId: string;
}): Promise<CheckInResult> {
  const task = findTask(input.taskId);
  if (!task) throw new TaskNotVerifiableError(input.taskId);
  if (!task.verifiable) throw new TaskNotVerifiableError(input.taskId);

  if (task.id === 'daily-checkin') return claimDailyCheckIn(input.userId);

  // Unreachable while the table above holds, and a loud failure if a task is
  // added as verifiable without a handler.
  throw new TaskNotVerifiableError(input.taskId);
}
