'use client';

import { useCallback, useMemo, useState } from 'react';

import { useInjectedStyles } from '@/lib/useInjectedStyles';

/**
 * Chicken Road — row-by-row crossing game.
 *
 * Architecture ported from the `chicken-crossing-road` reference project:
 * tunable constants in GAME_CONFIG, a GAME_STATE map, the board modelled as a
 * grid of 'safe' | 'car' cells generated up front, a `revealedCells` map keyed
 * by `row-col`, and full board reveal on death. Adapted to 4 lanes, TypeScript
 * and probability-priced multipliers.
 *
 * Presentation is a real highway: asphalt with glowing lane markings, milled
 * metal covers for the tiles, and a chicken that hops between rows. The styles
 * are injected rather than written as utility classes — this project ships no
 * utility CSS framework, so a class like `bg-[#1a2634]` would render as
 * nothing at all. Tokens from globals.css are used where a brand colour is
 * wanted (gold, accent, red) so the board tracks the site theme.
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

interface HistoryEntry {
  id: number;
  multiplier: number;
  win: boolean;
}

/** How many chips fit the history bar before the oldest rolls off. */
const HISTORY_LENGTH = 12;

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

const STYLE_ID = 'fg-chicken-road-styles';

/* Lane geometry is shared by the markings, the tiles and the chicken, so the
   three can never drift apart: one lane is 100/LANES percent wide and the
   chicken sits on its centre line. */
const LANE_PCT = 100 / GAME_CONFIG.LANES;

