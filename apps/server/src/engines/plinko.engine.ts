/**
 * FRIGAT — Plinko Engine
 * A ball falls through `rows` peg-levels; at each level it goes left/right.
 * Landing bucket = number of "right" moves (0..rows). Multiplier is read from
 * the risk-tiered payout table. The house edge is already baked into the
 * published tables.
 */

import { PLINKO_TABLES } from '../config/game.config';
import { floatAt } from './provable';
import type { EngineResult, SeedContext } from '../types/engine.types';

export type PlinkoRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export interface PlinkoParams {
  rows: number; // must exist in the table (8, 12, 16)
  risk: PlinkoRisk;
}

export function drop(params: PlinkoParams, seed: SeedContext): EngineResult {
  const { rows, risk } = params;

  const table = PLINKO_TABLES[risk]?.[rows];
  if (!table) {
    throw new Error(`plinko: unsupported rows=${rows} risk=${risk}`);
  }

  // Derive one left/right decision per row from the provable stream.
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
