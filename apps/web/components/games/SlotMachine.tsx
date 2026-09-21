'use client';

/**
 * FRIGAT — Slot machine (5 reels × 3 rows, 5 fixed paylines)
 *
 * The spin is decided by the server before a reel stops. `POST /api/games/slots/spin`
 * debits the stake, resolves the matrix from the committed seed, credits the win
 * and logs the round; this component receives that finished matrix and animates
 * the reels *onto* it. Nothing here decides an outcome, and nothing here moves
 * money — the reels are choreography over a settled result.
 *
 * Because of that, the animation is free to take as long as it likes. The
 * request is fired the moment SPIN is pressed and the reels keep spinning until
 * both a minimum spin time has elapsed and the response has landed, so a fast
 * server does not produce a stutter and a slow one just spins a little longer.
 *
 * Balance: the header reads `useBalance`, which only ever updates from socket
 * frames. The spin route pushes a BALANCE frame after settling, so the header
 * follows automatically — this component deliberately has no way to write a
 * balance, and treats the `newBalance` in the response as display only.
 *
 * Styling is injected CSS: this project ships no utility CSS framework.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import {
  BET_LIMITS,
  SLOTS_PAYLINES,
  SLOTS_PAYLINE_NAMES,
  SLOTS_PAYTABLE,
  SLOTS_REELS,
  SLOTS_ROWS,
  SLOTS_SYMBOLS,
} from '@frigat/shared';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { openPanel } from '@/lib/appPanels';
import { ApiError, apiJson } from '@/lib/api';
import { consumedAsSessionExpiry } from '@/lib/sessionExpiry';
import {
  clampDecimal,
  compareDecimal,
  divideDecimal,
  formatDecimalString,
  isDecimalString,
  multiplyDecimal,
  safeDecimal,
  sanitizeDecimalInput,
} from '@/lib/decimal';
import { useCanvasRenderer, type CanvasFrame } from '@/lib/useCanvasRenderer';
import { useInjectedStyles } from '@/lib/useInjectedStyles';
import { useLanguage } from '@/components/providers/LanguageProvider';

import {
  SETTLE_TRAVEL,
  SILENT,
  STRIP_LENGTH,
  TIMING,
  useDefaultSounds,
  type Reel,
  type ReelPhase,
  type SlotSounds,
  type SlotSpinResponse,
} from './slotMachine/choreography';
import {
  NEON,
  SYMBOL_COLOURS,
  drawSymbol,
  easeOutBack,
  makeStrip,
  roundRect,
} from './slotMachine/symbols';
import { CSS, STYLE_ID } from './slotMachine/styles';

// The sound and response types were part of this file before it was split three
// ways; re-exported so nothing that reached for them here has to move.
export type { SlotSounds, SlotSpinResponse } from './slotMachine/choreography';


// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

type Phase = 'IDLE' | 'SPINNING' | 'RESULT';

/** Shared so the panel can tell this failure apart and offer a deposit. */
const INSUFFICIENT = 'Not enough balance for this bet';

export interface SlotMachineProps {
  /** Swap in real audio; omit to use the built-in synthesised blips. */
  sounds?: Partial<SlotSounds>;
}

