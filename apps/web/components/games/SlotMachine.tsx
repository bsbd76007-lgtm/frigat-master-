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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  BET_LIMITS,
  SLOTS_PAYLINES,
  SLOTS_PAYLINE_NAMES,
  SLOTS_PAYTABLE,
  SLOTS_REELS,
  SLOTS_ROWS,
  SLOTS_SYMBOLS,
  SLOTS_WEIGHTS,
  type SlotSymbol,
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

// ─────────────────────────────────────────────
// Spin choreography
// ─────────────────────────────────────────────

const TIMING = {
  /** Ramp from rest to full speed. */
  accelerateMs: 380,
  /** Reels keep turning at least this long, however fast the server answers. */
  minSpinMs: 950,
  /** Gap between one reel stopping and the next. */
  stagger: 200,
  /** Length of the settle, including the elastic overshoot. */
  settleMs: 520,
  /** Symbols per second at full speed. */
  topSpeed: 26,
} as const;

/** Cells of runway a reel covers while settling — enough to stay a blur. */
const SETTLE_TRAVEL = 7;

/** Strip length per reel. Long enough that the landing window is never seen twice. */
const STRIP_LENGTH = 64;

type ReelPhase = 'idle' | 'accelerating' | 'spinning' | 'settling' | 'stopped';

interface Reel {
  /** Symbols the reel is carrying; the landing window is written in on stop. */
  strip: SlotSymbol[];
  /** Scroll position in symbol cells. */
  offset: number;
  velocity: number;
  phase: ReelPhase;
  /** When this reel should begin settling (performance.now), once known. */
  settleAt: number | null;
  settleFrom: number;
  settleTo: number;
  settleStartedAt: number;
}

export interface SlotSpinResponse {
  sessionId: string;
  reelMatrix: SlotSymbol[][];
  winningLines: Array<{
    lineIndex: number;
    symbol: SlotSymbol;
    count: number;
    cells: Array<[number, number]>;
    payout: string;
  }>;
  totalWin: string;
  newBalance: string;
  betAmount: string;
  multiplier: number;
  hashedServerSeed: string;
  clientSeed: string;
  nonce: number;
}

/**
 * Sound triggers. Left as injectable no-ops so a host app can drop in real
 * samples without this component owning an asset pipeline; the built-in
 * fallback synthesises tones with WebAudio and is muted until asked for.
 */
export interface SlotSounds {
  onSpinStart: () => void;
  onReelStop: (reelIndex: number) => void;
  onWin: (totalWin: string) => void;
  onLose: () => void;
}

const SILENT: SlotSounds = {
  onSpinStart: () => {},
  onReelStop: () => {},
  onWin: () => {},
  onLose: () => {},
};

/**
 * Minimal WebAudio blips, created lazily on the first *user-gesture-driven*
 * play so the browser's autoplay policy is never tripped.
 */
function useDefaultSounds(enabled: boolean): SlotSounds {
  const ctxRef = useRef<AudioContext | null>(null);

  const tone = useCallback(
    (frequency: number, durationMs: number, type: OscillatorType = 'triangle', gain = 0.05) => {
      if (!enabled || typeof window === 'undefined') return;
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctor) return;
      const audio: AudioContext = ctxRef.current ?? (ctxRef.current = new Ctor());
      if (audio.state === 'suspended') void audio.resume();

      const osc = audio.createOscillator();
      const amp = audio.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      amp.gain.setValueAtTime(gain, audio.currentTime);
      amp.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + durationMs / 1000);
      osc.connect(amp).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + durationMs / 1000);
    },
    [enabled]
  );

  useEffect(
    () => () => {
      void ctxRef.current?.close();
      ctxRef.current = null;
    },
    []
  );

  return useMemo<SlotSounds>(
    () => ({
      onSpinStart: () => tone(180, 140, 'sawtooth', 0.035),
      onReelStop: (reel) => tone(300 + reel * 45, 90, 'square', 0.03),
      onWin: () => {
        tone(660, 140);
        window.setTimeout(() => tone(880, 180), 120);
        window.setTimeout(() => tone(1180, 260), 260);
      },
      onLose: () => tone(140, 180, 'sine', 0.02),
    }),
    [tone]
  );
}

