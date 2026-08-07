/**
 * FRIGAT — Daily wheel & VIP service
 *
 * Two player-facing reward mechanics, both of which mint balance and therefore
 * both of which settle through ledger.service rather than touching a wallet
 * directly.
 *
 * The eligibility guard on the wheel is the interesting part: a naive
 * "read lastSpinAt, check it, then award" is a TOCTOU race — two requests that
 * both read a stale timestamp both pass the check and both pay out. The claim
 * here is a guarded updateMany that only matches rows whose timestamp is still
 * old, so exactly one concurrent request can win it.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { awardBonus } from './ledger.service';

const D = Prisma.Decimal;

export const WHEEL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Wheel segments and their weights.
 *
 * Weights are relative, not percentages — they are normalised at draw time, so
 * adding a segment does not require rebalancing every other number.
 *
 * Expected value is $7.75 per spin (45%·1 + 30%·5 + 18%·10 + 6%·50 + 1%·100).
 * That is the daily per-active-user cost of this faucet and the number to
 * revisit when editing weights — at a 24h cooldown it is ~$2.8k/year per user
 * who claims every day, so it wants a deliberate decision rather than a drift.
 */
export const WHEEL_SEGMENTS = [
  { prize: '1', weight: 45 },
  { prize: '5', weight: 30 },
  { prize: '10', weight: 18 },
  { prize: '50', weight: 6 },
  { prize: '100', weight: 1 },
] as const;

const TOTAL_WEIGHT = WHEEL_SEGMENTS.reduce((sum, s) => sum + s.weight, 0);

/**
 * VIP tiers, keyed on lifetime wagered volume.
 *
 * `rakeback` is the share of accrued house edge a tier may reclaim. Bronze
 * starts at 0 so an unranked player is not offered a claim that computes to
 * nothing.
 */
export const VIP_TIERS = [
  { name: 'Unranked', threshold: '0', rakeback: 0 },
  { name: 'Bronze', threshold: '1000', rakeback: 0.05 },
  { name: 'Silver', threshold: '5000', rakeback: 0.06 },
  { name: 'Gold', threshold: '25000', rakeback: 0.08 },
  { name: 'Platinum', threshold: '100000', rakeback: 0.1 },
  { name: 'Diamond', threshold: '500000', rakeback: 0.1 },
] as const;

export type TierName = (typeof VIP_TIERS)[number]['name'];

export class WheelNotReadyError extends Error {
  constructor(readonly nextAvailableAt: Date) {
    super('Daily wheel is not ready yet');
    this.name = 'WheelNotReadyError';
  }
}

export class NothingToClaimError extends Error {
  constructor() {
    super('No rakeback available to claim');
    this.name = 'NothingToClaimError';
  }
}

/** Picks a segment by weight. `random` is injectable so tests are determinate. */
export function drawSegment(random: number = Math.random()): {
  prize: string;
  index: number;
} {
  // Guard against a caller passing exactly 1 (or a float rounding to it),
  // which would otherwise fall through the loop and return nothing.
  const target = Math.min(Math.max(random, 0), 0.999999999) * TOTAL_WEIGHT;

  let cumulative = 0;
  for (let i = 0; i < WHEEL_SEGMENTS.length; i += 1) {
    cumulative += WHEEL_SEGMENTS[i].weight;
    if (target < cumulative) {
      return { prize: WHEEL_SEGMENTS[i].prize, index: i };
    }
  }
  // Unreachable while weights are positive; falls back to the commonest prize.
  return { prize: WHEEL_SEGMENTS[0].prize, index: 0 };
}

export function tierFor(wagered: Prisma.Decimal): (typeof VIP_TIERS)[number] {
  for (let i = VIP_TIERS.length - 1; i >= 0; i -= 1) {
    if (wagered.greaterThanOrEqualTo(new D(VIP_TIERS[i].threshold))) {
      return VIP_TIERS[i];
    }
  }
  return VIP_TIERS[0];
}

export function nextTierFor(
  wagered: Prisma.Decimal
): (typeof VIP_TIERS)[number] | null {
  for (const tier of VIP_TIERS) {
    if (wagered.lessThan(new D(tier.threshold))) return tier;
  }
  return null;
}

/** When this player may next spin, or null if they may spin now. */
export function nextSpinAt(lastSpinAt: Date | null): Date | null {
  if (!lastSpinAt) return null;
  const next = new Date(lastSpinAt.getTime() + WHEEL_COOLDOWN_MS);
  return next > new Date() ? next : null;
}

export interface SpinResult {
  prize: string;
  /** Index of the winning segment, so the UI can land the wheel on it. */
  segmentIndex: number;
  balance: string;
  nextAvailableAt: string;
}

/**
 * Claims the daily spin and credits the prize.
 *
 * Claiming happens before the award: the guarded update below is what makes a
 * double-spin impossible, so it must succeed before any money moves. If the
 * credit then failed, the player loses one spin rather than the platform
 * paying twice — the safer side of that trade.
 */
