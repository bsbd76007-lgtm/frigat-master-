import type { GameType } from '@frigat/shared';

export {
  BET_LIMITS,
  MINES,
  CHICKEN,
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
  SLOTS_REELS,
  SLOTS_ROWS,
  SLOTS_SYMBOLS,
  SLOTS_WEIGHTS,
  SLOTS_PAYTABLE,
  SLOTS_PAYLINES,
  SLOTS_PAYLINE_NAMES,
} from '@frigat/shared';

/**
 * House edge per game — but read the split before changing a number here.
 *
 * For CRASH, MINES, CHICKEN, AVIA, COINFLIP, DICE and LIMBO this value is the **control**:
 * the engine multiplies a fair payout by `(1 - edge)`, so editing it changes
 * what players are paid.
 *
 * For PLINKO, KENO and SLOTS it is only a **description**. Those engines never
 * read it — their payouts are the hardcoded tables in `@frigat/shared`. But
 * `/api/games/rtp` publishes `(1 - HOUSE_EDGE[game]) * 100` to players, so a
 * value here that disagrees with the table makes the API misreport the RTP.
 * Change the table and this number together; `engines.test.ts` measures the
 * tables against these targets and fails if they drift apart.
 *
 * ROULETTE is neither. Its edge is structural — 37 pockets paying 36, so
 * 1 - 36/37 = 2.70% — and `rtp.routes.ts` special-cases it. Setting a non-zero
 * value here would not change a single payout.
 */
export const HOUSE_EDGE: Record<GameType, number> = {
  CRASH: 0.025,
  MINES: 0.025,
  ROULETTE: 0,
  COINFLIP: 0.025,
  PLINKO: 0.025,
  DICE: 0.025,
  LIMBO: 0.025,
  KENO: 0.025,
  CHICKEN: 0.025,
  // Held by the landing chance, not a paytable — see AVIA in @frigat/shared.
  AVIA: 0.025,
  // Left at 4%: the brief was to make games harder, and rescaling the slots
  // paytable down to 2.5% would have *cut* the edge. Slots conventionally
  // carry more than table games, so this stays above the 2.5% floor until
  // someone picks a deliberate target for it.
  SLOTS: 0.04,
};

export const ROULETTE_PAYOUTS = {
  straight: 36,
  color: 2,
  parity: 2,
  range: 2,
  dozen: 3,
  column: 3,
} as const;