const CSS = `
.cr { display: flex; flex-direction: column; gap: 18px; width: 100%;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #e6edf3; }
@media (min-width: 1024px) { .cr { flex-direction: row; align-items: stretch; } }

/* ── Board ─────────────────────────────────────────── */
.cr__board { position: relative; display: flex; flex-direction: column;
  flex: 1 1 auto; width: 100%; max-width: 1000px; min-height: 700px;
  margin-inline: auto; padding: 32px; box-sizing: border-box;
  background: #0f1923; border: 1px solid #1f2c3a; border-radius: 16px;
  overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.55), 0 2px 0 rgba(255,255,255,.03) inset; }

/* A slow sweep of light across the asphalt. Purely atmospheric — it carries no
   state and never sits above the playable tiles. */
.cr__board::after { content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(120% 60% at 50% -10%, rgba(80,150,255,.10), transparent 60%); }

/* ── Recent multipliers ────────────────────────────── */
.cr__history { display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
  margin-bottom: 14px; min-height: 34px; }
.cr__history-label { font-size: 10px; font-weight: 700; letter-spacing: .12em;
  text-transform: uppercase; color: #64788c; white-space: nowrap; }
.cr__history-list { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px;
  scrollbar-width: none; }
.cr__history-list::-webkit-scrollbar { display: none; }
.cr__chip { flex: 0 0 auto; padding: 5px 10px; font-size: 12px; font-weight: 700;
  font-variant-numeric: tabular-nums; border-radius: 999px; border: 1px solid transparent;
  animation: cr-chip-in .3s ease-out both; }
.cr__chip--win { color: #00e701; background: rgba(0,231,1,.12); border-color: rgba(0,231,1,.32); }
.cr__chip--loss { color: #f0616d; background: rgba(240,97,109,.12); border-color: rgba(240,97,109,.3); }
.cr__history-empty { font-size: 12px; color: #4d5f70; }

/* ── Road surface ──────────────────────────────────── */
.cr__road { position: relative; flex: 1 1 auto; display: flex; flex-direction: column;
  border-radius: 12px; overflow: hidden; background: #1a2634;
  /* Asphalt: a fine diagonal grain over the base slate keeps the surface from
     reading as flat fill at large sizes. */
  background-image:
    repeating-linear-gradient(48deg, rgba(255,255,255,.014) 0 2px, transparent 2px 5px),
    repeating-linear-gradient(-38deg, rgba(0,0,0,.16) 0 3px, transparent 3px 7px),
    radial-gradient(90% 70% at 50% 0%, rgba(255,255,255,.05), transparent 70%);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.04), inset 0 30px 60px rgba(0,0,0,.35); }

/* Solid edge lines, then the dashed centre lines between lanes. */
.cr__edge { position: absolute; top: 0; bottom: 0; width: 3px; background: rgba(255,255,255,.55);
  box-shadow: 0 0 10px rgba(255,255,255,.35); }
.cr__edge--l { left: 10px; } .cr__edge--r { right: 10px; }
/* The overhang must exceed one dash cycle (62px): the strip scrolls a full
   cycle before resetting, and a shorter overhang would expose bare asphalt at
   the top on every loop. */
.cr__divider { position: absolute; top: -80px; bottom: -80px; width: 5px; margin-left: -2.5px;
  background: repeating-linear-gradient(to bottom,
    #ffd24a 0 30px, rgba(255,210,74,0) 30px 62px);
  filter: drop-shadow(0 0 6px rgba(255,200,60,.75));
  opacity: .9; animation: cr-road-flow 3.4s linear infinite; }

/* ── Rows and tiles ────────────────────────────────── */
.cr__rows { position: relative; z-index: 1; display: flex; flex-direction: column;
  flex: 1 1 auto; }
.cr__row { display: flex; align-items: center; justify-content: space-around;
  flex: 1 1 0; min-height: 74px; padding: 0 18px; opacity: .48;
  transition: opacity .3s ease-in-out, background .3s ease-in-out; }
.cr__row--lit { opacity: 1; }
/* The row the player must click next: a band of light across the asphalt so
   the target is unmistakable without reading any text. */
.cr__row--active { opacity: 1;
  background: linear-gradient(90deg, transparent, rgba(0,231,1,.10) 18%, rgba(0,231,1,.10) 82%, transparent);
  box-shadow: inset 0 1px 0 rgba(0,231,1,.28), inset 0 -1px 0 rgba(0,231,1,.28); }

.cr__tile { position: relative; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 1px;
  width: 66px; height: 66px; padding: 0; border-radius: 50%;
  font-family: inherit; color: #cfe0ee; cursor: default;
  border: 3px solid #2b3d4e;
  /* Milled metal: a light source above, a machined lip below. */
  background:
    radial-gradient(circle at 50% 32%, #4a5d70 0%, #2a3948 58%, #1a2531 100%);
  box-shadow:
    inset 0 2px 3px rgba(255,255,255,.16),
    inset 0 -7px 14px rgba(0,0,0,.55),
    0 6px 14px rgba(0,0,0,.45);
  transition: transform .3s ease-in-out, border-color .3s ease-in-out,
    box-shadow .3s ease-in-out, background .3s ease-in-out; }
/* The concentric ring every cast cover has. */
.cr__tile::before { content: ''; position: absolute; inset: 7px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,.09); }

.cr__tile--live { cursor: pointer; border-color: rgba(0,231,1,.5);
  animation: cr-pulse 1.8s ease-in-out infinite; }
.cr__tile--live:hover { transform: translateY(-3px) scale(1.09);
  border-color: #00e701;
  box-shadow: inset 0 2px 3px rgba(255,255,255,.2), inset 0 -7px 14px rgba(0,0,0,.5),
    0 10px 22px rgba(0,0,0,.5), 0 0 22px rgba(0,231,1,.55); }
.cr__tile--live:focus-visible { outline: none; border-color: #00e701;
  box-shadow: 0 0 0 3px rgba(0,231,1,.35), 0 0 22px rgba(0,231,1,.5); }
.cr__tile--live:active { transform: translateY(-1px) scale(1.03); }

.cr__payout { font-size: 11.5px; font-weight: 800; line-height: 1.1;
  font-variant-numeric: tabular-nums; color: #f5b83d;
  text-shadow: 0 1px 2px rgba(0,0,0,.7); }
.cr__mult { font-size: 9px; font-weight: 600; line-height: 1;
  font-variant-numeric: tabular-nums; color: #8ea4b8; }
.cr__tile--live .cr__payout { color: #ffd97a; }

/* Cleared tiles hold the coin the player banked; hit tiles glow red. */
.cr__tile--coin { border-color: rgba(245,184,61,.5); background:
  radial-gradient(circle at 50% 32%, #3d4b3a 0%, #26301f 60%, #171d14 100%); }
.cr__tile--car { border-color: rgba(240,97,109,.35); }
.cr__tile--hit { border-color: #f0616d;
  background: radial-gradient(circle at 50% 35%, #5d2730 0%, #34161c 65%, #1d0d10 100%);
  box-shadow: inset 0 -6px 14px rgba(0,0,0,.5), 0 0 26px rgba(240,97,109,.6);
  animation: cr-alarm 1s ease-in-out infinite; }
.cr__glyph { font-size: 26px; line-height: 1; filter: drop-shadow(0 2px 3px rgba(0,0,0,.6)); }
.cr__glyph--car { animation: cr-car-in .45s cubic-bezier(.2,.85,.25,1) both; }
.cr__glyph--ghost { font-size: 22px; opacity: .34; filter: grayscale(.6); }

/* ── Chicken ───────────────────────────────────────── */
.cr__chicken { position: absolute; z-index: 2; width: 52px; height: 52px;
  display: flex; align-items: center; justify-content: center; pointer-events: none;
  /* The slide between lanes. Position is driven by inline percentages, so the
     transition is the whole of the movement. */
  transition: left .3s ease-in-out, bottom .3s ease-in-out; }
.cr__chicken-hop { font-size: 38px; line-height: 1;
  filter: drop-shadow(0 6px 8px rgba(0,0,0,.6));
  animation: cr-hop .34s ease-in-out; }
.cr__chicken--dead .cr__chicken-hop { animation: cr-burst .5s ease-out both; }

/* ── Pads ──────────────────────────────────────────── */
.cr__pad { flex: 0 0 auto; display: flex; align-items: center; justify-content: center;
  gap: 10px; margin-top: 10px; padding: 9px; font-size: 10px; font-weight: 700;
  letter-spacing: .24em; text-transform: uppercase; color: #64788c;
  border-top: 2px dashed #26374a; }

/* ── Idle veil ─────────────────────────────────────── */
.cr__veil { position: absolute; inset: 0; z-index: 3; display: flex;
  align-items: center; justify-content: center; padding: 24px; text-align: center;
  background: rgba(9,16,23,.62); backdrop-filter: blur(3px); }
.cr__veil span { padding: 12px 20px; font-size: 14px; font-weight: 600;
  color: #dbe7f2; background: rgba(0,0,0,.55); border: 1px solid #263748;
  border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.5); }

/* ── Control panel ─────────────────────────────────── */
.cr__panel { display: flex; flex-direction: column; gap: 14px; width: 100%;
  flex: 0 0 auto; padding: 18px; box-sizing: border-box;
  background: #15232d; border: 1px solid #22323f; border-radius: 16px;
  box-shadow: 0 18px 40px rgba(0,0,0,.45); }
@media (min-width: 1024px) { .cr__panel { width: 350px; } }

.cr__stat { padding: 12px; text-align: center; background: rgba(0,0,0,.24);
  border: 1px solid #22323f; border-radius: 10px; }
.cr__stat-label { font-size: 10px; font-weight: 700; letter-spacing: .12em;
  text-transform: uppercase; color: #64788c; }
.cr__stat-value { margin-top: 3px; font-size: 21px; font-weight: 800;
  font-variant-numeric: tabular-nums; color: #00e701; }

.cr__live { text-align: center; padding: 6px 0; }
.cr__live-mult { font-size: 40px; font-weight: 800; line-height: 1;
  font-variant-numeric: tabular-nums; color: #f5b83d;
  text-shadow: 0 0 26px rgba(245,184,61,.45); }
.cr__live-next { margin-top: 5px; font-size: 11px; color: #64788c; }
.cr__live-next b { color: #cfe0ee; font-weight: 700; }

.cr__label { font-size: 11px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: #64788c; }
.cr__row-inputs { display: flex; gap: 8px; margin-top: 7px; }
.cr__input { flex: 1 1 auto; min-width: 0; width: 100%; box-sizing: border-box;
  padding: 11px 12px; font-family: inherit; font-size: 15px; font-weight: 600;
  font-variant-numeric: tabular-nums; color: #e6edf3; background: #0e1922;
  border: 1px solid #26374a; border-radius: 9px; outline: none;
  transition: border-color .3s ease-in-out, box-shadow .3s ease-in-out; }
.cr__input:focus-visible { border-color: #f5b83d; box-shadow: 0 0 0 3px rgba(245,184,61,.2); }
.cr__input:disabled { opacity: .5; cursor: not-allowed; }
.cr__mod { flex: 0 0 auto; min-width: 46px; padding: 0 12px; font-family: inherit;
  font-size: 13px; font-weight: 700; color: #cfe0ee; background: #1c2c38;
  border: 1px solid #26374a; border-radius: 9px; cursor: pointer;
  transition: background .3s ease-in-out, color .3s ease-in-out, transform .12s ease; }
.cr__mod:hover:not(:disabled) { background: #24384a; color: #fff; }
.cr__mod:active:not(:disabled) { transform: translateY(1px); }
.cr__mod:disabled { opacity: .45; cursor: not-allowed; }

.cr__banner { padding: 11px; text-align: center; font-size: 13px; font-weight: 700;
  border-radius: 10px; animation: cr-chip-in .3s ease-out both; }
.cr__banner--loss { color: #f0616d; background: rgba(240,97,109,.12);
  border: 1px solid rgba(240,97,109,.3); }
.cr__banner--win { color: #00e701; background: rgba(0,231,1,.12);
  border: 1px solid rgba(0,231,1,.3); }

.cr__action { margin-top: auto; width: 100%; padding: 15px 16px; font-family: inherit;
  font-size: 15px; font-weight: 800; letter-spacing: .02em; color: #08120a;
  background: #00e701; border: none; border-radius: 10px; cursor: pointer;
  transition: filter .3s ease-in-out, transform .12s ease, box-shadow .3s ease-in-out;
  box-shadow: 0 8px 22px rgba(0,231,1,.25); }
.cr__action:hover:not(:disabled) { filter: brightness(1.1); box-shadow: 0 10px 28px rgba(0,231,1,.4); }
.cr__action:active:not(:disabled) { transform: translateY(1px); }
.cr__action:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(0,231,1,.4); }
.cr__action:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
.cr__action--cash { color: #1a1204; background: #f5b83d; box-shadow: 0 8px 22px rgba(245,184,61,.25); }
.cr__action--cash:hover:not(:disabled) { box-shadow: 0 10px 28px rgba(245,184,61,.4); }
.cr__action--again { color: #06131d; background: #4aa8ff; box-shadow: 0 8px 22px rgba(74,168,255,.25); }
.cr__action-sub { display: block; margin-top: 2px; font-size: 12px; font-weight: 700; opacity: .8; }

/* ── Motion ────────────────────────────────────────── */
@keyframes cr-hop {
  0% { transform: translateY(0) scale(1); }
  45% { transform: translateY(-16px) scale(1.14, .9); }
  100% { transform: translateY(0) scale(1); }
}
@keyframes cr-pulse {
  0%, 100% { box-shadow: inset 0 2px 3px rgba(255,255,255,.16), inset 0 -7px 14px rgba(0,0,0,.55),
    0 6px 14px rgba(0,0,0,.45), 0 0 0 rgba(0,231,1,0); }
  50% { box-shadow: inset 0 2px 3px rgba(255,255,255,.16), inset 0 -7px 14px rgba(0,0,0,.55),
    0 6px 14px rgba(0,0,0,.45), 0 0 20px rgba(0,231,1,.5); }
}
@keyframes cr-alarm {
  0%, 100% { box-shadow: inset 0 -6px 14px rgba(0,0,0,.5), 0 0 18px rgba(240,97,109,.45); }
  50% { box-shadow: inset 0 -6px 14px rgba(0,0,0,.5), 0 0 34px rgba(240,97,109,.85); }
}
@keyframes cr-car-in {
  from { transform: translateY(-120px) scale(.7); opacity: 0; }
  to { transform: translateY(0) scale(1); opacity: 1; }
}
@keyframes cr-burst {
  0% { transform: scale(1); }
  40% { transform: scale(1.5); }
  100% { transform: scale(1.2); opacity: .9; }
}
@keyframes cr-chip-in {
  from { transform: translateY(-6px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
@keyframes cr-road-flow {
  from { transform: translateY(0); }
  to { transform: translateY(62px); }
}

@media (prefers-reduced-motion: reduce) {
  .cr__divider, .cr__tile--live, .cr__tile--hit, .cr__chicken-hop,
  .cr__glyph--car, .cr__chip, .cr__banner { animation: none; }
  .cr__chicken, .cr__tile, .cr__row, .cr__action, .cr__mod, .cr__input {
    transition-duration: .01s; }
}
`;

