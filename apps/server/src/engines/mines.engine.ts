/**
 * FRIGAT — Mines Engine
 *
 * A 5×5 grid (25 tiles). `minesCount` tiles are mines; the rest are safe.
 * The player reveals tiles one at a time; hitting a mine ends the game with a
 * total loss. Cashing out pays the accumulated multiplier.
 *
 * Layout is a provable Fisher-Yates shuffle of tile indices — the first
 * `minesCount` positions of the shuffle are the mines. Because the shuffle is
 * derived from (serverSeed, clientSeed, nonce), the player can reproduce the
 * exact mine layout once the server seed is revealed.
 *
 * Fair multiplier after k safe reveals (T = total tiles, M = mines):
 *
 *     fair(k) = Π_{i=0}^{k-1}  (T - i) / (T - M - i)
 *     payout(k) = fair(k) · (1 - houseEdge)
 *
 * This is the reciprocal of the probability of surviving k reveals, so EV per
 * reveal is neutral before the edge.
 */

import { HOUSE_EDGE, MINES } from '../config/game.config';
import { provableShuffle } from './provable';
import type { SeedContext } from '../types/engine.types';

const EDGE = HOUSE_EDGE.MINES;
const T = MINES.gridSize;

export interface MinesLayout {
  minePositions: number[];
  minesCount: number;
}

export function generateLayout(minesCount: number, seed: SeedContext): MinesLayout {
  if (
    !Number.isInteger(minesCount) ||
    minesCount < MINES.minMines ||
    minesCount > MINES.maxMines
  ) {
    throw new Error(
      `mines: minesCount must be an integer in [${MINES.minMines}, ${MINES.maxMines}]`
    );
  }

  const shuffled = provableShuffle(T, seed.serverSeed, seed.clientSeed, seed.nonce);
  const minePositions = shuffled.slice(0, minesCount).sort((a, b) => a - b);

  return { minePositions, minesCount };
}

export function isMine(layout: MinesLayout, tile: number): boolean {
  if (!Number.isInteger(tile) || tile < 0 || tile >= T) {
    throw new Error(`mines: tile index out of range: ${tile}`);
  }
  return layout.minePositions.includes(tile);
}

export function multiplierAfter(minesCount: number, safeRevealed: number): number {
  const safeTiles = T - minesCount;
  if (safeRevealed < 0 || safeRevealed > safeTiles) {
    throw new Error('mines: safeRevealed out of range');
  }
  if (safeRevealed === 0) return 1;

  let fair = 1;
  for (let i = 0; i < safeRevealed; i++) {
    fair *= (T - i) / (T - minesCount - i);
  }
  const withEdge = fair * (1 - EDGE);
  return Math.floor(withEdge * 100) / 100;
}
