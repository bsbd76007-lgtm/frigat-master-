/**
 * FRIGAT — Runtime Risk Configuration
 *
 * Bet caps, per-game win ceilings and the maintenance switch, read from the
 * database so operators can change them without a deploy.
 *
 * These values are consulted on the hot path (every wager), so they are cached
 * for a short TTL and the cache is dropped immediately on write. The TTL is the
 * worst-case delay before a change takes effect; it is deliberately small
 * because a risk control that takes minutes to apply is not a control.
 */

import { Prisma, type GameType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { BET_LIMITS } from '../config/game.config';

const D = Prisma.Decimal;
const CACHE_TTL_MS = 3000;

export interface GameLimitView {
  gameType: GameType;
  minBet: string;
  maxBet: string;
  /** "0" means uncapped. */
  maxWin: string;
}

export interface RiskConfigView {
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  limits: GameLimitView[];
  /** Platform defaults applied when a game has no row. */
  defaults: { minBet: string; maxBet: string };
}

interface CacheEntry {
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  limits: Map<GameType, { minBet: Prisma.Decimal; maxBet: Prisma.Decimal; maxWin: Prisma.Decimal }>;
  loadedAt: number;
}

let cache: CacheEntry | null = null;

/** Drops the cache so the next read reflects a just-written change. */
export function invalidateRiskCache() {
  cache = null;
}

async function load(): Promise<CacheEntry> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;

  const [config, limits] = await Promise.all([
    prisma.platformConfig.findUnique({ where: { id: 'singleton' } }),
    prisma.gameLimit.findMany(),
  ]);

  cache = {
    maintenanceMode: config?.maintenanceMode ?? false,
    maintenanceMessage: config?.maintenanceMessage ?? null,
    limits: new Map(
      limits.map((l) => [
        l.gameType,
        { minBet: l.minBet, maxBet: l.maxBet, maxWin: l.maxWin },
      ])
    ),
    loadedAt: Date.now(),
  };
  return cache;
}

export class MaintenanceModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaintenanceModeError';
  }
}

export class BetLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BetLimitError';
  }
}

/**
 * Throws if wagering is currently disabled, or if the stake falls outside the
 * limits for this game. Called from processBet, the single money-out gate.
 */
export async function assertWagerAllowed(
  gameType: string,
  amount: Prisma.Decimal
): Promise<void> {
  const state = await load();

  if (state.maintenanceMode) {
    throw new MaintenanceModeError(
      state.maintenanceMessage ?? 'Platform is in maintenance mode'
    );
  }

  const limit = state.limits.get(gameType as GameType);
  const min = limit ? limit.minBet : new D(BET_LIMITS.min);
  const max = limit ? limit.maxBet : new D(BET_LIMITS.max);

  if (amount.lessThan(min) || amount.greaterThan(max)) {
    throw new BetLimitError(
      `bet amount out of range for ${gameType} [${min.toString()}, ${max.toString()}]`
    );
  }
}

/**
 * Applies the per-game maximum win to a computed payout.
 * Returns the payout unchanged when no cap is configured (maxWin = 0).
 */
export async function capPayout(
  gameType: string,
  payout: Prisma.Decimal
): Promise<{ payout: Prisma.Decimal; capped: boolean }> {
  const state = await load();
  const limit = state.limits.get(gameType as GameType);
  if (!limit || limit.maxWin.lessThanOrEqualTo(0)) {
    return { payout, capped: false };
  }
  if (payout.greaterThan(limit.maxWin)) {
    return { payout: limit.maxWin, capped: true };
  }
  return { payout, capped: false };
}

export async function isMaintenanceMode(): Promise<boolean> {
  return (await load()).maintenanceMode;
}

// ─────────────────────────────────────────────
// Admin reads / writes
// ─────────────────────────────────────────────

export async function readRiskConfig(): Promise<RiskConfigView> {
  const [config, limits] = await Promise.all([
    prisma.platformConfig.findUnique({ where: { id: 'singleton' } }),
    prisma.gameLimit.findMany({ orderBy: { gameType: 'asc' } }),
  ]);

  return {
    maintenanceMode: config?.maintenanceMode ?? false,
    maintenanceMessage: config?.maintenanceMessage ?? null,
    updatedAt: config?.updatedAt?.toISOString() ?? null,
    updatedBy: config?.updatedBy ?? null,
    limits: limits.map((l) => ({
      gameType: l.gameType,
      minBet: l.minBet.toFixed(8),
      maxBet: l.maxBet.toFixed(8),
      maxWin: l.maxWin.toFixed(8),
    })),
    defaults: { minBet: BET_LIMITS.min, maxBet: BET_LIMITS.max },
  };
}

export interface LimitUpdate {
  gameType: GameType;
  minBet: string;
  maxBet: string;
  maxWin: string;
}

/**
 * Replaces the risk configuration inside one transaction together with its
 * audit entry, so a settings change is never recorded half-applied.
 */
export async function writeRiskConfig(params: {
  adminId: string;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  limits: LimitUpdate[];
  auditWithin: (tx: Prisma.TransactionClient, details: Record<string, unknown>) => Promise<unknown>;
}) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.platformConfig.upsert({
      where: { id: 'singleton' },
      update: {
        maintenanceMode: params.maintenanceMode,
        maintenanceMessage: params.maintenanceMessage,
        updatedBy: params.adminId,
      },
      create: {
        id: 'singleton',
        maintenanceMode: params.maintenanceMode,
        maintenanceMessage: params.maintenanceMessage,
        updatedBy: params.adminId,
      },
    });

    for (const limit of params.limits) {
      await tx.gameLimit.upsert({
        where: { gameType: limit.gameType },
        update: {
          minBet: new D(limit.minBet),
          maxBet: new D(limit.maxBet),
          maxWin: new D(limit.maxWin),
          updatedBy: params.adminId,
        },
        create: {
          gameType: limit.gameType,
          minBet: new D(limit.minBet),
          maxBet: new D(limit.maxBet),
          maxWin: new D(limit.maxWin),
          updatedBy: params.adminId,
        },
      });
    }

    await params.auditWithin(tx, {
      maintenanceMode: params.maintenanceMode,
      maintenanceMessage: params.maintenanceMessage,
      limits: params.limits,
    });
  });

  // Only after the transaction commits — dropping it earlier could repopulate
  // the cache from uncommitted state.
  invalidateRiskCache();
  return result;
}
