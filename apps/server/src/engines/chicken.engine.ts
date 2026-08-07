/**
 * FRIGAT — Chicken Road Engine
 *
 * The player walks a chicken across a sequence of lanes. Each lane is either
 * clear or blocked by traffic; stepping into a blocked lane ends the round with
 * a total loss, and cashing out pays the multiplier accumulated so far.
 *
 * Structurally this is Mines with an unbounded board: the same "survive a step,
 * bank a multiplier, or lose everything" shape, but the hazard is drawn per
 * lane rather than dealt from a fixed grid.
 *
 * ── Fairness ───────────────────────────────────────────────────────────────
 * Lane n is blocked iff floatAt(serverSeed, clientSeed, nonce, n) < p, where p
 * is the per-lane hazard rate for the chosen difficulty. `floatAt` is the same
 * HMAC-SHA256 stream Dice and Limbo use, so a player can recompute every lane
 * of a past round from the revealed server seed — including the lanes they
 * never reached. The outcome is fixed at bet time; walking only uncovers it.
 *
 * This is why the client is not trusted to detect collisions. The canvas
 * animates a verdict the server has already committed to; a player editing the
 * page can change what they *see*, never what they are paid.
 *
 * ── Multipliers ────────────────────────────────────────────────────────────
 * Surviving n lanes has probability (1-p)^n, so the fair payout is its
 * reciprocal and the house takes its cut off the top:
 *
 *     fair(n)   = (1 - p)^-n
 *     payout(n) = fair(n) · (1 - houseEdge)
 *
 * EV per step is therefore neutral before the edge, exactly as in Mines. The
 * multiplier is floored to 2dp so the displayed figure is never rounded up
 * into money the maths did not earn.
 */

import { HOUSE_EDGE } from '../config/game.config';
import { floatAt } from './provable';
import type { SeedContext } from '../types/engine.types';

const EDGE = HOUSE_EDGE.CHICKEN;

/**
 * Per-lane hazard rate. Higher risk pays faster but ends sooner; every tier
 * carries the same house edge, so the choice is variance, not value.
 */
export const DIFFICULTY = {
  EASY: 0.15,
  MEDIUM: 0.25,
  HARD: 0.35,
} as const;

export type Difficulty = keyof typeof DIFFICULTY;

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && value in DIFFICULTY;
}

/**
 * Lanes in a crossing. A cap exists because the multiplier grows without
 * bound: at HARD, lane 40 already pays more than the platform could settle.
 * Reaching the far side is a forced cash-out.
 */
export const LANE_COUNT = 24;

/** True when the chicken is hit stepping into `lane` (0-indexed). */
export function isBlocked(
  lane: number,
  difficulty: Difficulty,
  seed: SeedContext
): boolean {
  if (!Number.isInteger(lane) || lane < 0 || lane >= LANE_COUNT) {
    throw new Error(`chicken: lane out of range: ${lane}`);
  }
  return floatAt(seed.serverSeed, seed.clientSeed, seed.nonce, lane) <
    DIFFICULTY[difficulty];
}

/**
 * The whole road, for settlement records and for the client to render once the
 * round is over. Computed from the seed alone, so it is identical whether it
 * is derived at bet time or by a player verifying afterwards.
 */
export function generateRoad(
  difficulty: Difficulty,
  seed: SeedContext
): boolean[] {
  const road: boolean[] = [];
  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    road.push(isBlocked(lane, difficulty, seed));
  }
  return road;
}

/** Payout multiplier after `crossed` successful lanes (0 crossed → 1.0). */
export function multiplierAfter(
  difficulty: Difficulty,
  crossed: number
): number {
  if (!Number.isInteger(crossed) || crossed < 0 || crossed > LANE_COUNT) {
    throw new Error(`chicken: crossed out of range: ${crossed}`);
  }
  if (crossed === 0) return 1;

  const survive = 1 - DIFFICULTY[difficulty];
  const fair = Math.pow(survive, -crossed);
  return Math.floor(fair * (1 - EDGE) * 100) / 100;
}

/** Every multiplier for the progression bar, without re-deriving on the client. */
export function multiplierTable(difficulty: Difficulty): number[] {
  return Array.from({ length: LANE_COUNT }, (_, i) =>
    multiplierAfter(difficulty, i + 1)
  );
}
