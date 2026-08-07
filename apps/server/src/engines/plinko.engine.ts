import { PLINKO_TABLES } from '../config/game.config';
import { floatAt } from './provable';
import type { EngineResult, SeedContext } from '../types/engine.types';

export type PlinkoRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export interface PlinkoParams {
  rows: number;
  risk: PlinkoRisk;
}

export function drop(params: PlinkoParams, seed: SeedContext): EngineResult {
  const { rows, risk } = params;

  const table = PLINKO_TABLES[risk]?.[rows];
  if (!table) {
    throw new Error(`plinko: unsupported rows=${rows} risk=${risk}`);
  }

  const path: Array<'L' | 'R'> = [];
  let bucket = 0;
  for (let i = 0; i < rows; i++) {
    const r = floatAt(seed.serverSeed, seed.clientSeed, seed.nonce, i);
    const right = r >= 0.5;
    path.push(right ? 'R' : 'L');
    if (right) bucket++;
  }

  const multiplier = table[bucket];

  return {
    win: multiplier > 1,
    multiplier,
    resultData: { rows, risk, path, bucket, multiplier },
  };
}