export default function ChickenRoad() {
  useInjectedStyles(STYLE_ID, CSS);

  const [gameState, setGameState] = useState<GameStateValue>(GAME_STATE.IDLE);
  const [currentRow, setCurrentRow] = useState(0);
  const [path, setPath] = useState<number[]>([]);
  const [betAmount, setBetAmount] = useState(10);
  const [balance, setBalance] = useState(1000);
  const [board, setBoard] = useState<Cell[][]>([]);
  const [revealedCells, setRevealedCells] = useState<Record<string, Cell>>({});
  const [crashLane, setCrashLane] = useState<number | null>(null);
  const [lastWin, setLastWin] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const multiplier = useMemo(() => multiplierAt(currentRow), [currentRow]);
  const isPlaying = gameState === GAME_STATE.PLAYING;
  const nextMultiplier = multiplierAt(currentRow + 1);

  const pushHistory = useCallback((value: number, win: boolean) => {
    setHistory((prev) =>
      [{ id: Date.now() + Math.random(), multiplier: value, win }, ...prev].slice(
        0,
        HISTORY_LENGTH,
      ),
    );
  }, []);

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
    const taken = multiplierAt(currentRow);
    const payout = Number((betAmount * taken).toFixed(2));
    setBalance((b) => Number((b + payout).toFixed(2)));
    setLastWin(payout);
    setGameState(GAME_STATE.CASHED_OUT);
    pushHistory(taken, true);
  }, [isPlaying, currentRow, betAmount, pushHistory]);

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
        pushHistory(multiplierAt(row), false);
        return;
      }

      setRevealedCells((prev) => ({ ...prev, [`${row}-${lane}`]: cell }));

      const nextRow = currentRow + 1;
      setCurrentRow(nextRow);

      if (nextRow >= GAME_CONFIG.ROWS) {
        const taken = multiplierAt(nextRow);
        const payout = Number((betAmount * taken).toFixed(2));
        setBalance((b) => Number((b + payout).toFixed(2)));
        setLastWin(payout);
        setGameState(GAME_STATE.CASHED_OUT);
        pushHistory(taken, true);
      }
    },
    [isPlaying, currentRow, board, betAmount, pushHistory],
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
  const canBet = betAmount >= GAME_CONFIG.MIN_BET && betAmount <= balance;

  // Rendered bottom-up: the chicken starts at the bottom and climbs.
  const rowIndexes = Array.from({ length: GAME_CONFIG.ROWS }, (_, i) => GAME_CONFIG.ROWS - 1 - i);
  const dividers = Array.from({ length: GAME_CONFIG.LANES - 1 }, (_, i) => (i + 1) * LANE_PCT);

  return (
    <div className="cr">
      {/* ---------- Board ---------- */}
      <div className="cr__board">
        <div className="cr__history">
          <span className="cr__history-label">Recent</span>
          <div className="cr__history-list">
            {history.length === 0 ? (
              <span className="cr__history-empty">No rounds yet</span>
            ) : (
              history.map((entry) => (
                <span
                  key={entry.id}
                  className={`cr__chip ${entry.win ? 'cr__chip--win' : 'cr__chip--loss'}`}
                >
                  {entry.multiplier.toFixed(2)}×
                </span>
              ))
            )}
          </div>
        </div>

        <div className="cr__road">
          <span className="cr__edge cr__edge--l" aria-hidden="true" />
          <span className="cr__edge cr__edge--r" aria-hidden="true" />
          {dividers.map((left) => (
            <span
              key={left}
              className="cr__divider"
              style={{ left: `${left}%` }}
              aria-hidden="true"
            />
          ))}

          <div className="cr__rows">
            {rowIndexes.map((row) => {
              const isActive = isPlaying && row === currentRow;
              const rowMultiplier = multiplierAt(row + 1);
              const rowPayout = betAmount * rowMultiplier;
              const chosenLane = path[row];
              const lit = isActive || isOver || row < currentRow;

              return (
                <div
                  key={row}
                  className={[
                    'cr__row',
                    lit ? 'cr__row--lit' : '',
                    isActive ? 'cr__row--active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
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
                          className="cr__tile cr__tile--live"
                          aria-label={`Lane ${lane + 1}: win ${GAME_CONFIG.CURRENCY}${rowPayout.toFixed(2)} at ${rowMultiplier.toFixed(2)}x`}
                        >
                          <span className="cr__payout">
                            {GAME_CONFIG.CURRENCY}
                            {rowPayout.toFixed(2)}
                          </span>
                          <span className="cr__mult">{rowMultiplier.toFixed(2)}×</span>
                        </button>
                      );
                    }

                    return (
                      <div
                        key={lane}
                        className={[
                          'cr__tile',
                          isCrashCell ? 'cr__tile--hit' : '',
                          isCoin ? 'cr__tile--coin' : '',
                          !isCrashCell && revealed === 'car' ? 'cr__tile--car' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {isCrashCell ? (
                          <span className="cr__glyph cr__glyph--car">🚗</span>
                        ) : isCoin ? (
                          <span className="cr__glyph">🪙</span>
                        ) : revealed === 'car' ? (
                          <span className="cr__glyph cr__glyph--ghost">🚗</span>
                        ) : (
                          <>
                            <span className="cr__payout">
                              {GAME_CONFIG.CURRENCY}
                              {rowPayout.toFixed(2)}
                            </span>
                            <span className="cr__mult">{rowMultiplier.toFixed(2)}×</span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* Chicken — % positioning so it tracks any board height. The outer
                box slides; the inner glyph is keyed on the square it lands on,
                so React remounts it and the hop replays on every move. */}
            <div
              className={`cr__chicken ${
                gameState === GAME_STATE.CRASHED ? 'cr__chicken--dead' : ''
              }`}
              style={{
                left: `calc(${(chickenLane + 0.5) * LANE_PCT}% - 26px)`,
                bottom: `calc(${((chickenRow + 0.5) * 100) / GAME_CONFIG.ROWS}% - 26px)`,
              }}
              aria-hidden="true"
            >
              <span key={`${chickenRow}-${chickenLane}`} className="cr__chicken-hop">
                {gameState === GAME_STATE.CRASHED ? '💥' : '🐔'}
              </span>
            </div>
          </div>

          <div className="cr__pad">start</div>
        </div>

        {gameState === GAME_STATE.IDLE && (
          <div className="cr__veil">
            <span>Place your bet and start crossing</span>
          </div>
        )}
      </div>

      {/* ---------- Controls ---------- */}
      <div className="cr__panel">
        <div className="cr__stat">
          <div className="cr__stat-label">Balance</div>
          <div className="cr__stat-value">
            {GAME_CONFIG.CURRENCY}
            {balance.toFixed(2)}
          </div>
        </div>

        <div className="cr__live">
          <div className="cr__live-mult">{multiplier.toFixed(2)}×</div>
          {isPlaying && (
            <div className="cr__live-next">
              Next: <b>{nextMultiplier.toFixed(2)}×</b>
            </div>
          )}
        </div>

        <div>
          <label className="cr__label" htmlFor="cr-bet">
            Bet Amount
          </label>
          <div className="cr__row-inputs">
            <input
              id="cr-bet"
              className="cr__input"
              type="number"
              min={GAME_CONFIG.MIN_BET}
              max={Math.min(GAME_CONFIG.MAX_BET, balance)}
              step={1}
              value={betAmount}
              disabled={isPlaying}
              onChange={(e) => setBetAmount(Math.max(0, Number(e.target.value)))}
            />
            <button
              type="button"
              className="cr__mod"
              disabled={isPlaying}
              onClick={() =>
                setBetAmount((b) => Math.max(GAME_CONFIG.MIN_BET, Number((b / 2).toFixed(2))))
              }
              aria-label="Halve bet amount"
            >
              ½
            </button>
            <button
              type="button"
              className="cr__mod"
              disabled={isPlaying}
              onClick={() =>
                setBetAmount((b) => Math.min(GAME_CONFIG.MAX_BET, Number((b * 2).toFixed(2))))
              }
              aria-label="Double bet amount"
            >
              2×
            </button>
          </div>
        </div>

        {gameState === GAME_STATE.CRASHED && (
          <div className="cr__banner cr__banner--loss" role="status">
            💥 Hit by a car! You lost {GAME_CONFIG.CURRENCY}
            {betAmount.toFixed(2)}
          </div>
        )}
        {gameState === GAME_STATE.CASHED_OUT && (
          <div className="cr__banner cr__banner--win" role="status">
            🎉 Cashed out {GAME_CONFIG.CURRENCY}
            {(lastWin ?? 0).toFixed(2)}!
          </div>
        )}

        {isPlaying ? (
          <button
            type="button"
            className="cr__action cr__action--cash"
            onClick={cashOut}
            disabled={currentRow === 0}
          >
            Cash Out
            <span className="cr__action-sub">
              {GAME_CONFIG.CURRENCY}
              {(betAmount * multiplier).toFixed(2)} · {multiplier.toFixed(2)}×
            </span>
          </button>
        ) : gameState === GAME_STATE.IDLE ? (
          <button
            type="button"
            className="cr__action"
            onClick={startGame}
            disabled={!canBet}
          >
            Place Bet
            <span className="cr__action-sub">
              {GAME_CONFIG.CURRENCY}
              {betAmount.toFixed(2)}
            </span>
          </button>
        ) : (
          <button type="button" className="cr__action cr__action--again" onClick={reset}>
            Play Again
          </button>
        )}
      </div>
    </div>
  );
}
