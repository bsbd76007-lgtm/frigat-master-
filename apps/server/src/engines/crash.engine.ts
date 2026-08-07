/**
 * FRIGAT — Crash Engine
 *
 * Crash is a shared, round-based game. Each round commits to a fresh server
 * seed (its hash is published before betting closes) and derives ONE crash
 * point that applies to every player in the round.
 *
 * Crash point from uniform u ∈ [0, 1) with multiplicative house edge f:
 *
 *     crash = (1 - f) / (1 - u)
 *
 * Properties:
 *   - Instant bust (crash ≤ 1.00) occurs with probability exactly f.
 *   - Inverse-CDF distribution: heavy tail, median ≈ 2·(1 - f).
 *   - Fully reproducible from the revealed serverSeed + clientSeed + nonce.
 *
 * The real-time round loop (betting window, ticks, settlement) lives in the
 * socket layer (crash round manager); this module owns only the math.
 */

import { calculateOutcome } from '@frigat/shared';
import { CRASH, HOUSE_EDGE } from '../config/game.config';
import type { SeedContext } from '../types/engine.types';

const EDGE = HOUSE_EDGE.CRASH;

export function computeCrashPoint(seed: SeedContext): number {
  const u = calculateOutcome(seed.serverSeed, seed.clientSeed, seed.nonce);
  const raw = (1 - EDGE) / (1 - u);
  const clamped = Math.min(raw, CRASH.maxMultiplier);
  // Floor to 2 dp; never below 1.00.
  return Math.max(1, Math.floor(clamped * 100) / 100);
}

/**
 * Multiplier at a given elapsed time (ms) since the round started running.
 * Exponential growth: m(t) = e^(growthRate · seconds).
 */
export function multiplierAtElapsed(elapsedMs: number): number {
  const seconds = Math.max(0, elapsedMs) / 1000;
  const m = Math.exp(CRASH.growthRatePerSec * seconds);
  return Math.max(1, Math.floor(m * 100) / 100);
}

/** Inverse of multiplierAtElapsed — ms needed to reach a target multiplier. */
export function elapsedForMultiplier(target: number): number {
  if (target <= 1) return 0;
  const seconds = Math.log(target) / CRASH.growthRatePerSec;
  return seconds * 1000;
}
