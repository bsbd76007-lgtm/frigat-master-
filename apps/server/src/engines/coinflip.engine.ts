import { calculateOutcome } from '@frigat/shared';
import { HOUSE_EDGE } from '../config/game.config';
import type { EngineResult, SeedContext } from '../types/engine.types';

export type CoinSide = 'HEADS' | 'TAILS';

export interface CoinflipParams {
  side: CoinSide;
}

const EDGE = HOUSE_EDGE.COINFLIP;

export function play(params: CoinflipParams, seed: SeedContext): EngineResult {
  const { side } = params;
  if (side !== 'HEADS' && side !== 'TAILS') {
    throw new Error('coinflip: side must be HEADS or TAILS');
  }

  const u = calculateOutcome(seed.serverSeed, seed.clientSeed, seed.nonce);
  const landed: CoinSide = u < 0.5 ? 'HEADS' : 'TAILS';
  const win = landed === side;
  const multiplier = win ? 2 * (1 - EDGE) : 0;

  return {
    win,
    multiplier: Math.floor(multiplier * 100) / 100,
    resultData: { landed, chosen: side, outcome: Number(u.toFixed(8)) },
  };
}
