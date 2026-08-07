import { KENO_DRAW_COUNT, KENO_MAX_PICKS, KENO_PAYTABLE, KENO_TILE_COUNT } from '@frigat/shared';
import { provableShuffle } from './provable';
import type { EngineResult, SeedContext } from '../types/engine.types';

export interface KenoParams {
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
