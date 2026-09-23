/**
 * FRIGAT — Chicken Road Engine
 *
 * The chicken crosses lanes one hop at a time. Each hop survives or dies on its
 * own provable draw from the round's seed:
 *
 *     survives(lane) = floatAt(serverSeed, clientSeed, nonce, lane - 1) >= hazardAt(lane)
 *
 * so the whole road is fixed the moment the seed is committed, and a player can
 * replay every hop once the server seed is revealed. The traffic the client
 * draws is scenery — it animates this decision, it never makes it.
 *
 * `hazardAt` ramps up over the first lanes (CHICKEN.ramp in @frigat/shared), so
 * the opening hops are safer and pay correspondingly less.
 *
 * Multiplier after surviving `lane` hops:
 *
 *     fair(lane)   = 1 / Π_{k=1..lane} (1 - hazardAt(k))
 *     payout(lane) = fair(lane) · (1 - houseEdge), floored to 2 dp
 *
 * That is the reciprocal of the odds of getting there, so the edge is the same
 * whether the player stops at lane 1 or lane 30. A flat per-lane increment would
 * not hold a constant edge (see CLAUDE.md, "Multiplier ladders").
 */

import { CHICKEN, HOUSE_EDGE } from '../config/game.config';
import { chickenHazardAt, type ChickenMode } from '@frigat/shared';
import { floatAt } from './provable';
import type { SeedContext } from '../types/engine.types';

const EDGE = HOUSE_EDGE.CHICKEN;

export function isChickenMode(value: unknown): value is ChickenMode {
  return typeof value === 'string' && Object.hasOwn(CHICKEN.modes, value);
}

export function multiplierAt(mode: ChickenMode, lane: number): number {
  if (!Number.isInteger(lane) || lane < 0) {
    throw new Error(`chicken: lane must be a non-negative integer, got ${lane}`);
  }
  if (lane === 0) return 1;
  let survival = 1;
  for (let k = 1; k <= lane; k += 1) survival *= 1 - chickenHazardAt(mode, k);
  return Math.floor(((1 - EDGE) / survival) * 100) / 100;
}

/**
 * The last lane of the road for a mode: the deepest lane whose multiplier is
 * still within CHICKEN.maxMultiplier. Reaching it ends the round as a cashout.
 */
export function maxLanes(mode: ChickenMode): number {
  let lane = 1;
  while (multiplierAt(mode, lane + 1) <= CHICKEN.maxMultiplier) lane += 1;
  return lane;
}

/**
 * The first lane a round may be cashed out on: the first whose multiplier
 * reaches CHICKEN.minCashoutMultiplier. Below it the lanes still pay on the
 * ladder, but only as a step toward it — see the note on CHICKEN.
 */
export function minCashoutLane(mode: ChickenMode): number {
  let lane = 1;
  while (multiplierAt(mode, lane) < CHICKEN.minCashoutMultiplier) lane += 1;
  return lane;
}

/** Whether the hop *into* `lane` (1-based) survives on this seed. */
export function survives(mode: ChickenMode, lane: number, seed: SeedContext): boolean {
  if (!Number.isInteger(lane) || lane < 1) {
    throw new Error(`chicken: lane must be an integer >= 1, got ${lane}`);
  }
  return (
    floatAt(seed.serverSeed, seed.clientSeed, seed.nonce, lane - 1) >= chickenHazardAt(mode, lane)
  );
}

/**
 * The lane the chicken dies in on this seed, or null if it survives the whole
 * road. Derived once at bet time, so the round's fate is sealed before the
 * first hop and published in full when it ends.
 */
export function bustLane(mode: ChickenMode, seed: SeedContext): number | null {
  const last = maxLanes(mode);
  for (let lane = 1; lane <= last; lane += 1) {
    if (!survives(mode, lane, seed)) return lane;
  }
  return null;
}