export default function SlotMachine({ sounds }: SlotMachineProps = {}) {
  const { t } = useLanguage();
  useInjectedStyles(STYLE_ID, CSS);

  const { balance: wallet } = useGameSocket();

  const [bet, setBet] = useState<string>('1.00');
  const [phase, setPhase] = useState<Phase>('IDLE');
  const [result, setResult] = useState<SlotSpinResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set when the spin failed for want of funds, so the panel offers a deposit. */
  const [needsFunds, setNeedsFunds] = useState(false);
  const [soundOn, setSoundOn] = useState(false);

  const defaults = useDefaultSounds(soundOn);
  const audio = useMemo<SlotSounds>(
    () => ({ ...SILENT, ...(soundOn ? defaults : SILENT), ...sounds }),
    [defaults, soundOn, sounds]
  );
  const audioRef = useRef(audio);
  audioRef.current = audio;

  // Reel state lives in a ref: the render loop mutates it every frame and must
  // never restart, and none of it belongs in React's update cycle.
  const reelsRef = useRef<Reel[]>(
    Array.from({ length: SLOTS_REELS }, () => ({
      strip: makeStrip(),
      offset: 0,
      velocity: 0,
      phase: 'idle' as ReelPhase,
      settleAt: null,
      settleFrom: 0,
      settleTo: 0,
      settleStartedAt: 0,
    }))
  );
  const spinStartedAtRef = useRef(0);
  const winCellsRef = useRef<Array<{ cells: Array<[number, number]>; lineIndex: number }>>([]);
  const resolvedAtRef = useRef<number | null>(null);
  /** Set once every reel has come to rest, so the flash and sound fire once. */
  const settledRef = useRef(true);
  const pendingResultRef = useRef<SlotSpinResponse | null>(null);

  const balance = wallet.balance;
  const busy = phase === 'SPINNING';

  /**
   * The stake as a value the decimal helpers can actually take.
   *
   * `bet` is whatever is in the field, including the half-typed states a player
   * passes through — `""` while clearing it, `"1."` on the way to `"1.5"`.
   * `compareDecimal` throws on those, and thrown from this `useMemo` it took
   * the whole board down instead of showing a validation message.
   */
  const safeBet = useMemo(() => safeDecimal(bet, BET_LIMITS.min), [bet]);

  const betError = useMemo(() => {
    // An empty or unparseable field is "not ready", not "invalid": the player
    // is mid-edit and does not need to be told off for it.
    if (!isDecimalString(bet.trim())) return null;
    if (compareDecimal(safeBet, BET_LIMITS.min) < 0) {
      return `Minimum bet is ${formatDecimalString(BET_LIMITS.min, 2)}`;
    }
    if (compareDecimal(safeBet, BET_LIMITS.max) > 0) {
      return `Maximum bet is ${formatDecimalString(BET_LIMITS.max, 2)}`;
    }
    // Digit-wise against the ledger's own string; parsing to a number here is
    // exactly the float drift the Decimal column exists to avoid.
    if (balance !== null && compareDecimal(safeBet, balance) > 0) {
      return INSUFFICIENT;
    }
    return null;
  }, [bet, safeBet, balance]);

  /** True only when the field holds a stake that can actually be wagered. */
  const betReady = useMemo(
    () => isDecimalString(bet.trim()) && betError === null,
    [bet, betError]
  );

  const maxBet = useMemo(() => {
    if (balance === null) return BET_LIMITS.max;
    return compareDecimal(balance, BET_LIMITS.max) < 0 ? balance : BET_LIMITS.max;
  }, [balance]);

  /**
   * Quick-adjust and blur both land here. The value is clamped to the table
   * limits and shown to 2dp so the field always reads like money, while the
   * arithmetic behind it stays exact BigInt decimal work.
   */
  const adjust = useCallback((next: string) => {
    const clamped = clampDecimal(next, BET_LIMITS.min, BET_LIMITS.max);
    setBet(formatDecimalString(clamped, 2).replace(/,/g, ''));
  }, []);

  // ── Spin ───────────────────────────────────
  const spin = useCallback(async () => {
    if (busy || !betReady) return;

    const now = performance.now();
    setError(null);
    setNeedsFunds(false);
    setResult(null);
    setPhase('SPINNING');
    winCellsRef.current = [];
    resolvedAtRef.current = null;
    settledRef.current = false;
    pendingResultRef.current = null;
    spinStartedAtRef.current = now;

    for (const reel of reelsRef.current) {
      reel.strip = makeStrip();
      reel.phase = 'accelerating';
      reel.settleAt = null;
      reel.velocity = 0;
    }
    audioRef.current.onSpinStart();

    try {
      // No leading slash: apiFetch resolves a bare path against API_URL, while
      // an absolute one would post to the Next origin instead of the API.
      const response = await apiJson<SlotSpinResponse>('api/games/slots/spin', {
        method: 'POST',
        body: JSON.stringify({ betAmount: Number(bet) }),
      });

      // Write the settled matrix into each strip at the cell the reel will land
      // on, then schedule the staggered stops. The reels are still turning, so
      // the player never sees the write.
      const readyAt = Math.max(
        performance.now(),
        spinStartedAtRef.current + TIMING.minSpinMs
      );
      reelsRef.current.forEach((reel, index) => {
        const landing =
          (Math.floor(reel.offset) + SETTLE_TRAVEL + index * 2) % STRIP_LENGTH;
        const column = response.reelMatrix[index] ?? [];
        for (let row = 0; row < SLOTS_ROWS; row += 1) {
          reel.strip[(landing + row) % STRIP_LENGTH] = column[row];
        }
        reel.settleTo = landing;
        reel.settleAt = readyAt + index * TIMING.stagger;
      });

      pendingResultRef.current = response;
    } catch (err) {
      // A dead session is not something the player can fix from here: clear it
      // and hand off to sign-in rather than showing a red toast they can only
      // retry into another 401.
      if (consumedAsSessionExpiry(err)) return;

      // The stake is only debited on a 2xx; a rejected spin leaves the wallet
      // untouched, so the reels just coast to a stop on nothing.
      const message =
        err instanceof ApiError
          ? err.message
          : 'Could not reach the game server — no bet was placed';
      // 402 is the ledger refusing the stake: there is no demo balance to fall
      // back on, so the only useful next step is a deposit.
      if (err instanceof ApiError && err.status === 402) setNeedsFunds(true);
      setError(message);
      setPhase('IDLE');
      const stopAt = performance.now();
      reelsRef.current.forEach((reel, index) => {
        reel.settleTo = (Math.floor(reel.offset) + SETTLE_TRAVEL) % STRIP_LENGTH;
        reel.settleAt = stopAt + index * 90;
      });
      settledRef.current = true;
    }
  }, [busy, betError, bet]);

  // ── Renderer ───────────────────────────────
  const draw = useCallback(({ ctx, width, height, delta }: CanvasFrame) => {
    const now = performance.now();
    const dt = Math.min(delta, 50) / 1000;

    const cellW = width / SLOTS_REELS;
    const cellH = height / SLOTS_ROWS;
    const symbolSize = Math.min(cellW, cellH) * 0.78;

    // ── Reel physics ──
    let allStopped = true;
    for (const reel of reelsRef.current) {
      switch (reel.phase) {
        case 'accelerating': {
          const t = Math.min(1, (now - spinStartedAtRef.current) / TIMING.accelerateMs);
          // Quadratic ramp: the reel leans into the spin instead of snapping to speed.
          reel.velocity = TIMING.topSpeed * t * t;
          if (t >= 1) reel.phase = 'spinning';
          reel.offset += reel.velocity * dt;
          allStopped = false;
          break;
        }
        case 'spinning': {
          reel.offset += reel.velocity * dt;
          if (reel.settleAt !== null && now >= reel.settleAt) {
            reel.phase = 'settling';
            reel.settleStartedAt = now;
            reel.settleFrom = reel.offset;
            // Land on the next occurrence of the target cell that is far enough
            // ahead to keep the settle moving forwards.
            const cycles = Math.ceil(
              (reel.offset + SETTLE_TRAVEL - reel.settleTo) / STRIP_LENGTH
            );
            reel.settleTo += cycles * STRIP_LENGTH;
          }
          allStopped = false;
          break;
        }
        case 'settling': {
          const t = Math.min(1, (now - reel.settleStartedAt) / TIMING.settleMs);
          const eased = easeOutBack(t);
          reel.offset = reel.settleFrom + (reel.settleTo - reel.settleFrom) * eased;
          reel.velocity = ((reel.settleTo - reel.settleFrom) * (1 - t)) / (TIMING.settleMs / 1000);
          if (t >= 1) {
            reel.offset = reel.settleTo;
            reel.velocity = 0;
            reel.phase = 'stopped';
            audioRef.current.onReelStop(reelsRef.current.indexOf(reel));
          } else {
            allStopped = false;
          }
          break;
        }
        default:
          break;
      }
    }

    // Every reel has come to rest: publish the result exactly once.
    if (allStopped && !settledRef.current) {
      settledRef.current = true;
      const pending = pendingResultRef.current;
      if (pending) {
        winCellsRef.current = pending.winningLines.map((line) => ({
          cells: line.cells,
          lineIndex: line.lineIndex,
        }));
        resolvedAtRef.current = now;
        setResult(pending);
        setPhase('RESULT');
        if (compareDecimal(pending.totalWin, '0') > 0) audioRef.current.onWin(pending.totalWin);
        else audioRef.current.onLose();
      }
    }

    // ── Board ──
    ctx.fillStyle = '#070b11';
    ctx.fillRect(0, 0, width, height);

    const winning = new Set(
      winCellsRef.current.flatMap((line) => line.cells.map(([r, c]) => `${r}:${c}`))
    );

    for (let reelIndex = 0; reelIndex < SLOTS_REELS; reelIndex += 1) {
      const reel = reelsRef.current[reelIndex];
      const x = reelIndex * cellW;

      // Reel backing, so each column reads as its own drum.
      ctx.fillStyle = reelIndex % 2 === 0 ? '#0d141c' : '#101922';
      ctx.fillRect(x, 0, cellW, height);

      const fractional = reel.offset - Math.floor(reel.offset);
      const base = Math.floor(reel.offset);
      // Motion blur: at speed, each symbol is smeared into ghosts along the
      // travel axis rather than drawn once — cheap, and it reads correctly
      // because the ghosts are the same sprite the reel is carrying.
      const blur = Math.min(1, Math.abs(reel.velocity) / TIMING.topSpeed);
      const ghosts = blur > 0.04 ? Math.round(2 + blur * 5) : 1;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, 0, cellW, height);
      ctx.clip();

      // One row of overdraw top and bottom keeps symbols entering and leaving
      // the window instead of appearing at its edge.
      for (let row = -1; row <= SLOTS_ROWS; row += 1) {
        const symbol = reel.strip[(base + row + STRIP_LENGTH * 2) % STRIP_LENGTH];
        if (!symbol) continue;
        const cy = (row - fractional + 0.5) * cellH;
        const cx = x + cellW / 2;

        if (ghosts === 1) {
          const lit = reel.phase === 'stopped' && winning.has(`${reelIndex}:${row}`);
          if (lit) {
            ctx.save();
            ctx.shadowColor = SYMBOL_COLOURS[symbol].glow;
            ctx.shadowBlur = symbolSize * 0.45;
            drawSymbol(ctx, symbol, cx, cy, symbolSize);
            ctx.restore();
          } else {
            drawSymbol(ctx, symbol, cx, cy, symbolSize, reel.phase === 'stopped' ? 1 : 0.9);
          }
        } else {
          const spread = cellH * blur * 0.55;
          for (let g = 0; g < ghosts; g += 1) {
            const k = g / (ghosts - 1) - 0.5;
            drawSymbol(ctx, symbol, cx, cy + k * spread, symbolSize, 0.85 / ghosts + 0.08);
          }
        }
      }
      ctx.restore();

      // Column separator.
      ctx.fillStyle = 'rgba(148,163,184,.14)';
      ctx.fillRect(x + cellW - 1, 0, 1, height);
    }

    // ── Winning paylines: glowing neon/gold overlay ──
    if (winCellsRef.current.length && resolvedAtRef.current !== null) {
      const age = now - resolvedAtRef.current;
      const pulse = 0.55 + 0.45 * Math.sin(age / 190);

      winCellsRef.current.forEach((line, i) => {
        const colour = NEON[line.lineIndex % NEON.length];
        const rows = SLOTS_PAYLINES[line.lineIndex];
        if (!rows) return;

        ctx.save();
        ctx.globalAlpha = 0.35 + 0.45 * pulse;
        ctx.strokeStyle = colour;
        ctx.shadowColor = colour;
        ctx.shadowBlur = 18 * pulse;
        ctx.lineWidth = Math.max(3, cellH * 0.055);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        // The path is drawn across the whole line; the cells that actually paid
        // get a frame, so a 3-of-5 win still reads as "these three".
        ctx.beginPath();
        rows.forEach((row, reelIndex) => {
          const px = reelIndex * cellW + cellW / 2;
          const py = (row + 0.5) * cellH;
          if (reelIndex === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();

        ctx.globalAlpha = 0.8 + 0.2 * pulse;
        ctx.lineWidth = Math.max(2, cellH * 0.03);
        for (const [reelIndex, row] of line.cells) {
          roundRect(
            ctx,
            reelIndex * cellW + cellW * 0.06,
            row * cellH + cellH * 0.06,
            cellW * 0.88,
            cellH * 0.88,
            Math.min(cellW, cellH) * 0.12
          );
          ctx.stroke();
        }

        // Line number in the left margin of its own row.
        ctx.globalAlpha = 0.9;
        ctx.shadowBlur = 0;
        ctx.fillStyle = colour;
        ctx.font = `900 ${Math.max(10, cellH * 0.14)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${line.lineIndex + 1}`, cellW * 0.03, (rows[0] + 0.5) * cellH - i * 2);
        ctx.restore();
      });
    }

    // ── Row guides ──
    ctx.strokeStyle = 'rgba(148,163,184,.1)';
    ctx.lineWidth = 1;
    for (let row = 1; row < SLOTS_ROWS; row += 1) {
      ctx.beginPath();
      ctx.moveTo(0, row * cellH);
      ctx.lineTo(width, row * cellH);
      ctx.stroke();
    }

    // Glass: a soft vignette so the reels sit behind a screen.
    const glass = ctx.createLinearGradient(0, 0, 0, height);
    glass.addColorStop(0, 'rgba(0,0,0,.55)');
    glass.addColorStop(0.5, 'rgba(0,0,0,0)');
    glass.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = glass;
    ctx.fillRect(0, 0, width, height);
  }, []);

  const canvasRef = useCanvasRenderer(draw);

  const totalWin = result?.totalWin ?? '0';
  const hasWin = compareDecimal(totalWin, '0') > 0;

  return (
    <div className="slot">
      {/* ---------- Cabinet ---------- */}
      <div className="slot__cabinet">
        <div className="slot__marquee">
          <h2 className="slot__title">{t('gameUi.slotsTitle')}</h2>
          <div className="slot__meta">
            <span className="slot__chip">Bet {formatDecimalString(bet, 2)}</span>
            <span className={`slot__chip${hasWin ? ' slot__chip--win' : ''}`}>
              Win {formatDecimalString(totalWin, 2)}
            </span>
          </div>
        </div>

        <div className="slot__screen">
          <canvas ref={canvasRef} className="slot__canvas" />
          {phase === 'RESULT' && hasWin && (
            <div className="slot__flash" role="status">
              {result!.winningLines.length} line
              {result!.winningLines.length === 1 ? '' : 's'} ·{' '}
              {formatDecimalString(totalWin, 2)} {wallet.currency}
            </div>
          )}
        </div>
      </div>

      {/* ---------- Controls ---------- */}
      <div className="slot__panel">
        <div>
          <label className="slot__label" htmlFor="slot-bet">
            <span>{t('gameUi.betAmount')}</span>
            <b>
              {wallet.hasSynced ? `${wallet.formatted} ${wallet.currency}` : '—'}
            </b>
          </label>
          <div className="slot__inputs">
            <input
              id="slot-bet"
              className="slot__input"
              type="text"
              inputMode="decimal"
              value={bet}
              disabled={busy}
              aria-invalid={betError !== null}
              onChange={(e) => setBet(sanitizeDecimalInput(e.target.value))}
              onBlur={() => adjust(bet === '' ? BET_LIMITS.min : bet)}
            />
          </div>
          <div className="slot__quick">
            <button
              type="button"
              className="slot__mod"
              disabled={busy}
              onClick={() => adjust(BET_LIMITS.min)}
            >
              Min
            </button>
            <button
              type="button"
              className="slot__mod"
              disabled={busy}
              onClick={() => adjust(divideDecimal(bet, 2n))}
            >
              ½
            </button>
            <button
              type="button"
              className="slot__mod"
              disabled={busy}
              onClick={() => adjust(multiplyDecimal(bet, 2n))}
            >
              2x
            </button>
            <button
              type="button"
              className="slot__mod"
              disabled={busy}
              onClick={() => adjust(maxBet)}
            >
              Max
            </button>
          </div>
        </div>

        <button
          type="button"
          className={`slot__spin${busy ? ' slot__spin--busy' : ''}`}
          onClick={spin}
          disabled={busy || !betReady}
        >
          {busy ? 'Spinning…' : 'Spin'}
        </button>

        {betError && !busy && (
          <p className="slot__error">
            {betError}
            {betError === INSUFFICIENT && (
              <button
                type="button"
                className="slot__deposit"
                onClick={() => openPanel('deposit')}
              >
                Deposit
              </button>
            )}
          </p>
        )}
        {error && (
          <p className="slot__error">
            {error}
            {needsFunds && (
              <button
                type="button"
                className="slot__deposit"
                onClick={() => openPanel('deposit')}
              >
                Deposit
              </button>
            )}
          </p>
        )}

        <div className="slot__row">
          <span className="slot__label" style={{ margin: 0 }}>
            Sound
          </span>
          <button
            type="button"
            className="slot__toggle"
            aria-pressed={soundOn}
            onClick={() => setSoundOn((on) => !on)}
          >
            {soundOn ? 'On' : 'Off'}
          </button>
        </div>

        {result && result.winningLines.length > 0 && (
          <ul className="slot__lines">
            {result.winningLines.map((line) => (
              <li className="slot__line" key={line.lineIndex}>
                <span className="slot__line-name">
                  <span
                    className="slot__swatch"
                    style={{ background: NEON[line.lineIndex % NEON.length] }}
                  />
                  {SLOTS_PAYLINE_NAMES[line.lineIndex]} · {line.count}× {line.symbol}
                </span>
                <span className="slot__line-pay">
                  +{formatDecimalString(line.payout, 2)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="slot__paytable">
          <div className="slot__paytable-grid">
            <span className="slot__paytable-head">{t('gameUi.slotsSymbol')}</span>
            <span className="slot__paytable-head slot__paytable-val">3</span>
            <span className="slot__paytable-head slot__paytable-val">4</span>
            <span className="slot__paytable-head slot__paytable-val">5</span>
            {SLOTS_SYMBOLS.map((symbol) => (
              <span key={symbol} style={{ display: 'contents' }}>
                <span className="slot__paytable-sym">
                  <span
                    className="slot__swatch"
                    style={{ background: SYMBOL_COLOURS[symbol].body }}
                  />
                  {symbol}
                </span>
                <span className="slot__paytable-val">{SLOTS_PAYTABLE[symbol][3]}</span>
                <span className="slot__paytable-val">{SLOTS_PAYTABLE[symbol][4]}</span>
                <span className="slot__paytable-val">{SLOTS_PAYTABLE[symbol][5]}</span>
              </span>
            ))}
          </div>
          <p className="slot__foot" style={{ marginTop: 10 }}>
            Awards are multiples of the line stake; the bet is split across all 5
            lines. Wins pay left to right from reel 1, and WILD substitutes for
            every symbol. Every spin is resolved and settled on the server.
          </p>
        </div>
      </div>
    </div>
  );
}