// ─────────────────────────────────────────────
// Symbols
// ─────────────────────────────────────────────

const SYMBOL_COLOURS: Record<SlotSymbol, { body: string; edge: string; glow: string }> = {
  CHERRY: { body: '#e5484d', edge: '#7f1d1d', glow: '#d69199' },
  LEMON: { body: '#e0b055', edge: '#854d0e', glow: '#fde68a' },
  ORANGE: { body: '#fb923c', edge: '#7c2d12', glow: '#fed7aa' },
  PLUM: { body: '#a855f7', edge: '#4c1d95', glow: '#e9d5ff' },
  BELL: { body: '#fbbf24', edge: '#78350f', glow: '#fef3c7' },
  BAR: { body: '#e2e8f0', edge: '#1e293b', glow: '#f8fafc' },
  SEVEN: { body: '#ef4444', edge: '#450a0a', glow: '#fecaca' },
  WILD: { body: '#f59e0b', edge: '#0b0e14', glow: '#bbf7d0' },
};

const WEIGHT_TOTAL = SLOTS_SYMBOLS.reduce((sum, s) => sum + SLOTS_WEIGHTS[s], 0);

/**
 * A weighted symbol for the *decorative* strip only. The blur between stops is
 * cosmetic — the symbols that matter arrive from the server — but drawing them
 * from the real weights keeps a spin from looking unlike its own paytable.
 */
function decorativeSymbol(): SlotSymbol {
  let roll = Math.random() * WEIGHT_TOTAL;
  for (const symbol of SLOTS_SYMBOLS) {
    roll -= SLOTS_WEIGHTS[symbol];
    if (roll <= 0) return symbol;
  }
  return SLOTS_SYMBOLS[SLOTS_SYMBOLS.length - 1];
}

function makeStrip(): SlotSymbol[] {
  return Array.from({ length: STRIP_LENGTH }, decorativeSymbol);
}

/** Rounded rectangle path — the plate every symbol is drawn on. */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Draws one symbol centred in a cell. Everything is derived from `size` so the
 * board scales cleanly from a phone to a desktop without a second asset set.
 */
