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

export const HOUSE_EDGE: Record<GameType, number> = {
  CRASH: 0.01,
  MINES: 0.01,
  ROULETTE: 0,
  COINFLIP: 0.01,
  PLINKO: 0.01,
  DICE: 0.01,
  LIMBO: 0.01,
  KENO: 0.02,
};

export const ROULETTE_PAYOUTS = {
  straight: 36,
  color: 2,
  parity: 2,
  range: 2,
  dozen: 3,
  column: 3,
} as const;