export async function spinDailyWheel(input: {
  userId: string;
  currency?: string;
  random?: number;
}): Promise<SpinResult> {
  const currency = input.currency ?? 'USD';
  const now = new Date();
  const cutoff = new Date(now.getTime() - WHEEL_COOLDOWN_MS);

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { lastDailyWheelSpinAt: true, frozen: true },
  });
  if (!user) throw new Error('bonus: user not found');
  if (user.frozen) throw new Error('bonus: account is frozen');

  const pending = nextSpinAt(user.lastDailyWheelSpinAt);
  if (pending) throw new WheelNotReadyError(pending);

  // Atomic claim: matches only if the stored timestamp is still older than the
  // cooldown (or null). Two concurrent spins → exactly one match.
  const claimed = await prisma.user.updateMany({
    where: {
      id: input.userId,
      OR: [
        { lastDailyWheelSpinAt: null },
        { lastDailyWheelSpinAt: { lte: cutoff } },
      ],
    },
    data: { lastDailyWheelSpinAt: now },
  });
  if (claimed.count !== 1) {
    // Lost the race — re-read to report an accurate next-available time.
    const fresh = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { lastDailyWheelSpinAt: true },
    });
    throw new WheelNotReadyError(
      nextSpinAt(fresh?.lastDailyWheelSpinAt ?? now) ??
        new Date(now.getTime() + WHEEL_COOLDOWN_MS)
    );
  }

  const { prize, index } = drawSegment(input.random);
  const bonus = await awardBonus({ userId: input.userId, amount: prize, currency });

  return {
    prize,
    segmentIndex: index,
    balance: bonus.balance,
    nextAvailableAt: new Date(now.getTime() + WHEEL_COOLDOWN_MS).toISOString(),
  };
}

export interface VipStatus {
  tier: TierName;
  rakebackRate: number;
  totalWagered: string;
  nextTier: { name: TierName; threshold: string; remaining: string } | null;
  /** 0–1 progress toward the next tier; 1 at the top tier. */
  progress: number;
  claimable: string;
  balance: string;
  currency: string;
  dailyWheelAvailable: boolean;
  dailyWheelNextAvailableAt: string | null;
}

/**
 * Lifetime wagered, accrued house edge, and what is currently claimable.
 *
 * Rakeback is computed on edge the platform actually kept — stakes minus
 * payouts — not on raw volume. Paying a share of volume would mean a player
 * who broke even still generated a payout, which is a bonus, not rakeback.
 * Rewards already claimed are netted out so the same edge cannot be claimed
 * twice.
 */
export async function getVipStatus(input: {
  userId: string;
  currency?: string;
}): Promise<VipStatus> {
  const currency = input.currency ?? 'USD';

  const [sessions, wallet, user, claimed] = await Promise.all([
    prisma.gameSession.aggregate({
      _sum: { betAmount: true, payout: true },
      where: { userId: input.userId },
    }),
    prisma.wallet.findUnique({
      where: { userId_currency: { userId: input.userId, currency } },
      select: { balance: true },
    }),
    prisma.user.findUnique({
      where: { id: input.userId },
      select: { lastDailyWheelSpinAt: true },
    }),
    prisma.rakebackClaim.aggregate({
      _sum: { amount: true },
      where: { userId: input.userId },
    }),
  ]);

  const wagered = sessions._sum.betAmount ?? new D(0);
  const returned = sessions._sum.payout ?? new D(0);
  const alreadyClaimed = claimed._sum.amount ?? new D(0);

  const tier = tierFor(wagered);
  const next = nextTierFor(wagered);

  const edge = wagered.minus(returned);
  const entitlement = edge.lessThanOrEqualTo(0)
    ? new D(0)
    : edge.mul(tier.rakeback);
  const claimable = Prisma.Decimal.max(
    new D(0),
    entitlement.minus(alreadyClaimed)
  ).toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);

  // Progress across the current band, so the bar fills smoothly rather than
  // resetting to zero the moment a tier is reached.
  let progress = 1;
  if (next) {
    const floor = new D(tier.threshold);
    const ceiling = new D(next.threshold);
    const span = ceiling.minus(floor);
    progress = span.lessThanOrEqualTo(0)
      ? 1
      : Math.min(
          1,
          Math.max(0, wagered.minus(floor).div(span).toNumber())
        );
  }

  const pending = nextSpinAt(user?.lastDailyWheelSpinAt ?? null);

  return {
    tier: tier.name,
    rakebackRate: tier.rakeback,
    totalWagered: wagered.toFixed(8),
    nextTier: next
      ? {
          name: next.name,
          threshold: next.threshold,
          remaining: new D(next.threshold).minus(wagered).toFixed(8),
        }
      : null,
    progress,
    claimable: claimable.toFixed(8),
    balance: wallet?.balance.toString() ?? '0',
    currency,
    dailyWheelAvailable: pending === null,
    dailyWheelNextAvailableAt: pending?.toISOString() ?? null,
  };
}

/**
 * Credits the claimable rakeback and records the claim.
 *
 * The RakebackClaim row is what stops the same edge being claimed repeatedly:
 * `getVipStatus` subtracts the sum of past claims from the entitlement, so
 * claiming twice in a row yields nothing the second time.
 */
export async function claimRakeback(input: {
  userId: string;
  currency?: string;
}): Promise<{ claimed: string; balance: string; currency: string }> {
  const currency = input.currency ?? 'USD';
  const status = await getVipStatus({ userId: input.userId, currency });
  const amount = new D(status.claimable);

  if (amount.lessThanOrEqualTo(0)) throw new NothingToClaimError();

  // Recorded first: if the credit fails the claim row is rolled back with it,
  // and if the process dies between them the player can retry.
  const result = await prisma.$transaction(async (tx) => {
    await tx.rakebackClaim.create({
      data: { userId: input.userId, amount, currency },
    });
    return { amount };
  });

  const bonus = await awardBonus({
    userId: input.userId,
    amount: result.amount.toFixed(8),
    currency,
  });

  return {
    claimed: result.amount.toFixed(8),
    balance: bonus.balance,
    currency,
  };
}
