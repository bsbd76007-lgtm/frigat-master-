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

/**
 * Chicken Road. Each lane is one provable draw: the hop survives when
 * `floatAt(serverSeed, clientSeed, nonce, lane - 1) >= hazardAt(lane)`. The
 * ladder is priced off survival odds —
 *
 *     multiplier(n) = (1 - edge) / Π_{k=1..n} (1 - hazardAt(k))
 *
 * — so the edge is the same wherever the player stops.
 *
 * `ramp` is why the first hops pay little: the hazard starts at `start` of the
 * mode's `hazard` and climbs linearly to the full rate by lane `lanes`. Early
 * lanes are genuinely safer, so their multipliers are genuinely lower; cutting
 * the early multipliers at a flat hazard instead would quietly raise the edge
 * on exactly the lanes most players stop at.
 *
 * `maxMultiplier` ends the road. The ladder is geometric (the 75% mode passes
 * 10^12 by lane 20), and a game with no admin GameLimit row gets no payout cap
 * at all, so the engine has to bound itself: a mode's last lane is the deepest
 * one priced at or under this, and reaching it cashes out automatically.
 */
export const CHICKEN = {
  maxMultiplier: 10_000,
  ramp: { start: 0.4, lanes: 5 },
  modes: {
    low: { hazard: 0.15 },
    medium: { hazard: 0.25 },
    high: { hazard: 0.5 },
    extreme: { hazard: 0.75 },
  },
} as const;

export type ChickenMode = keyof typeof CHICKEN.modes;

/** Per-lane crash chance: the mode's hazard, ramped in over the first lanes. */
export function chickenHazardAt(mode: ChickenMode, lane: number): number {
  const { start, lanes } = CHICKEN.ramp;
  const progress = Math.min(1, (lane - 1) / (lanes - 1));
  return CHICKEN.modes[mode].hazard * (start + (1 - start) * progress);
}

/**
 * Avia Masters. One bet is one flight, decided whole from the seed: the flight
 * meets `flightEvents` pickups or rockets in turn, each applying
 *
 *     m ← m · mul + add          (starting from m = 1)
 *
 * and then either lands on the carrier or ditches. The landing draw is
 * independent of the flight, and its probability is what holds the edge:
 *
 *     P(land) = (1 - edge) / E[M]
 *
 * E[M] is exact, not simulated — every event is independent of the running
 * multiplier, so E[m_{i+1}] = E[mul]·E[m_i] + E[add] (see avia.engine.ts).
 * With this table that is ~29% of flights landing: raising a multiplier or a
 * weight makes flights richer and landings rarer, never a looser edge.
 *
 * `maxMultiplier` bounds a freak run of stacked multipliers. The cap can only
 * lower a payout, so P(land) computed from the uncapped expectation leaves the
 * RTP at or under target, and reaching it takes a run of stacked multipliers
 * far rarer than one flight in a million.
 */
export const AVIA = {
  flightEvents: { min: 6, max: 12 },
  maxMultiplier: 10_000,
  events: [
    { kind: 'add025', label: '+0.25', mul: 1, add: 0.25, weight: 12 },
    { kind: 'add05', label: '+0.5', mul: 1, add: 0.5, weight: 8 },
    { kind: 'add1', label: '+1', mul: 1, add: 1, weight: 3 },
    { kind: 'add2', label: '+2', mul: 1, add: 2, weight: 1 },
    { kind: 'x2', label: 'x2', mul: 2, add: 0, weight: 3 },
    { kind: 'x3', label: 'x3', mul: 3, add: 0, weight: 0.8 },
    { kind: 'x5', label: 'x5', mul: 5, add: 0, weight: 0.15 },
    { kind: 'rocket', label: '÷2', mul: 0.5, add: 0, weight: 12 },
  ],
} as const;

export type AviaEventKind = (typeof AVIA.events)[number]['kind'];

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
    8: [5.49, 2.06, 1.08, 0.99, 0.49, 0.99, 1.08, 2.06, 5.49],
    12: [9.85, 2.96, 1.59, 1.37, 1.08, 0.99, 0.49, 0.99, 1.08, 1.37, 1.59, 2.96, 9.85],
    16: [15.76, 8.86, 1.97, 1.36, 1.38, 1.18, 1.08, 0.99, 0.49, 0.99, 1.08, 1.18, 1.38, 1.36, 1.97, 8.86, 15.76],
  },
  MEDIUM: {
    8: [12.83, 2.98, 1.28, 0.69, 0.39, 0.69, 1.28, 2.98, 12.83],
    12: [32.5, 10.81, 3.95, 1.97, 1.08, 0.59, 0.3, 0.59, 1.08, 1.97, 3.95, 10.81, 32.5],
    16: [108.35, 40.38, 9.86, 4.91, 2.95, 1.49, 0.98, 0.49, 0.3, 0.49, 0.98, 1.49, 2.95, 4.91, 9.86, 40.38, 108.35],
  },
  HIGH: {
    8: [28.52, 3.95, 1.48, 0.29, 0.2, 0.29, 1.48, 3.95, 28.52],
    12: [167.23, 23.62, 7.96, 1.97, 0.68, 0.2, 0.2, 0.2, 0.68, 1.97, 7.96, 23.62, 167.23],
    16: [985.08, 128.06, 25.63, 8.87, 3.94, 1.97, 0.19, 0.2, 0.2, 0.2, 0.19, 1.97, 3.94, 8.87, 25.63, 128.06, 985.08],
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
  1: { 0: 0, 1: 3.9 },
  2: { 0: 0, 1: 1.01, 2: 10.16 },
  3: { 0: 0, 1: 0, 2: 4.28, 3: 32.12 },
  4: { 0: 0, 1: 0, 2: 1.77, 3: 10.59, 4: 77.78 },
  5: { 0: 0, 1: 0, 2: 0, 3: 6.87, 4: 36.67, 5: 206.05 },
  6: { 0: 0, 1: 0, 2: 0, 3: 3.18, 4: 15.9, 5: 84.73, 6: 476.66 },
  7: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 11.53, 5: 57.68, 6: 288.34, 7: 1729.9 },
  8: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 5.49, 5: 27.51, 6: 137.39, 7: 687.16, 8: 4810.11 },
  9: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 23.63, 6: 94.55, 7: 393.91, 8: 1575.64, 9: 11029.5 },
  10: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 11.72, 6: 46.86, 7: 234.37, 8: 1054.52, 9: 3515.21, 10: 23434.75 },
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
