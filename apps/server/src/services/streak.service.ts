/**
 * FRIGAT — Daily play streak
 *
 * A streak is the number of consecutive UTC days on which a player settled at
 * least one bet. Recorded after a bet settles, never before: an unsettled bet
 * is not play, and crediting it would let a player advance a streak by opening
 * a round they never finish.
 *
 * ── Why the boundary is a UTC calendar day ─────────────────────────────────
 * "24 hours since the last bet" drifts: a player betting at 23:00 then 22:00
 * the next evening has a 23-hour gap and would break a streak they kept in
 * every ordinary sense. A calendar day is also what the UI promises — the bar
 * says "Day 4", not "hour 96". So the comparison is date-only, and the whole
 * service works in UTC so a player crossing a timezone does not gain or lose a
 * day.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

const D = Prisma.Decimal;

export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100] as const;

const CASHBACK_TIERS = [
  { minStreak: 1, rate: 0.03 },
  { minStreak: 3, rate: 0.05 },
  { minStreak: 7, rate: 0.08 },
  { minStreak: 14, rate: 0.1 },
  { minStreak: 30, rate: 0.15 },
] as const;

const CASHBACK_CAP = '500';

const RESTORE_COST_PER_DAY = '2.50';
const RESTORE_COST_CAP = '100';

const RESTORE_WINDOW_DAYS = 2;

export function utcDayStart(at: Date): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
  );
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round(
    (utcDayStart(to).getTime() - utcDayStart(from).getTime()) / 86_400_000
  );
}

export function cashbackRate(streak: number): number {
  let rate = 0;
  for (const tier of CASHBACK_TIERS) {
    if (streak >= tier.minStreak) rate = tier.rate;
  }
  return rate;
}

export function restoreCostFor(length: number): Prisma.Decimal {
  const raw = new D(RESTORE_COST_PER_DAY).mul(length);
  const cap = new D(RESTORE_COST_CAP);
  return raw.greaterThan(cap) ? cap : raw;
}

export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  lastPlayedDate: Date | null;
  restorableStreak: number;
  streakRestoreCost: string;
  advancedToday: boolean;
  nextMilestone: number | null;
}

export async function recordPlay(
  userId: string,
  now = new Date()
): Promise<StreakState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      currentStreak: true,
      longestStreak: true,
      lastPlayedDate: true,
      restorableStreak: true,
      streakRestoreCost: true,
      streakBrokenAt: true,
    },
  });
  if (!user) throw new Error(`streak: unknown user ${userId}`);

  const today = utcDayStart(now);
  const gap = user.lastPlayedDate ? daysBetween(user.lastPlayedDate, now) : null;

  if (gap === 0) {
    return toState(user, false);
  }

  let currentStreak: number;
  let restorableStreak = user.restorableStreak;
  let streakRestoreCost = user.streakRestoreCost;
  let streakBrokenAt = user.streakBrokenAt;

  if (gap === 1) {
    currentStreak = user.currentStreak + 1;
  } else {
    if (user.currentStreak > 0 && gap !== null && gap > 1) {
      restorableStreak = user.currentStreak;
      streakRestoreCost = restoreCostFor(user.currentStreak);
      streakBrokenAt = now;
    }
    currentStreak = 1;
  }

  const longestStreak = Math.max(user.longestStreak, currentStreak);

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      currentStreak,
      longestStreak,
      lastPlayedDate: today,
      restorableStreak,
      streakRestoreCost,
      streakBrokenAt,
    },
    select: {
      currentStreak: true,
      longestStreak: true,
      lastPlayedDate: true,
      restorableStreak: true,
      streakRestoreCost: true,
      streakBrokenAt: true,
    },
  });

  return toState(updated, true);
}

function toState(
  row: {
    currentStreak: number;
    longestStreak: number;
    lastPlayedDate: Date | null;
    restorableStreak: number;
    streakRestoreCost: Prisma.Decimal;
    streakBrokenAt?: Date | null;
  },
  advancedToday: boolean
): StreakState {
  return {
    currentStreak: row.currentStreak,
    longestStreak: row.longestStreak,
    lastPlayedDate: row.lastPlayedDate,
    restorableStreak: row.restorableStreak,
    streakRestoreCost: row.streakRestoreCost.toString(),
    advancedToday,
    nextMilestone:
      STREAK_MILESTONES.find((m) => m > row.currentStreak) ?? null,
  };
}

export async function getStreak(
  userId: string,
  now = new Date()
): Promise<StreakState & { restoreAvailable: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      currentStreak: true,
      longestStreak: true,
      lastPlayedDate: true,
      restorableStreak: true,
      streakRestoreCost: true,
      streakBrokenAt: true,
    },
  });
  if (!user) throw new Error(`streak: unknown user ${userId}`);

  // Measured from when the break was recorded, not from lastPlayedDate:
  // recordPlay writes today's date in the same call that detects the break, so
  // a window keyed off lastPlayedDate always computes a zero-day gap and the
  // offer could never appear.
  const sinceBreak = user.streakBrokenAt
    ? daysBetween(user.streakBrokenAt, now)
    : null;

  const restoreAvailable =
    user.restorableStreak > 0 &&
    sinceBreak !== null &&
    sinceBreak <= RESTORE_WINDOW_DAYS;

  return { ...toState(user, false), restoreAvailable };
}

export interface CashbackQuote {
  netLoss: string;
  rate: number;
  amount: string;
  streak: number;
  eligible: boolean;
}

export async function quoteCashback(
  userId: string,
  now = new Date()
): Promise<CashbackQuote> {
  const todayStart = utcDayStart(now);
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);

  const rows = await prisma.gameSession.findMany({
    where: { userId, createdAt: { gte: yesterdayStart, lt: todayStart } },
    select: { betAmount: true, payout: true },
  });

  let staked = new D(0);
  let returned = new D(0);
  for (const row of rows) {
    staked = staked.add(row.betAmount);
    returned = returned.add(row.payout);
  }

  const net = staked.sub(returned);
  const netLoss = net.greaterThan(0) ? net : new D(0);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { currentStreak: true },
  });
  const streak = user?.currentStreak ?? 0;
  const rate = cashbackRate(streak);

  let amount = netLoss.mul(rate).toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
  const cap = new D(CASHBACK_CAP);
  if (amount.greaterThan(cap)) amount = cap;

  return {
    netLoss: netLoss.toFixed(8),
    rate,
    amount: amount.toFixed(8),
    streak,
    eligible: amount.greaterThan(0),
  };
}
