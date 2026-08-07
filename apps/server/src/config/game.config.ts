/**
 * FRIGAT — Game Configuration
 * House edges, bet limits, and payout tables.
 * These values define the platform's mathematical model; changing them
 * changes RTP. Keep in one place for auditability.
 *
 * Anything the browser must also render (bet limits, the plinko tables, wheel
 * geometry, crash timing) is defined once in @frigat/shared and re-exported
 * here, so engines keep importing it from this module. A UI that advertised a
 * limit or payout the ledger would refuse is a correctness bug, so there is
 * deliberately no second copy to drift.
 *
 * Settlement policy below (HOUSE_EDGE, ROULETTE_PAYOUTS) stays server-only.
 */

import type { GameType } from '@frigat/shared';

export {
  BET_LIMITS,
  MINES,
  CRASH,
  ROULETTE_RED,
  ROULETTE_WHEEL_ORDER,
  PLINKO_TABLES,
  PLINKO_ROWS,
  LIMBO,
  KENO_TILE_COUNT,
  KENO_DRAW_COUNT,
  KENO_MAX_PICKS,
  KENO_PAYTABLE,
} from '@frigat/shared';

/** House edge as a fraction (0.01 = 1%). Applied to fair multipliers. */
export const HOUSE_EDGE: Record<GameType, number> = {
  CRASH: 0.01,
  MINES: 0.01,
  ROULETTE: 0, // single-zero wheel provides the ~2.7% edge structurally
  COINFLIP: 0.01,
  PLINKO: 0.01,
  DICE: 0.01,
  LIMBO: 0.01,
  // Baked into KENO_PAYTABLE's calibration (see the constant's own note),
  // not applied multiplicatively like the single-draw games — the paytable
  // IS the edge for a hit-count game.
  KENO: 0.02,
  // Same 1% edge as the other step-and-bank games; the difficulty tiers change
  // variance, not value.
  CHICKEN: 0.01,
};

/** Gross payout multiplier (includes returned stake) for each bet kind. */
export const ROULETTE_PAYOUTS = {
  straight: 36, // 35:1 + stake
  color: 2, // 1:1 + stake
  parity: 2,
  range: 2,
  dozen: 3, // 2:1 + stake
  column: 3,
} as const;
