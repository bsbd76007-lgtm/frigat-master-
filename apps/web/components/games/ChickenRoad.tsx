'use client';

import { useCallback, useMemo, useState } from 'react';

/**
 * Chicken Road — row-by-row crossing game.
 *
 * Architecture ported from the `chicken-crossing-road` reference project:
 * tunable constants in GAME_CONFIG, a GAME_STATE map, the board modelled as a
 * grid of 'safe' | 'car' cells generated up front, a `revealedCells` map keyed
 * by `row-col`, and full board reveal on death. Adapted to 4 lanes, TypeScript,
 * Tailwind, and probability-priced multipliers.
 */

export const GAME_CONFIG = {
  ROWS: 8,
  LANES: 4,
  CARS_PER_ROW: 1,
  MIN_BET: 1,
  MAX_BET: 1000,
  /** Fraction returned to the player; 0.99 = 1% house edge. */
  RTP: 0.99,
  CURRENCY: '$',
} as const;

export const GAME_STATE = {
  IDLE: 'idle',
  PLAYING: 'playing',
  CASHED_OUT: 'cashed_out',
  CRASHED: 'crashed',
} as const;

type GameStateValue = (typeof GAME_STATE)[keyof typeof GAME_STATE];
type Cell = 'safe' | 'car';

/**
 * Multiplier after surviving `rows` rows.
 *
 * The reference project stepped a flat +0.5x per row, which drifts far below
 * fair value (~90% house edge by row 8). Pricing off the real survival odds
 * keeps the edge fixed at 1 - RTP for every cash-out point instead.
 */
export function multiplierAt(rows: number): number {
  if (rows <= 0) return 1;
  const survival = (GAME_CONFIG.LANES - GAME_CONFIG.CARS_PER_ROW) / GAME_CONFIG.LANES;
  return Number((GAME_CONFIG.RTP / Math.pow(survival, rows)).toFixed(2));
}

/** One car per row, placed at game start so the board is fixed for the round. */
function generateBoard(): Cell[][] {
  return Array.from({ length: GAME_CONFIG.ROWS }, () => {
    const carLane = Math.floor(Math.random() * GAME_CONFIG.LANES);
    return Array.from({ length: GAME_CONFIG.LANES }, (_, lane): Cell =>
      lane === carLane ? 'car' : 'safe',
    );
  });
}

