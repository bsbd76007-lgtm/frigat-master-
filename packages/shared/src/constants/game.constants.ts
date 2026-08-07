/** Global bet bounds (decimal strings; enforced server-side by the ledger). */
export const BET_LIMITS = {
  min: '0.10',
  max: '10000.00',
} as const;

export const MINES = {
  gridSize: 25,
  minMines: 1,
  maxMines: 24,
} as const;

export const CRASH = {
  bettingWindowMs: 5000,
  tickMs: 100,
  growthRatePerSec: 0.06,
  maxMultiplier: 1_000_000,
} as const;

export const ROULETTE_RED: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export const ROULETTE_WHEEL_ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24,
  16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

export const PLINKO_TABLES: Record<
  'LOW' | 'MEDIUM' | 'HIGH',
  Record<number, number[]>
> = {
  LOW: {
    8: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
    12: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
    16: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
  },
  MEDIUM: {
    8: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    12: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
  },
  HIGH: {
    8: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
    12: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
    16: [
      1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000,
    ],
  },
};

export const PLINKO_ROWS = [8, 12, 16] as const;
export type PlinkoRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export type RoulettePocketColor = 'GREEN' | 'RED' | 'BLACK';

export function pocketColor(pocket: number): RoulettePocketColor {
  if (pocket === 0) return 'GREEN';
  return ROULETTE_RED.has(pocket) ? 'RED' : 'BLACK';
}

export const LIMBO = {
  minMultiplier: 1.01,
  maxMultiplier: 1_000_000,
} as const;

export const KENO_TILE_COUNT = 40;
export const KENO_DRAW_COUNT = 10;
export const KENO_MAX_PICKS = 10;

export const KENO_PAYTABLE: Record<number, Record<number, number>> = {
  1: { 0: 0, 1: 3.92 },
  2: { 0: 0, 1: 1.02, 2: 10.19 },
  3: { 0: 0, 1: 0, 2: 4.3, 3: 32.27 },
  4: { 0: 0, 1: 0, 2: 1.78, 3: 10.66, 4: 78.17 },
  5: { 0: 0, 1: 0, 2: 0, 3: 6.91, 4: 36.84, 5: 207.21 },
  6: { 0: 0, 1: 0, 2: 0, 3: 3.2, 4: 15.98, 5: 85.22, 6: 479.37 },
  7: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 11.59, 5: 57.96, 6: 289.79, 7: 1738.74 },
  8: {
    0: 0, 1: 0, 2: 0, 3: 0, 4: 5.52, 5: 27.62, 6: 138.1, 7: 690.49, 8: 4833.4,
  },
  9: {
    0: 0, 1: 0, 2: 0, 3: 0, 4: 0,
    5: 23.75, 6: 95.02, 7: 395.9, 8: 1583.59, 9: 11085.13,
  },
  10: {
    0: 0, 1: 0, 2: 0, 3: 0, 4: 0,
    5: 11.78, 6: 47.11, 7: 235.56, 8: 1060.03, 9: 3533.45, 10: 23556.32,
  },
};
