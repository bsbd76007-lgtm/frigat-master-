/**
 * FRIGAT — Keno Engine
 *
 * Board of KENO_TILE_COUNT tiles (0-indexed). The player picks 1–KENO_MAX_PICKS
 * of them; the server draws KENO_DRAW_COUNT numbers via the same provable
 * Fisher-Yates shuffle Plinko/Mines use for their multi-draw randomness
 * (provableShuffle — one shuffle of the full board, first KENO_DRAW_COUNT
 * entries are the draw) and pays out on however many of the player's picks
 * land in that draw.
 *
 * Payout is a table lookup — KENO_PAYTABLE[picks.length][hits] — not a
 * formula: unlike Dice or Limbo, Keno's odds come from a hypergeometric
 * distribution over the pick count, and the constant is pre-calibrated so
 * every picks-count has the same expected RTP. See the constant's own note
 * in packages/shared/src/constants/game.constants.ts for the derivation.
 */

import { KENO_DRAW_COUNT, KENO_MAX_PICKS, KENO_PAYTABLE, KENO_TILE_COUNT } from '@frigat/shared';
import { provableShuffle } from './provable';
import type { EngineResult, SeedContext } from '../types/engine.types';

export interface KenoParams {
  /** 0-indexed tile numbers, 1..KENO_MAX_PICKS of them, no duplicates. */
  picks: number[];
}

function validatePicks(picks: unknown): number[] {
  if (!Array.isArray(picks) || picks.length === 0) {
    throw new Error('keno: picks must be a non-empty array');
  }
  if (picks.length > KENO_MAX_PICKS) {
    throw new Error(`keno: at most ${KENO_MAX_PICKS} picks allowed`);
  }
  const unique = new Set<number>();
  for (const pick of picks) {
    if (
      typeof pick !== 'number' ||
      !Number.isInteger(pick) ||
      pick < 0 ||
      pick >= KENO_TILE_COUNT
    ) {
      throw new Error(`keno: pick must be an integer in [0, ${KENO_TILE_COUNT})`);
    }
    unique.add(pick);
  }
  if (unique.size !== picks.length) {
    throw new Error('keno: picks must not contain duplicates');
  }
  return [...unique];
}

export function play(params: KenoParams, seed: SeedContext): EngineResult {
  const picks = validatePicks(params.picks);

  const shuffled = provableShuffle(
    KENO_TILE_COUNT,
    seed.serverSeed,
    seed.clientSeed,
    seed.nonce
  );
  const drawn = shuffled.slice(0, KENO_DRAW_COUNT);
  const drawnSet = new Set(drawn);

  const hits = picks.filter((pick) => drawnSet.has(pick));
  const multiplier = KENO_PAYTABLE[picks.length]?.[hits.length] ?? 0;

  return {
    win: multiplier > 0,
    multiplier,
    resultData: {
      picks,
      drawn,
      hits,
      hitCount: hits.length,
    },
  };
}
