/**
 * FRIGAT — Slots engine (5 reels × 3 rows, 5 fixed paylines)
 *
 * The whole spin is decided here, from one seed context, before the client
 * draws a frame. The reel matrix in the response is the *outcome*, not a
 * request: the animation replays a result that is already settled and already
 * logged, so a client that skips the animation, patches it, or drops the
 * connection mid-spin still gets exactly the same payout.
 *
 * Provable fairness: every symbol is drawn from `floatAt(cursor)` with a
 * distinct cursor, so a player holding the revealed serverSeed can recompute
 * the full 15-cell matrix cell by cell. Cursors run column-major (reel 0 rows
 * 0-2, reel 1 rows 0-2, …) — the order is part of the spec players verify
 * against, so it must not be reordered casually.
 *
 * Money: the engine returns a *multiplier on the total stake* and never touches
 * a balance. `betAmount * multiplier` is computed downstream in Decimal by the
 * ledger path, as with every other engine here.
 */

import {
  SLOTS_PAYLINES,
  SLOTS_PAYTABLE,
  SLOTS_REELS,
  SLOTS_ROWS,
  SLOTS_SYMBOLS,
  SLOTS_WEIGHTS,
  type SlotSymbol,
} from '@frigat/shared';
import { floatAt } from './provable';
import type { EngineResult, SeedContext } from '../types/engine.types';

/** Cumulative weight table, built once — the draw is a binary-free linear scan. */
const CUMULATIVE: ReadonlyArray<{ symbol: SlotSymbol; upto: number }> = (() => {
  let running = 0;
  return SLOTS_SYMBOLS.map((symbol) => {
    running += SLOTS_WEIGHTS[symbol];
    return { symbol, upto: running };
  });
})();

const TOTAL_WEIGHT = CUMULATIVE[CUMULATIVE.length - 1].upto;

/** Maps a uniform in [0,1) onto a symbol according to SLOTS_WEIGHTS. */
export function symbolAt(roll: number): SlotSymbol {
  const target = roll * TOTAL_WEIGHT;
  for (const entry of CUMULATIVE) {
    if (target < entry.upto) return entry.symbol;
  }
  // Only reachable if roll rounds to exactly 1; the last symbol is correct.
  return CUMULATIVE[CUMULATIVE.length - 1].symbol;
}

/**
 * Builds the 5×3 matrix as `matrix[reel][row]`, drawing each cell from its own
 * cursor in the provable stream.
 */
export function spinMatrix(seed: SeedContext): SlotSymbol[][] {
  const matrix: SlotSymbol[][] = [];
  let cursor = 0;
  for (let reel = 0; reel < SLOTS_REELS; reel += 1) {
    const column: SlotSymbol[] = [];
    for (let row = 0; row < SLOTS_ROWS; row += 1) {
      const roll = floatAt(seed.serverSeed, seed.clientSeed, seed.nonce, cursor);
      cursor += 1;
      column.push(symbolAt(roll));
    }
    matrix.push(column);
  }
  return matrix;
}

export interface LineWin {
  lineIndex: number;
  /** Symbol that carried the line — the first non-WILD, or WILD throughout. */
  symbol: SlotSymbol;
  /** 3, 4 or 5 matching cells from the leftmost reel. */
  count: number;
  /** Payout as a multiple of the *line* stake. */
  multiplier: number;
  /** `[reel, row]` of every cell in the win, for the client's overlay. */
  cells: Array<[number, number]>;
}

/**
 * Evaluates one payline left to right.
 *
 * WILD substitutes for any symbol, so the line's identity is the first non-WILD
 * cell in the run. A run of pure WILDs pays as WILD, which is the top award —
 * that is deliberate, and it is why WILD is the rarest symbol on the reel.
 *
 * Only left-to-right runs starting on reel 0 count, so a match that begins on
 * reel 1 pays nothing however long it is.
 */
export function evaluateLine(
  matrix: SlotSymbol[][],
  lineIndex: number
): LineWin | null {
  const rows = SLOTS_PAYLINES[lineIndex];
  if (!rows) return null;

  const first = matrix[0][rows[0]];
  let identity: SlotSymbol | null = first === 'WILD' ? null : first;
  let count = 1;

  for (let reel = 1; reel < SLOTS_REELS; reel += 1) {
    const cell = matrix[reel][rows[reel]];
    if (cell === 'WILD') {
      count += 1;
      continue;
    }
    if (identity === null) {
      // The run so far is all WILDs, so this symbol adopts it.
      identity = cell;
      count += 1;
      continue;
    }
    if (cell === identity) {
      count += 1;
      continue;
    }
    break;
  }

  if (count < 3) return null;

  const symbol: SlotSymbol = identity ?? 'WILD';
  const multiplier = SLOTS_PAYTABLE[symbol][count as 3 | 4 | 5];
  if (!multiplier) return null;

  const cells: Array<[number, number]> = [];
  for (let reel = 0; reel < count; reel += 1) cells.push([reel, rows[reel]]);

  return { lineIndex, symbol, count, multiplier, cells };
}

export function evaluateMatrix(matrix: SlotSymbol[][]): LineWin[] {
  const wins: LineWin[] = [];
  for (let line = 0; line < SLOTS_PAYLINES.length; line += 1) {
    const win = evaluateLine(matrix, line);
    if (win) wins.push(win);
  }
  return wins;
}

/**
 * Resolves a spin.
 *
 * The stake is split evenly across the paylines, so a line paying 30× returns
 * `30 / 5 = 6×` the total bet. Returning a stake multiplier (rather than an
 * amount) is what lets the shared ledger path do the money in Decimal.
 */
export function spin(_params: Record<string, unknown>, seed: SeedContext): EngineResult {
  const matrix = spinMatrix(seed);
  const wins = evaluateMatrix(matrix);

  const lineCount = SLOTS_PAYLINES.length;
  const totalLineMultiplier = wins.reduce((sum, win) => sum + win.multiplier, 0);
  // Rounded to 8dp: the ledger works to 8 and an unrounded binary fraction here
  // would only be truncated there anyway.
  const multiplier = Number((totalLineMultiplier / lineCount).toFixed(8));

  return {
    win: multiplier > 0,
    multiplier,
    resultData: {
      reelMatrix: matrix,
      winningLines: wins.map((win) => ({
        lineIndex: win.lineIndex,
        symbol: win.symbol,
        count: win.count,
        /** Line award as a multiple of the total stake, matching the payout. */
        multiplier: Number((win.multiplier / lineCount).toFixed(8)),
        cells: win.cells,
      })),
      lineCount,
    },
  };
}