export default function ChickenRoad() {
  const [gameState, setGameState] = useState<GameStateValue>(GAME_STATE.IDLE);
  const [currentRow, setCurrentRow] = useState(0);
  const [path, setPath] = useState<number[]>([]);
  const [betAmount, setBetAmount] = useState(10);
  const [balance, setBalance] = useState(1000);
  const [board, setBoard] = useState<Cell[][]>([]);
  const [revealedCells, setRevealedCells] = useState<Record<string, Cell>>({});
  const [crashLane, setCrashLane] = useState<number | null>(null);
  const [lastWin, setLastWin] = useState<number | null>(null);

  const multiplier = useMemo(() => multiplierAt(currentRow), [currentRow]);
  const isPlaying = gameState === GAME_STATE.PLAYING;
  const nextMultiplier = multiplierAt(currentRow + 1);

  const startGame = useCallback(() => {
    if (betAmount < GAME_CONFIG.MIN_BET || betAmount > balance) return;
    setBalance((b) => Number((b - betAmount).toFixed(2)));
    setBoard(generateBoard());
    setRevealedCells({});
    setPath([]);
    setCurrentRow(0);
    setCrashLane(null);
    setLastWin(null);
    setGameState(GAME_STATE.PLAYING);
  }, [betAmount, balance]);

  const cashOut = useCallback(() => {
    if (!isPlaying || currentRow === 0) return;
    const payout = Number((betAmount * multiplierAt(currentRow)).toFixed(2));
    setBalance((b) => Number((b + payout).toFixed(2)));
    setLastWin(payout);
    setGameState(GAME_STATE.CASHED_OUT);
  }, [isPlaying, currentRow, betAmount]);

  const selectCell = useCallback(
    (row: number, lane: number) => {
      if (!isPlaying || row !== currentRow) return;

      const cell = board[row][lane];
      setPath((p) => [...p, lane]);

      if (cell === 'car') {
        // Reveal the whole board on death, as the reference game does.
        const allRevealed: Record<string, Cell> = {};
        board.forEach((r, rIdx) =>
          r.forEach((c, cIdx) => {
            allRevealed[`${rIdx}-${cIdx}`] = c;
          }),
        );
        setRevealedCells(allRevealed);
        setCrashLane(lane);
        setGameState(GAME_STATE.CRASHED);
        return;
      }

      setRevealedCells((prev) => ({ ...prev, [`${row}-${lane}`]: cell }));

      const nextRow = currentRow + 1;
      setCurrentRow(nextRow);

      if (nextRow >= GAME_CONFIG.ROWS) {
        const payout = Number((betAmount * multiplierAt(nextRow)).toFixed(2));
        setBalance((b) => Number((b + payout).toFixed(2)));
        setLastWin(payout);
        setGameState(GAME_STATE.CASHED_OUT);
      }
    },
    [isPlaying, currentRow, board, betAmount],
  );

  const reset = useCallback(() => {
    setGameState(GAME_STATE.IDLE);
    setCurrentRow(0);
    setPath([]);
    setBoard([]);
    setRevealedCells({});
    setCrashLane(null);
  }, []);

  const chickenLane = path.length > 0 ? path[path.length - 1] : 1;
  const chickenRow = Math.min(currentRow, GAME_CONFIG.ROWS - 1);
  const isOver = gameState === GAME_STATE.CRASHED || gameState === GAME_STATE.CASHED_OUT;

  // Rendered bottom-up: the chicken starts at the bottom and climbs.
  const rowIndexes = Array.from({ length: GAME_CONFIG.ROWS }, (_, i) => GAME_CONFIG.ROWS - 1 - i);

  return (
    <div className="w-full min-h-[600px] flex flex-col lg:flex-row">
      {/* ---------- Board ---------- */}
      <div className="relative flex-1 w-full min-h-[500px]">
        <div
          className={[
            'relative flex h-full w-full flex-1 flex-col transition-all duration-300',
            gameState === GAME_STATE.IDLE ? 'blur-sm brightness-50' : '',
          ].join(' ')}
        >
          {/* Lane separators */}
          <div className="pointer-events-none absolute inset-0 flex">
            {Array.from({ length: GAME_CONFIG.LANES }).map((_, i) => (
              <div
                key={i}
                className={[
                  'flex-1',
                  i < GAME_CONFIG.LANES - 1 ? 'border-r-2 border-dashed border-gray-500' : '',
                ].join(' ')}
              />
            ))}
          </div>

          {/* Rows */}
          <div className="relative flex h-full w-full flex-1 flex-col">
            {rowIndexes.map((row) => {
              const isActive = isPlaying && row === currentRow;
              const rowMultiplier = multiplierAt(row + 1);
              const chosenLane = path[row];

              return (
                <div
                  key={row}
                  className={[
                    'flex w-full flex-1 items-center justify-around px-2 transition-opacity duration-200',
                    isActive || isOver || row < currentRow ? 'opacity-100' : 'opacity-50',
                  ].join(' ')}
                >
                  {Array.from({ length: GAME_CONFIG.LANES }).map((_, lane) => {
                    const revealed = revealedCells[`${row}-${lane}`];
                    const isCrashCell =
                      gameState === GAME_STATE.CRASHED && row === currentRow && crashLane === lane;
                    const isCoin = row < currentRow && chosenLane === lane;

                    if (isActive) {
                      return (
                        <button
                          key={lane}
                          type="button"
                          onClick={() => selectCell(row, lane)}
                          className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-gray-700 bg-gray-800 text-xs font-bold text-yellow-300 shadow-inner transition-transform duration-150 hover:scale-110 hover:border-yellow-500 active:scale-95"
                        >
                          {rowMultiplier.toFixed(2)}x
                        </button>
                      );
                    }

                    return (
                      <div
                        key={lane}
                        className={[
                          'flex h-16 w-16 items-center justify-center rounded-full text-3xl transition-colors duration-300',
                          isCrashCell
                            ? 'border-4 border-red-500 bg-red-600/70'
                            : isCoin
                              ? 'bg-transparent'
                              : revealed === 'car'
                                ? 'border-4 border-red-900/60 bg-red-950/40'
                                : 'border-4 border-gray-800/60 bg-gray-900/40',
                        ].join(' ')}
                      >
                        {isCrashCell ? (
                          <span className="animate-[chicken-road-drive_0.6s_ease-in]">🚗</span>
                        ) : isCoin ? (
                          '🪙'
                        ) : revealed === 'car' ? (
                          <span className="opacity-40">🚗</span>
                        ) : (
                          <span className="text-[10px] text-gray-500">
                            {rowMultiplier.toFixed(2)}x
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* Chicken — % positioning so it tracks any board height */}
            <div
              className="pointer-events-none absolute z-10 flex h-16 w-16 items-center justify-center text-4xl transition-all duration-500 ease-out"
              style={{
                left: `calc(${(chickenLane + 0.5) * (100 / GAME_CONFIG.LANES)}% - 2rem)`,
                bottom: `calc(${((chickenRow + 0.5) * 100) / GAME_CONFIG.ROWS}% - 2rem)`,
              }}
            >
              {gameState === GAME_STATE.CRASHED ? '💥' : '🐔'}
            </div>
          </div>

          {/* Start pad */}
          <div className="flex shrink-0 items-center justify-center border-t-2 border-gray-700 py-3 text-xs uppercase tracking-widest text-gray-500">
            start
          </div>
        </div>

        {gameState === GAME_STATE.IDLE && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-lg bg-black/60 px-4 py-2 text-sm text-gray-200">
              Place your bet and start crossing
            </span>
          </div>
        )}
      </div>

      {/* ---------- Controls ---------- */}
      <div className="flex w-full lg:w-[350px] shrink-0 flex-col gap-4 rounded-xl bg-[#1a2130] p-4">
        <div className="rounded-lg bg-black/20 p-3 text-center">
          <div className="text-xs uppercase tracking-wide text-gray-400">Balance</div>
          <div className="text-xl font-bold text-green-400">
            {GAME_CONFIG.CURRENCY}
            {balance.toFixed(2)}
          </div>
        </div>

        <div className="text-center">
          <div className="text-4xl font-extrabold text-yellow-400">{multiplier.toFixed(2)}x</div>
          {isPlaying && (
            <div className="mt-1 text-xs text-gray-400">
              Next: <span className="text-gray-200">{nextMultiplier.toFixed(2)}x</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs uppercase tracking-wide text-gray-400">Bet Amount</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={GAME_CONFIG.MIN_BET}
              max={Math.min(GAME_CONFIG.MAX_BET, balance)}
              step={1}
              value={betAmount}
              disabled={isPlaying}
              onChange={(e) => setBetAmount(Math.max(0, Number(e.target.value)))}
              className="w-full min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-yellow-500 disabled:opacity-50"
            />
            <button
              type="button"
              disabled={isPlaying}
              onClick={() => setBetAmount((b) => Math.max(GAME_CONFIG.MIN_BET, Number((b / 2).toFixed(2))))}
              className="rounded-lg bg-gray-800 px-3 py-2 text-xs hover:bg-gray-700 disabled:opacity-50"
            >
              ½
            </button>
            <button
              type="button"
              disabled={isPlaying}
              onClick={() =>
                setBetAmount((b) => Math.min(GAME_CONFIG.MAX_BET, Number((b * 2).toFixed(2))))
              }
              className="rounded-lg bg-gray-800 px-3 py-2 text-xs hover:bg-gray-700 disabled:opacity-50"
            >
              2×
            </button>
          </div>
        </div>

        {gameState === GAME_STATE.CRASHED && (
          <div className="rounded-lg bg-red-950/60 p-3 text-center text-sm font-semibold text-red-400">
            💥 Hit by a car! You lost {GAME_CONFIG.CURRENCY}
            {betAmount.toFixed(2)}
          </div>
        )}
        {gameState === GAME_STATE.CASHED_OUT && (
          <div className="rounded-lg bg-green-950/60 p-3 text-center text-sm font-semibold text-green-400">
            🎉 Cashed out {GAME_CONFIG.CURRENCY}
            {(lastWin ?? 0).toFixed(2)}!
          </div>
        )}

        {isPlaying ? (
          <button
            type="button"
            onClick={cashOut}
            disabled={currentRow === 0}
            className="mt-auto w-full rounded-lg bg-yellow-500 px-6 py-3 font-bold text-black transition hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cash Out {GAME_CONFIG.CURRENCY}
            {(betAmount * multiplier).toFixed(2)}
          </button>
        ) : gameState === GAME_STATE.IDLE ? (
          <button
            type="button"
            onClick={startGame}
            disabled={betAmount < GAME_CONFIG.MIN_BET || betAmount > balance}
            className="mt-auto w-full rounded-lg bg-green-500 px-6 py-3 font-bold text-black transition hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Place Bet
          </button>
        ) : (
          <button
            type="button"
            onClick={reset}
            className="mt-auto w-full rounded-lg bg-blue-500 px-6 py-3 font-bold text-white transition hover:bg-blue-400"
          >
            Play Again
          </button>
        )}
      </div>
    </div>
  );
}
