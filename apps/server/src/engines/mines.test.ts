import { describe, it, expect } from 'vitest';
import { MINES } from '@frigat/shared';

import { generateLayout, isMine, multiplierAfter } from './mines.engine';
import { HOUSE_EDGE } from '../config/game.config';
import type { SeedContext } from '../types/engine.types';

const ctx = (nonce = 0): SeedContext => ({
  serverSeed: 'a'.repeat(64),
  clientSeed: 'player-seed',
  nonce,
  hashedServerSeed: 'b'.repeat(64),
});

const T = MINES.gridSize;

describe('mines — layout', () => {
  it('places exactly the requested mines, in range and distinct', () => {
    const layout = generateLayout(5, ctx());
    expect(layout.minePositions).toHaveLength(5);
    expect(new Set(layout.minePositions).size).toBe(5);
    expect(Math.min(...layout.minePositions)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...layout.minePositions)).toBeLessThan(T);
  });

  it('is deterministic for a seed and different across nonces', () => {
    expect(generateLayout(5, ctx(0)).minePositions).toEqual(
      generateLayout(5, ctx(0)).minePositions
    );
    const across = new Set(
      Array.from({ length: 20 }, (_, n) => generateLayout(5, ctx(n)).minePositions.join())
    );
    expect(across.size).toBeGreaterThan(1);
  });

  it('rejects a mine count outside the configured bounds', () => {
    for (const bad of [MINES.minMines - 1, MINES.maxMines + 1, 0, -1, 2.5, NaN]) {
      expect(() => generateLayout(bad, ctx())).toThrow(/minesCount/);
    }
  });

  it('supports the extremes it advertises', () => {
    expect(generateLayout(MINES.minMines, ctx()).minePositions).toHaveLength(MINES.minMines);
    expect(generateLayout(MINES.maxMines, ctx()).minePositions).toHaveLength(MINES.maxMines);
  });
});

describe('mines — tile inspection', () => {
  it('agrees with the layout it was given', () => {
    const layout = generateLayout(5, ctx());
    for (let tile = 0; tile < T; tile += 1) {
      expect(isMine(layout, tile)).toBe(layout.minePositions.includes(tile));
    }
  });

  it('rejects a tile index off the board', () => {
    const layout = generateLayout(5, ctx());
    for (const bad of [-1, T, T + 10, 1.5, NaN]) {
      expect(() => isMine(layout, bad)).toThrow(/out of range/);
    }
  });
});

describe('mines — multipliers', () => {
  it('is 1.00 before anything is revealed', () => {
    expect(multiplierAfter(5, 0)).toBe(1);
  });

  it('rises with every safe tile', () => {
    let previous = 0;
    for (let revealed = 0; revealed <= T - 5; revealed += 1) {
      const m = multiplierAfter(5, revealed);
      expect(m).toBeGreaterThanOrEqual(previous);
      previous = m;
    }
  });

  it('rises with the mine count at equal progress', () => {
    expect(multiplierAfter(10, 3)).toBeGreaterThan(multiplierAfter(5, 3));
  });

  /**
   * The house edge has to appear in the price, not just in the comment: a fair
   * single-tile multiplier is 25/20 for five mines, and the engine must return
   * that shaved by the configured edge.
   */
  it('prices the first safe tile at the fair odds less the house edge', () => {
    const fair = T / (T - 5);
    const expected = Math.floor(fair * (1 - HOUSE_EDGE.MINES) * 100) / 100;
    expect(multiplierAfter(5, 1)).toBe(expected);
  });

  it('rejects revealing more safe tiles than the board holds', () => {
    expect(() => multiplierAfter(5, T - 5 + 1)).toThrow(/out of range/);
    expect(() => multiplierAfter(5, -1)).toThrow(/out of range/);
  });
});
