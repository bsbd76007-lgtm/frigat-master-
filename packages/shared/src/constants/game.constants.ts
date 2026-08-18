/** Global bet bounds (decimal strings; enforced server-side by the ledger). */
export const BET_LIMITS = {
  min: '0.10',
  max: '10000.00',
} as const;

export const MINES = {
  gridSize: 25,
  /** Floor of 5: fewer mines makes the first pick near-certain to be safe. */
  minMines: 5,
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

// ─────────────────────────────────────────────
// Slots — 5 reels × 3 rows, 5 fixed paylines
//
// Symbols, reel weights, paytable and paylines live here rather than in the
// engine because the client renders the same numbers: the paytable panel and
// the payline overlay have to agree with what the server paid, and duplicating
// them is how those two drift apart. The server still decides every spin — the
// client only ever *draws* the matrix it is handed.
// ─────────────────────────────────────────────

export const SLOTS_REELS = 5;
export const SLOTS_ROWS = 3;

export const SLOTS_SYMBOLS = [
  'CHERRY',
  'LEMON',
  'ORANGE',
  'PLUM',
  'BELL',
  'BAR',
  'SEVEN',
  'WILD',
] as const;

export type SlotSymbol = (typeof SLOTS_SYMBOLS)[number];

/**
 * Relative weight of each symbol on a reel. Low-value fruit is common, SEVEN is
 * rare and WILD is rarer still — WILD substitutes for everything, so its weight
 * drives the payout distribution far harder than its own line wins suggest.
 * Weights are per-reel-identical, which keeps the maths verifiable by hand.
 */
export const SLOTS_WEIGHTS: Record<SlotSymbol, number> = {
  CHERRY: 22,
  LEMON: 20,
  ORANGE: 18,
  PLUM: 15,
  BELL: 11,
  BAR: 7,
  SEVEN: 4,
  WILD: 3,
};

/**
 * Line payouts as a multiple of the *line* stake (the total bet is split evenly
 * across the paylines). Index by match length: 3, 4 or 5 from the leftmost reel.
 *
 * Calibrated against SLOTS_WEIGHTS to land near the house edge below — see the
 * RTP test in apps/server/src/engines/engines.test.ts, which fails if a
 * change to either table moves the return outside its band.
 */
export const SLOTS_PAYTABLE: Record<SlotSymbol, Record<3 | 4 | 5, number>> = {
  CHERRY: { 3: 5, 4: 25, 5: 100 },
  LEMON: { 3: 7, 4: 30, 5: 150 },
  ORANGE: { 3: 10, 4: 40, 5: 175 },
  PLUM: { 3: 12, 4: 55, 5: 225 },
  BELL: { 3: 18, 4: 70, 5: 275 },
  BAR: { 3: 30, 4: 150, 5: 550 },
  SEVEN: { 3: 55, 4: 275, 5: 2500 },
  // Only 5-of-a-kind WILD is actually reachable: a shorter run of WILDs adopts
  // the identity of the first non-WILD reel and pays as that symbol instead.
  // The 3 and 4 rows are kept so the table is total over match lengths.
  WILD: { 3: 250, 4: 1000, 5: 10_000 },
};

/**
 * The five fixed lines, each as the row index taken from reels 0…4:
 * top, middle, bottom, V and inverted V.
 */
export const SLOTS_PAYLINES: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
] as const;

export const SLOTS_PAYLINE_NAMES = [
  'Top row',
  'Middle row',
  'Bottom row',
  'V shape',
  'Inverted V',
] as const;

// ─────────────────────────────────────────────
// Credentials
//
// Adapted from the Event-space PasswordSchema (min length + upper + lower +
// digit). Kept here rather than in either app because the API rejects weak
// passwords and the sign-up form has to describe the same rule — two copies of
// a validation rule is how a form starts promising something the server will
// refuse.
//
// Deliberately no symbol requirement and a high ceiling: composition rules past
// this point push people towards `Password1!` and away from length, which is
// what actually resists guessing. The ceiling exists because argon2 hashes the
// whole input, so an unbounded password is a cheap way to burn server CPU.
// ─────────────────────────────────────────────

export const PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 200,
} as const;

export interface PasswordProblem {
  code: 'too_short' | 'too_long' | 'missing_uppercase' | 'missing_lowercase' | 'missing_digit';
  message: string;
}

/** Every rule the password breaks, so a form can show them all at once. */
export function passwordProblems(password: string): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (password.length < PASSWORD_POLICY.minLength) {
    problems.push({
      code: 'too_short',
      message: `At least ${PASSWORD_POLICY.minLength} characters`,
    });
  }
  if (password.length > PASSWORD_POLICY.maxLength) {
    problems.push({
      code: 'too_long',
      message: `At most ${PASSWORD_POLICY.maxLength} characters`,
    });
  }
  if (!/[A-Z]/.test(password)) {
    problems.push({ code: 'missing_uppercase', message: 'An uppercase letter' });
  }
  if (!/[a-z]/.test(password)) {
    problems.push({ code: 'missing_lowercase', message: 'A lowercase letter' });
  }
  if (!/[0-9]/.test(password)) {
    problems.push({ code: 'missing_digit', message: 'A number' });
  }
  return problems;
}

export function isPasswordAcceptable(password: string): boolean {
  return passwordProblems(password).length === 0;
}