function drawSymbol(
  ctx: CanvasRenderingContext2D,
  symbol: SlotSymbol,
  cx: number,
  cy: number,
  size: number,
  alpha = 1
) {
  const palette = SYMBOL_COLOURS[symbol];
  const r = size * 0.3;

  ctx.save();
  ctx.globalAlpha = alpha;

  switch (symbol) {
    case 'CHERRY': {
      ctx.strokeStyle = '#166534';
      ctx.lineWidth = Math.max(2, size * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx + size * 0.02, cy - size * 0.34);
      ctx.quadraticCurveTo(cx - size * 0.22, cy - size * 0.1, cx - size * 0.17, cy + size * 0.08);
      ctx.moveTo(cx + size * 0.02, cy - size * 0.34);
      ctx.quadraticCurveTo(cx + size * 0.26, cy - size * 0.06, cx + size * 0.18, cy + size * 0.1);
      ctx.stroke();
      for (const [dx, dy, rr] of [
        [-0.17, 0.19, 0.15],
        [0.18, 0.21, 0.15],
      ] as const) {
        ctx.beginPath();
        ctx.arc(cx + size * dx, cy + size * dy, size * rr, 0, Math.PI * 2);
        ctx.fillStyle = palette.body;
        ctx.fill();
        ctx.strokeStyle = palette.edge;
        ctx.lineWidth = Math.max(1.5, size * 0.03);
        ctx.stroke();
      }
      break;
    }
    case 'LEMON':
    case 'ORANGE':
    case 'PLUM': {
      ctx.beginPath();
      if (symbol === 'LEMON') {
        ctx.ellipse(cx, cy, r * 1.15, r * 0.82, 0, 0, Math.PI * 2);
      } else {
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = palette.body;
      ctx.fill();
      ctx.strokeStyle = palette.edge;
      ctx.lineWidth = Math.max(2, size * 0.035);
      ctx.stroke();
      // Highlight, so the fruit reads as round rather than flat.
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.3, cy - r * 0.35, r * 0.28, r * 0.18, -0.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.fill();
      if (symbol !== 'LEMON') {
        ctx.strokeStyle = '#166534';
        ctx.lineWidth = Math.max(2, size * 0.04);
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + size * 0.04, cy - r - size * 0.1);
        ctx.stroke();
      }
      break;
    }
    case 'BELL': {
      ctx.beginPath();
      ctx.moveTo(cx - r, cy + r * 0.62);
      ctx.quadraticCurveTo(cx - r * 0.92, cy - r * 0.5, cx, cy - r * 0.95);
      ctx.quadraticCurveTo(cx + r * 0.92, cy - r * 0.5, cx + r, cy + r * 0.62);
      ctx.closePath();
      ctx.fillStyle = palette.body;
      ctx.fill();
      ctx.strokeStyle = palette.edge;
      ctx.lineWidth = Math.max(2, size * 0.035);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.78, r * 0.19, 0, Math.PI * 2);
      ctx.fillStyle = palette.edge;
      ctx.fill();
      break;
    }
    case 'BAR': {
      const w = size * 0.62;
      const h = size * 0.22;
      for (let i = -1; i <= 1; i += 1) {
        roundRect(ctx, cx - w / 2, cy + i * h * 1.22 - h / 2, w, h, h * 0.35);
        ctx.fillStyle = palette.body;
        ctx.fill();
        ctx.strokeStyle = palette.edge;
        ctx.lineWidth = Math.max(1.5, size * 0.025);
        ctx.stroke();
      }
      ctx.fillStyle = palette.edge;
      ctx.font = `800 ${size * 0.15}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BAR', cx, cy + size * 0.005);
      break;
    }
    case 'SEVEN': {
      ctx.fillStyle = palette.body;
      ctx.strokeStyle = palette.edge;
      ctx.lineWidth = Math.max(2, size * 0.04);
      ctx.font = `900 ${size * 0.74}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('7', cx, cy + size * 0.02);
      ctx.strokeText('7', cx, cy + size * 0.02);
      break;
    }
    case 'WILD': {
      // Five-pointed star: unmistakable at a glance, which matters for the
      // symbol that substitutes for every other one.
      ctx.beginPath();
      for (let i = 0; i < 10; i += 1) {
        const radius = i % 2 === 0 ? r * 1.12 : r * 0.46;
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = palette.body;
      ctx.fill();
      ctx.strokeStyle = palette.edge;
      ctx.lineWidth = Math.max(2, size * 0.035);
      ctx.stroke();
      ctx.fillStyle = palette.edge;
      ctx.font = `900 ${size * 0.17}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('W', cx, cy + size * 0.01);
      break;
    }
  }

  ctx.restore();
}

/** Overshoot easing — the reel passes its stop and springs back onto it. */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

const NEON = ['#e0b055', '#22d3ee', '#a855f7', '#f59e0b', '#fb7185'];

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────

const STYLE_ID = 'fg-slot-machine-styles';

const CSS = `
.slot { display: flex; flex-direction: column; align-items: center; gap: 24px;
  width: 100%; max-width: 1180px; margin-inline: auto; padding: 16px;
  box-sizing: border-box; color: #e2e8f0;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (min-width: 1024px) {
  .slot { flex-direction: row; align-items: flex-start; justify-content: center; }
}

/* ── Cabinet ───────────────────────────────── */
.slot__cabinet { position: relative; width: 100%; max-width: 760px; min-width: 0;
  padding: 18px; box-sizing: border-box; border-radius: 20px;
  background: linear-gradient(180deg, #1b2735 0%, #0d141c 100%);
  border: 1px solid #253243;
  box-shadow: 0 30px 60px -20px rgba(0,0,0,.75), inset 0 1px 0 rgba(255,255,255,.06); }

.slot__marquee { display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-bottom: 14px; padding: 0 4px; }
.slot__title { margin: 0; font-size: 15px; font-weight: 900; letter-spacing: .18em;
  text-transform: uppercase;
  background: linear-gradient(90deg, var(--fg-gold), #fb923c, var(--fg-gold));
  -webkit-background-clip: text; background-clip: text; color: transparent; }
.slot__meta { display: flex; gap: 8px; }
.slot__chip { padding: 5px 11px; font-size: 11px; font-weight: 800; letter-spacing: .06em;
  text-transform: uppercase; color: #94a3b8; background: rgba(148,163,184,.12);
  border: 1px solid rgba(148,163,184,.2); border-radius: 999px;
  font-variant-numeric: tabular-nums; }
.slot__chip--win { color: #0b0e14; background: var(--fg-accent); border-color: var(--fg-accent); }

.slot__screen { position: relative; width: 100%; aspect-ratio: 5 / 3;
  border-radius: 14px; overflow: hidden; background: #070b11;
  border: 3px solid #2c3a4c;
  box-shadow: inset 0 0 44px rgba(0,0,0,.85); }
.slot__canvas { display: block; width: 100%; height: 100%; }

/* Win banner rides over the reels without stealing a click from SPIN. */
.slot__flash { position: absolute; inset: auto 0 0 0; padding: 10px;
  text-align: center; font-size: 15px; font-weight: 900; letter-spacing: .04em;
  color: #0b0e14; background: linear-gradient(90deg, rgba(250,204,21,.94), rgba(34,197,94,.94));
  pointer-events: none; animation: slot-flash-in .35s ease both; }
@keyframes slot-flash-in { from { transform: translateY(100%); } to { transform: translateY(0); } }

/* ── Panel ─────────────────────────────────── */
.slot__panel { display: flex; flex-direction: column; gap: 16px; width: 100%;
  max-width: 760px; min-width: 0; flex: 0 0 auto; padding: 24px; box-sizing: border-box;
  background: #121c24; border: 1px solid #1e293b; border-radius: 16px;
  box-shadow: 0 20px 25px -5px rgba(0,0,0,.5); }
@media (min-width: 1024px) { .slot__panel { width: 340px; } }

.slot__label { display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 8px; font-size: 11px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: #64748b; }
.slot__label b { font-size: 13px; color: var(--fg-gold); letter-spacing: 0;
  font-variant-numeric: tabular-nums; }

.slot__inputs { display: flex; gap: 6px; }
.slot__input { flex: 1 1 auto; min-width: 0; width: 100%; box-sizing: border-box;
  padding: 12px 13px; font-family: inherit; font-size: 15px; font-weight: 700;
  font-variant-numeric: tabular-nums; color: #f1f5f9; background: #0b141b;
  border: 1px solid #1e293b; border-radius: 10px; outline: none;
  transition: border-color .2s ease, box-shadow .2s ease; }
.slot__input:focus-visible { border-color: var(--fg-accent); box-shadow: 0 0 0 3px rgba(34,197,94,.22); }
.slot__input:disabled { opacity: .5; cursor: not-allowed; }

.slot__quick { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
  margin-top: 8px; }
.slot__mod { padding: 10px 4px; font-family: inherit; font-size: 12px; font-weight: 800;
  color: #cbd5e1; background: #0b141b; border: 1px solid #1e293b; border-radius: 10px;
  cursor: pointer; transition: background .2s ease, color .2s ease, transform .12s ease; }
.slot__mod:hover:not(:disabled) { color: #fff; background: #1e293b; }
.slot__mod:active:not(:disabled) { transform: translateY(1px); }
.slot__mod:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.3); }
.slot__mod:disabled { opacity: .45; cursor: not-allowed; }

/* ── SPIN ──────────────────────────────────── */
.slot__spin { position: relative; width: 100%; padding: 18px; overflow: hidden;
  font-family: inherit; font-size: 18px; font-weight: 900; letter-spacing: .12em;
  text-transform: uppercase; color: #0b0e14;
  background: linear-gradient(90deg, var(--fg-accent), var(--fg-accent-deep)); border: none;
  border-radius: 14px; cursor: pointer;
  box-shadow: 0 12px 24px -6px rgba(34,197,94,.5);
  transition: background .2s ease, box-shadow .2s ease, transform .12s ease; }
.slot__spin:hover:not(:disabled) { background: linear-gradient(90deg, var(--fg-pos), var(--fg-accent));
  box-shadow: 0 16px 30px -6px rgba(34,197,94,.7); }
.slot__spin:active:not(:disabled) { transform: translateY(2px); }
.slot__spin:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.5); }
.slot__spin:disabled { color: #94a3b8;
  background: linear-gradient(90deg, #1e293b, #142029); box-shadow: none; cursor: not-allowed; }
/* Sheen sweeps only while the button is live, so "armed" reads at a glance. */
.slot__spin::after { content: ''; position: absolute; top: 0; bottom: 0; width: 40%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent);
  transform: translateX(-150%); }
.slot__spin:not(:disabled)::after { animation: slot-sheen 2.6s ease-in-out infinite; }
@keyframes slot-sheen {
  0%, 55% { transform: translateX(-150%); }
  100% { transform: translateX(320%); }
}
.slot__spin--busy { animation: slot-pulse 1s ease-in-out infinite; }
@keyframes slot-pulse { 50% { opacity: .72; } }

.slot__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.slot__toggle { padding: 9px 12px; font-family: inherit; font-size: 12px; font-weight: 800;
  color: #cbd5e1; background: #0b141b; border: 1px solid #1e293b; border-radius: 10px;
  cursor: pointer; }
.slot__toggle:hover { color: #fff; background: #1e293b; }
.slot__toggle:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.3); }
.slot__toggle[aria-pressed="true"] { color: #0b0e14; background: var(--fg-accent); border-color: var(--fg-accent); }

.slot__error { display: flex; align-items: center; justify-content: space-between; gap: 10px;
  margin: 0; padding: 10px; font-size: 12px; font-weight: 700; text-align: left;
  color: #d69199; background: rgba(239,68,68,.14); border: 1px solid rgba(239,68,68,.4);
  border-radius: 10px; }
.slot__deposit { flex: 0 0 auto; padding: 6px 13px; font-family: inherit; font-size: 11px;
  font-weight: 800; letter-spacing: .04em; color: #0b0e14; background: var(--fg-accent); border: 0;
  border-radius: 999px; cursor: pointer; }
.slot__deposit:hover { filter: brightness(1.08); }
.slot__deposit:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.4); }

/* ── Win list & paytable ───────────────────── */
.slot__lines { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0;
  list-style: none; }
.slot__line { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 10px; font-size: 12px; font-weight: 700; border-radius: 8px;
  background: rgba(250,204,21,.1); border: 1px solid rgba(250,204,21,.28); }
.slot__line-name { display: flex; align-items: center; gap: 8px; color: #fde68a; }
.slot__swatch { width: 10px; height: 10px; border-radius: 2px; }
.slot__line-pay { color: var(--fg-accent); font-variant-numeric: tabular-nums; }

.slot__paytable { border-top: 1px solid #1e293b; padding-top: 14px; }
.slot__paytable-grid { display: grid; grid-template-columns: 1fr auto auto auto; gap: 4px 10px;
  font-size: 11px; font-variant-numeric: tabular-nums; }
.slot__paytable-head { font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
  color: #64748b; }
.slot__paytable-sym { display: flex; align-items: center; gap: 7px; color: #cbd5e1;
  font-weight: 700; }
.slot__paytable-val { text-align: right; color: #94a3b8; }
.slot__foot { margin: 0; font-size: 10px; line-height: 1.5; color: #475569; }
`;

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

import { useLanguage } from '@/components/providers/LanguageProvider';

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
