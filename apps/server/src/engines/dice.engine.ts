/**
 * FRIGAT — Dice Engine
 * Roll ∈ [0, 100). Player picks a target and direction.
 *   UNDER: win if roll < target   → winChance = target
 *   OVER:  win if roll > target   → winChance = 100 - target
 * Fair multiplier = 100 / winChance, reduced by the house edge.
 */

import { calculateOutcome } from '@frigat/shared';
import { HOUSE_EDGE } from '../config/game.config';
import type { EngineResult, SeedContext } from '../types/engine.types';

export type DiceDirection = 'OVER' | 'UNDER';

export interface DiceParams {
  target: number; // exclusive bound in (0, 100)
  direction: DiceDirection;
}

const EDGE = HOUSE_EDGE.DICE;

export function play(params: DiceParams, seed: SeedContext): EngineResult {
  const { target, direction } = params;

  if (typeof target !== 'number' || target <= 0 || target >= 100) {
    throw new Error('dice: target must be in the open interval (0, 100)');
  }
  if (direction !== 'OVER' && direction !== 'UNDER') {
    throw new Error('dice: direction must be OVER or UNDER');
  }

  const u = calculateOutcome(seed.serverSeed, seed.clientSeed, seed.nonce);
  const roll = u * 100; // [0, 100)

  const win = direction === 'UNDER' ? roll < target : roll > target;
  const winChance = direction === 'UNDER' ? target : 100 - target;
  const multiplier = win ? (100 / winChance) * (1 - EDGE) : 0;

  return {
    win,
    multiplier: round2(multiplier),
    resultData: {
      roll: Number(roll.toFixed(4)),
      target,
      direction,
      winChance: Number(winChance.toFixed(4)),
    },
  };
}

function round2(n: number): number {
  return Math.floor(n * 100) / 100;
}
