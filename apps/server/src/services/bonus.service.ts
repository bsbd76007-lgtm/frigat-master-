import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { awardBonus } from './ledger.service';

const D = Prisma.Decimal;

export const WHEEL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const WHEEL_SEGMENTS = [
  { prize: '1', weight: 45 },
  { prize: '5', weight: 30 },
  { prize: '10', weight: 18 },
  { prize: '50', weight: 6 },
  { prize: '100', weight: 1 },
] as const;

const TOTAL_WEIGHT = WHEEL_SEGMENTS.reduce((sum, s) => sum + s.weight, 0);

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

export function nextSpinAt(lastSpinAt: Date | null): Date | null {
  if (!lastSpinAt) return null;
  const next = new Date(lastSpinAt.getTime() + WHEEL_COOLDOWN_MS);
  return next > new Date() ? next : null;
}

export interface SpinResult {
  prize: string;
  segmentIndex: number;
  balance: string;
  nextAvailableAt: string;
}

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
  progress: number;
  claimable: string;
  balance: string;
  currency: string;
  dailyWheelAvailable: boolean;
  dailyWheelNextAvailableAt: string | null;
}

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

export async function claimRakeback(input: {
  userId: string;
  currency?: string;
}): Promise<{ claimed: string; balance: string; currency: string }> {
  const currency = input.currency ?? 'USD';
  const status = await getVipStatus({ userId: input.userId, currency });
  const amount = new D(status.claimable);

  if (amount.lessThanOrEqualTo(0)) throw new NothingToClaimError();

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
