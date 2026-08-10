'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useCanvasRenderer, type CanvasFrame } from '@/lib/useCanvasRenderer';
import { useInjectedStyles } from '@/lib/useInjectedStyles';

/**
 * Chicken Road — top-down arcade crossing, drawn on a canvas.
 *
 * The chicken starts on the bottom verge and climbs one lane per press. Cars
 * run each lane at their own speed and direction; while the chicken stands in
 * a lane its box is tested against every car box, so a hit can land at any
 * moment rather than only on the step. Clear the top verge and the round banks
 * itself; cash out from any lane already reached.
 *
 * ── On the odds ────────────────────────────────────────────────────────────
 * Because a collision depends on where the cars happen to be, survival here is
 * a matter of timing rather than a fixed probability. That makes the ladder
 * unpriceable in the usual way — there is no hazard rate to derive it from,
 * and a player with a steady hand (or a slow frame rate) does not face the
 * same odds as anyone else. The multipliers below are therefore display
 * values on a demo board. A real-stakes version needs the outcome decided
 * server-side, not by the animation clock in one browser.
 *
 * Balance: the signed-in wallet is read-only (only the server moves money), so
 * rounds run on demo credit and a $0 or unsynced account never blocks play.
 *
 * Styling is injected CSS — this project ships no utility CSS framework, so
 * `bg-[#7c8b9e]` would resolve to nothing. The specified colours and
 * dimensions are written below in the form that renders here.
 */

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────

export const GAME_CONFIG = {
  lanes: 4,
  /** Paid once the matching lane is reached. */
  ladder: [1.25, 1.6, 2.1, 3.0],
  minBet: 1,
  maxBet: 1000,
  demoBalance: 1000,
  currency: '$',
  /** Cars per lane. */
  carsPerLane: 2,
} as const;

export type Phase = 'IDLE' | 'PLAYING' | 'WON' | 'LOST';

/**
 * Board geometry as fractions of the stage height. The canvas and the DOM
 * overlay both derive from these, so the coins and barriers can never drift
 * away from the asphalt they are supposed to sit on.
 */
const LAYOUT = {
  topGrass: 0.12,
  bottomGrass: 0.18,
  /** The chicken climbs left of centre so the coins stay readable. */
  chickenX: 0.26,
} as const;

const ROAD_HEIGHT = 1 - LAYOUT.topGrass - LAYOUT.bottomGrass;
const LANE_HEIGHT = ROAD_HEIGHT / GAME_CONFIG.lanes;

/** Centre of a lane, as a fraction of stage height from the top. */
function laneCentreFraction(lane: number): number {
  if (lane === 0) return 1 - LAYOUT.bottomGrass / 2;
  return LAYOUT.topGrass + ROAD_HEIGHT - (lane - 0.5) * LANE_HEIGHT;
}

/** The line a player crosses to clear `lane` — where its barrier lands. */
function laneEdgeFraction(lane: number): number {
  return laneCentreFraction(lane) - LANE_HEIGHT / 2;
}

/**
 * Per-lane crossing chance implied by the ladder: the step from one rung's
 * break-even probability to the next. Derived rather than hardcoded so the
 * badge can never disagree with what the lane actually pays.
 */
export function crossingChanceAt(lane: number): number {
  const survivalTo = (l: number) => (l <= 0 ? 1 : 0.99 / multiplierAt(l));
  return survivalTo(lane) / survivalTo(lane - 1);
}

interface Car {
  lane: number;
  /** Centre x, in canvas pixels. */
  x: number;
  /** Pixels per second; sign carries direction. */
  speed: number;
  width: number;
}

/** Multiplier once `lane` lanes are behind the chicken. */
export function multiplierAt(lane: number): number {
  if (lane <= 0) return 1;
  return GAME_CONFIG.ladder[Math.min(lane, GAME_CONFIG.lanes) - 1];
}

function money(value: number): string {
  return `${GAME_CONFIG.currency}${value.toFixed(2)}`;
}

// ─────────────────────────────────────────────
// Pixel-art sprites, drawn as blocks
// ─────────────────────────────────────────────

const PALETTE: Record<string, string> = {
  W: '#f8fafc', // body
  R: '#e5484d', // comb / car shell
  D: '#a01f25', // car shadow side
  B: '#f59e0b', // beak, legs
  E: '#0f172a', // eye, wheels
  G: '#cbd5e1', // glass
};

const CHICKEN = [
  '..RR....',
  '.RRRR...',
  '..WWEB..',
  '.WWWWW..',
  'WWWWWWW.',
  '.WWWWW..',
  '..B..B..',
];

const CAR = [
  '.RRRRRR.',
  'RRGGGGRR',
  'RRRRRRRR',
  'DDDDDDDD',
  '.E....E.',
];

function drawSprite(
  ctx: CanvasRenderingContext2D,
  rows: readonly string[],
  cx: number,
  cy: number,
  scale: number,
  flip = false
) {
  const w = rows[0].length * scale;
  const h = rows.length * scale;
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;

  for (let r = 0; r < rows.length; r += 1) {
    for (let c = 0; c < rows[r].length; c += 1) {
      const key = rows[r][flip ? rows[r].length - 1 - c : c];
      const colour = PALETTE[key];
      if (!colour) continue;
      ctx.fillStyle = colour;
      ctx.fillRect(
        Math.round(x0 + c * scale),
        Math.round(y0 + r * scale),
        Math.ceil(scale),
        Math.ceil(scale)
      );
    }
  }
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────

const STYLE_ID = 'fg-chicken-road-styles';

const CSS = `
.chr { display: flex; flex-direction: column; align-items: center; gap: 24px;
  width: 100%; max-width: 1100px; margin-inline: auto; padding: 16px;
  box-sizing: border-box; color: #e2e8f0;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (min-width: 1024px) {
  .chr { flex-direction: row; align-items: flex-start; justify-content: center; }
}

/* ── Canvas ────────────────────────────────────────── */
.chr__stage { position: relative; width: 100%; max-width: 700px; min-width: 0;
  aspect-ratio: 4 / 5; background: #7c8b9e; border: 4px solid #e5a059;
  border-radius: 16px; overflow: hidden;
  box-shadow: 0 25px 50px -12px rgba(0,0,0,.6); }
.chr__canvas { display: block; width: 100%; height: 100%; }
/* The whole stage is a step control while a round is live. */
.chr__tap { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0;
  background: transparent; border: 0; cursor: pointer; }
.chr__tap:focus-visible { outline: 3px solid #22c55e; outline-offset: -6px; }
.chr__tap:disabled { cursor: default; }

.chr__hud { position: absolute; left: 12px; right: 12px; top: 12px; display: flex;
  justify-content: space-between; gap: 8px; pointer-events: none; }
.chr__chip { padding: 5px 11px; font-size: 11px; font-weight: 800; letter-spacing: .06em;
  text-transform: uppercase; color: #0f172a; background: rgba(255,255,255,.82);
  border-radius: 999px; }

/* ── Overlay: coins and barriers, aligned to the canvas geometry ───────── */
.chr__overlay { position: absolute; inset: 0; pointer-events: none; }

/* Golden coin: a struck disc with a milled rim and a raised face. */
.chr__coin { position: absolute; left: 50%; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  width: 62px; height: 62px; margin-left: -31px; margin-top: -31px;
  border-radius: 50%; text-align: center;
  background:
    radial-gradient(circle at 50% 32%, #fff3c4 0%, #ffd76a 34%, #e8a935 62%, #b8791c 100%);
  box-shadow:
    inset 0 2px 3px rgba(255,255,255,.85),
    inset 0 -5px 9px rgba(120,71,10,.65),
    0 0 0 3px #c98a25,
    0 0 0 5px #8a5c14,
    0 6px 14px rgba(0,0,0,.45);
  transition: transform .3s ease, filter .3s ease, opacity .3s ease; }
/* Milled edge: fine ticks masked to the rim only. */
.chr__coin::before { content: ''; position: absolute; inset: -3px; border-radius: 50%;
  background: repeating-conic-gradient(from 0deg,
    rgba(255,255,255,.5) 0deg 3deg, rgba(120,71,10,.45) 3deg 6deg);
  opacity: .5; -webkit-mask: radial-gradient(circle, transparent 0 88%, #000 88%);
  mask: radial-gradient(circle, transparent 0 88%, #000 88%); }
/* Inner ring, so the face reads as struck rather than flat. */
.chr__coin::after { content: ''; position: absolute; inset: 8px; border-radius: 50%;
  border: 1px solid rgba(120,71,10,.4); pointer-events: none; }

.chr__coin-pct { position: relative; z-index: 1; font-size: 15px; font-weight: 900;
  line-height: 1; color: #4a2f06; text-shadow: 0 1px 0 rgba(255,255,255,.55); }
.chr__coin-mult { position: relative; z-index: 1; margin-top: 2px; font-size: 10.5px;
  font-weight: 800; line-height: 1; color: #6b451a;
  text-shadow: 0 1px 0 rgba(255,255,255,.45); }

.chr__coin--cleared { filter: saturate(.55) brightness(.8); transform: scale(.9); }
.chr__coin--next { animation: chr-coin-bob 1.9s ease-in-out infinite; }

/* Concrete barrier: lifted clear until its lane is crossed, then it drops. */
.chr__barrier { position: absolute; left: 6%; right: 6%; height: 15px; margin-top: -7px;
  border-radius: 3px; opacity: 0; transform: translateY(-26px);
  background:
    repeating-linear-gradient(90deg, rgba(0,0,0,.16) 0 2px, transparent 2px 26px),
    linear-gradient(180deg, #d8dce3 0%, #a9b1bb 55%, #7d848e 100%);
  border: 1px solid rgba(15,23,42,.5);
  box-shadow: 0 4px 10px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.55); }
/* Hazard flashes, so it reads as roadworks at a glance. */
.chr__barrier::after { content: ''; position: absolute; inset: 4px 8px; border-radius: 2px;
  background: repeating-linear-gradient(115deg, #e33a3a 0 9px, #f8fafc 9px 18px);
  opacity: .9; }
.chr__barrier--down { animation: chr-thud .42s cubic-bezier(.34,1.3,.5,1) forwards; }

@keyframes chr-coin-bob {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-4px) scale(1.04); }
}
/* Falls onto the crack mark and settles. */
@keyframes chr-thud {
  0% { transform: translateY(-26px) scaleY(.9); opacity: 0; }
  55% { transform: translateY(0) scaleY(1.12); opacity: 1; }
  75% { transform: translateY(-3px) scaleY(.96); opacity: 1; }
  100% { transform: translateY(0) scaleY(1); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .chr__coin--next { animation: none; }
  /* The barrier still lands — that is state, not decoration — it just snaps. */
  .chr__barrier--down { animation: none; opacity: 1; transform: translateY(0); }
}

/* ── Panel ─────────────────────────────────────────── */
.chr__panel { display: flex; flex-direction: column; gap: 16px; width: 100%;
  max-width: 700px; min-width: 0; flex: 0 0 auto; padding: 24px; box-sizing: border-box;
  background: #121c24; border: 1px solid #1e293b; border-radius: 16px;
  box-shadow: 0 20px 25px -5px rgba(0,0,0,.5); }
@media (min-width: 1024px) { .chr__panel { width: 320px; } }

.chr__stat { padding: 13px; text-align: center; background: rgba(0,0,0,.25);
  border: 1px solid #1e293b; border-radius: 12px; }
.chr__stat-label { font-size: 10px; font-weight: 700; letter-spacing: .12em;
  text-transform: uppercase; color: #64748b; }
.chr__stat-value { margin-top: 4px; font-size: 22px; font-weight: 800;
  font-variant-numeric: tabular-nums; color: #22c55e; }
.chr__stat-note { margin-top: 5px; font-size: 10px; font-weight: 600; color: #64748b; }

.chr__label { display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 8px; font-size: 11px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: #64748b; }
.chr__label b { font-size: 13px; color: #facc15; letter-spacing: 0; }

.chr__inputs { display: flex; gap: 6px; }
.chr__input { flex: 1 1 auto; min-width: 0; width: 100%; box-sizing: border-box;
  padding: 12px 13px; font-family: inherit; font-size: 15px; font-weight: 700;
  font-variant-numeric: tabular-nums; color: #f1f5f9; background: #0b141b;
  border: 1px solid #1e293b; border-radius: 10px; outline: none;
  transition: border-color .2s ease, box-shadow .2s ease; }
.chr__input:focus-visible { border-color: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,.22); }
.chr__input:disabled { opacity: .5; cursor: not-allowed; }
.chr__mod { flex: 0 0 auto; min-width: 42px; padding: 0 9px; font-family: inherit;
  font-size: 12px; font-weight: 800; color: #cbd5e1; background: #0b141b;
  border: 1px solid #1e293b; border-radius: 10px; cursor: pointer;
  transition: background .2s ease, color .2s ease, transform .12s ease; }
.chr__mod:hover:not(:disabled) { color: #fff; background: #1e293b; }
.chr__mod:active:not(:disabled) { transform: translateY(1px); }
.chr__mod:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.3); }
.chr__mod:disabled { opacity: .45; cursor: not-allowed; }

.chr__up { width: 100%; padding: 13px; font-family: inherit; font-size: 14px;
  font-weight: 800; color: #e2e8f0; background: #0b141b; border: 1px solid #334155;
  border-radius: 10px; cursor: pointer;
  transition: background .2s ease, border-color .2s ease, transform .12s ease; }
.chr__up:hover:not(:disabled) { background: #1e293b; border-color: #22c55e; }
.chr__up:active:not(:disabled) { transform: translateY(1px); }
.chr__up:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.35); }
.chr__up:disabled { opacity: .4; cursor: not-allowed; }

.chr__banner { padding: 11px; text-align: center; font-size: 13px; font-weight: 700;
  border-radius: 12px; }
.chr__banner--lost { color: #fca5a5; background: rgba(239,68,68,.14);
  border: 1px solid rgba(239,68,68,.4); }
.chr__banner--won { color: #86efac; background: rgba(34,197,94,.14);
  border: 1px solid rgba(34,197,94,.4); }
.chr__error { margin: 0; font-size: 12px; font-weight: 600; color: #f87171;
  text-align: center; }

.chr__action { width: 100%; padding: 16px; font-family: inherit; font-size: 17px;
  font-weight: 900; color: #052e16;
  background: linear-gradient(90deg, #22c55e, #16a34a); border: none;
  border-radius: 12px; cursor: pointer; box-shadow: 0 10px 20px -5px rgba(34,197,94,.4);
  transition: background .2s ease, box-shadow .2s ease, transform .12s ease; }
.chr__action:hover:not(:disabled) { background: linear-gradient(90deg, #4ade80, #22c55e);
  box-shadow: 0 14px 28px -6px rgba(34,197,94,.6); }
.chr__action:active:not(:disabled) { transform: translateY(1px); }
.chr__action:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.45); }
.chr__action:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
.chr__action--cash { color: #422006;
  background: linear-gradient(90deg, #facc15, #eab308);
  box-shadow: 0 10px 20px -5px rgba(250,204,21,.4); }
.chr__action--cash:hover:not(:disabled) { background: linear-gradient(90deg, #fde047, #facc15); }
.chr__hint { margin: 0; font-size: 11px; text-align: center; color: #475569; }
`;

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function ChickenRoad() {
  useInjectedStyles(STYLE_ID, CSS);

  // Read-only wallet: only the server moves it, so play runs on demo credit.
  const { balance: wallet } = useGameSocket();

  const [phase, setPhase] = useState<Phase>('IDLE');
  const [lane, setLane] = useState(0);
  const [bet, setBet] = useState(10);
  const [credit, setCredit] = useState<number>(GAME_CONFIG.demoBalance);
  const [lastWin, setLastWin] = useState<number | null>(null);

  // The render loop reads these rather than state, so it never restarts and
  // never closes over a stale value.
  const phaseRef = useRef<Phase>('IDLE');
  const laneRef = useRef(0);
  const carsRef = useRef<Car[]>([]);
  const crashAtRef = useRef<number | null>(null);
  const hopAtRef = useRef<number | null>(null);

  const isPlaying = phase === 'PLAYING';
  const isOver = phase === 'WON' || phase === 'LOST';
  const multiplier = multiplierAt(lane);
  const payout = Number((bet * multiplier).toFixed(2));
  const maxBet = Math.min(GAME_CONFIG.maxBet, Math.max(credit, GAME_CONFIG.minBet));
  const laneList = Array.from({ length: GAME_CONFIG.lanes }, (_, i) => i + 1);

  const betError = useMemo(() => {
    if (!Number.isFinite(bet) || bet < GAME_CONFIG.minBet) {
      return `Minimum bet is ${money(GAME_CONFIG.minBet)}`;
    }
    if (bet > GAME_CONFIG.maxBet) return `Maximum bet is ${money(GAME_CONFIG.maxBet)}`;
    if (bet > credit) return 'Not enough demo credit';
    return null;
  }, [bet, credit]);

  const setPhaseBoth = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const setLaneBoth = useCallback((next: number) => {
    laneRef.current = next;
    setLane(next);
  }, []);

  /** Cars are laid out per lane; lane 0 is the bottom verge and has none. */
  const spawnCars = useCallback(() => {
    const cars: Car[] = [];
    for (let l = 1; l <= GAME_CONFIG.lanes; l += 1) {
      const leftward = l % 2 === 0;
      for (let i = 0; i < GAME_CONFIG.carsPerLane; i += 1) {
        cars.push({
          lane: l,
          // Spread along the lane in normalised space; scaled at draw time.
          x: (i + 0.5) / GAME_CONFIG.carsPerLane,
          speed: (leftward ? -1 : 1) * (0.1 + l * 0.035 + i * 0.02),
          width: 0.16,
        });
      }
    }
    carsRef.current = cars;
  }, []);

  const startRound = useCallback(() => {
    if (betError) return;
    setCredit((c) => Number((c - bet).toFixed(2)));
    spawnCars();
    setLaneBoth(0);
    setLastWin(null);
    crashAtRef.current = null;
    hopAtRef.current = null;
    setPhaseBoth('PLAYING');
  }, [betError, bet, spawnCars, setLaneBoth, setPhaseBoth]);

  const cashOut = useCallback(() => {
    if (phaseRef.current !== 'PLAYING' || laneRef.current === 0) return;
    const won = Number((bet * multiplierAt(laneRef.current)).toFixed(2));
    setCredit((c) => Number((c + won).toFixed(2)));
    setLastWin(won);
    setPhaseBoth('WON');
  }, [bet, setPhaseBoth]);

  /** One lane up. Reaching the far verge banks the round automatically. */
  const advance = useCallback(() => {
    if (phaseRef.current !== 'PLAYING') return;
    const next = laneRef.current + 1;
    hopAtRef.current = performance.now();

    if (next > GAME_CONFIG.lanes) {
      const won = Number((bet * multiplierAt(GAME_CONFIG.lanes)).toFixed(2));
      setCredit((c) => Number((c + won).toFixed(2)));
      setLastWin(won);
      setLaneBoth(GAME_CONFIG.lanes);
      setPhaseBoth('WON');
      return;
    }
    setLaneBoth(next);
  }, [bet, setLaneBoth, setPhaseBoth]);

  // Arrow keys / W, as well as the on-screen control and the canvas itself.
  useEffect(() => {
    if (!isPlaying) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') {
        event.preventDefault();
        advance();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPlaying, advance]);

  const crash = useCallback(() => {
    if (phaseRef.current !== 'PLAYING') return;
    crashAtRef.current = performance.now();
    setPhaseBoth('LOST');
    // Spec: the chicken returns to the verge when the round ends.
    setLaneBoth(0);
  }, [setPhaseBoth, setLaneBoth]);

  // ── Renderer ───────────────────────────────────────
  const draw = useCallback(
    ({ ctx, width, height, delta }: CanvasFrame) => {
      const dt = Math.min(delta, 50) / 1000;

      // Vertical bands: top verge, the road, bottom verge.
      const topGrass = height * LAYOUT.topGrass;
      const bottomGrass = height * LAYOUT.bottomGrass;
      const roadTop = topGrass;
      const roadHeight = height * ROAD_HEIGHT;
      const laneHeight = height * LANE_HEIGHT;

      /** Lane 0 is the bottom verge; 1..N climb up the road. */
      const laneCentre = (l: number) => laneCentreFraction(l) * height;

      // ── Ground ──
      ctx.fillStyle = '#7c8b9e';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#6f9e57';
      ctx.fillRect(0, 0, width, topGrass);
      ctx.fillRect(0, height - bottomGrass, width, bottomGrass);

      // ── Asphalt ──
      ctx.fillStyle = '#3f4653';
      ctx.fillRect(0, roadTop, width, roadHeight);
      ctx.fillStyle = 'rgba(0,0,0,.10)';
      for (let y = roadTop; y < roadTop + roadHeight; y += 6) {
        ctx.fillRect(0, y, width, 1);
      }

      const dash = (y: number, colour: string, on: number, off: number, lw: number) => {
        ctx.strokeStyle = colour;
        ctx.lineWidth = lw;
        ctx.setLineDash([on, off]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.setLineDash([]);
      };

      // Yellow boundary lines top and bottom of the road.
      dash(roadTop + 2, '#facc15', 26, 18, 4);
      dash(roadTop + roadHeight - 2, '#facc15', 26, 18, 4);
      // White dashed dividers between lanes.
      for (let i = 1; i < GAME_CONFIG.lanes; i += 1) {
        dash(roadTop + i * laneHeight, 'rgba(255,255,255,.85)', 16, 14, 2);
      }

      // ── Cars ──
      const carScale = Math.max(2, Math.min(4, width / 150));
      for (const car of carsRef.current) {
        car.x += car.speed * dt;
        // Wrap around with a margin so nothing pops in mid-frame.
        if (car.x > 1.2) car.x = -0.2;
        if (car.x < -0.2) car.x = 1.2;
        drawSprite(
          ctx,
          CAR,
          car.x * width,
          laneCentre(car.lane),
          carScale,
          car.speed < 0
        );
      }

      // ── Chicken ──
      const chickenScale = Math.max(3, Math.min(6, width / 100));
      const hopAge = hopAtRef.current ? performance.now() - hopAtRef.current : Infinity;
      const hop = hopAge < 300 ? Math.sin((hopAge / 300) * Math.PI) * laneHeight * 0.3 : 0;
      const chickenX = width * LAYOUT.chickenX;
      const chickenY = laneCentre(laneRef.current) - hop;

      drawSprite(ctx, CHICKEN, chickenX, chickenY, chickenScale);

      // ── Collision: only while standing in the road ──
      if (phaseRef.current === 'PLAYING' && laneRef.current >= 1) {
        const chickenW = CHICKEN[0].length * chickenScale * 0.6;
        const chickenH = CHICKEN.length * chickenScale * 0.6;
        for (const car of carsRef.current) {
          if (car.lane !== laneRef.current) continue;
          const carW = CAR[0].length * carScale;
          const carH = CAR.length * carScale;
          const cx = car.x * width;
          const cy = laneCentre(car.lane);
          const overlaps =
            Math.abs(cx - chickenX) < (carW + chickenW) / 2 &&
            Math.abs(cy - chickenY) < (carH + chickenH) / 2;
          if (overlaps) {
            crash();
            break;
          }
        }
      }

      // ── Crash burst ──
      if (crashAtRef.current !== null) {
        const age = performance.now() - crashAtRef.current;
        if (age < 700) {
          const t = age / 700;
          const y = laneCentre(0);
          ctx.fillStyle = `rgba(239,68,68,${0.35 * (1 - t)})`;
          ctx.fillRect(0, 0, width, height);
          ctx.beginPath();
          ctx.arc(chickenX, y, 12 + t * 70, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,220,180,${0.9 * (1 - t)})`;
          ctx.lineWidth = 5 * (1 - t) + 1;
          ctx.stroke();
        } else {
          crashAtRef.current = null;
        }
      }
    },
    [crash]
  );

  const canvasRef = useCanvasRenderer(draw);

  return (
    <div className="chr">
      {/* ---------- Stage ---------- */}
      <div className="chr__stage">
        <canvas ref={canvasRef} className="chr__canvas" />

        {/* Coins and barriers sit above the canvas but take no pointer events,
            so the whole stage stays a single step control. Positions come from
            the same fractions the canvas draws with. */}
        <div className="chr__overlay" aria-hidden="true">
          {laneList.map((l) => (
            <div
              key={`coin-${l}`}
              className={[
                'chr__coin',
                l < lane ? 'chr__coin--cleared' : '',
                isPlaying && l === lane + 1 ? 'chr__coin--next' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ top: `${(laneCentreFraction(l) * 100).toFixed(3)}%` }}
            >
              <span className="chr__coin-pct">
                {Math.round(crossingChanceAt(l) * 100)}%
              </span>
              <span className="chr__coin-mult">{multiplierAt(l).toFixed(2)}x</span>
            </div>
          ))}

          {laneList.map((l) => (
            <div
              key={`barrier-${l}`}
              // Drops only once this lane is behind the chicken.
              className={`chr__barrier${l < lane ? ' chr__barrier--down' : ''}`}
              style={{ top: `${(laneEdgeFraction(l) * 100).toFixed(3)}%` }}
            />
          ))}
        </div>
        <div className="chr__hud">
          <span className="chr__chip">
            Lane {lane} / {GAME_CONFIG.lanes}
          </span>
          <span className="chr__chip">
            {lane === 0 ? money(0) : money(payout)}
          </span>
        </div>
        {/* The stage itself steps the chicken, alongside the arrow keys. */}
        <button
          type="button"
          className="chr__tap"
          onClick={advance}
          disabled={!isPlaying}
          aria-label="Cross to the next lane"
        />
      </div>

      {/* ---------- Controls ---------- */}
      <div className="chr__panel">
        <div className="chr__stat">
          <div className="chr__stat-label">Demo credit</div>
          <div className="chr__stat-value">{money(credit)}</div>
          <div className="chr__stat-note">
            Account: {wallet.hasSynced ? `${wallet.formatted} ${wallet.currency}` : '—'} ·
            not staked
          </div>
        </div>

        <div>
          <label className="chr__label" htmlFor="chr-bet">
            <span>Bet amount</span>
            <b>{multiplier.toFixed(2)}x</b>
          </label>
          <div className="chr__inputs">
            <input
              id="chr-bet"
              className="chr__input"
              type="number"
              inputMode="decimal"
              min={GAME_CONFIG.minBet}
              max={GAME_CONFIG.maxBet}
              step={1}
              value={Number.isFinite(bet) ? bet : ''}
              disabled={isPlaying}
              aria-invalid={betError !== null}
              onChange={(e) => setBet(Number(e.target.value))}
            />
            <button
              type="button"
              className="chr__mod"
              disabled={isPlaying}
              aria-label="Halve bet amount"
              onClick={() =>
                setBet((b) => Math.max(GAME_CONFIG.minBet, Number((b / 2).toFixed(2))))
              }
            >
              ½
            </button>
            <button
              type="button"
              className="chr__mod"
              disabled={isPlaying}
              aria-label="Double bet amount"
              onClick={() => setBet((b) => Math.min(maxBet, Number((b * 2).toFixed(2))))}
            >
              2x
            </button>
            <button
              type="button"
              className="chr__mod"
              disabled={isPlaying}
              aria-label="Bet maximum"
              onClick={() => setBet(maxBet)}
            >
              Max
            </button>
          </div>
        </div>

        <button
          type="button"
          className="chr__up"
          onClick={advance}
          disabled={!isPlaying}
        >
          ↑ Cross a lane
        </button>

        {!isPlaying && betError && <p className="chr__error">{betError}</p>}

        {phase === 'LOST' && (
          <div className="chr__banner chr__banner--lost" role="status">
            Hit by a car — lost {money(bet)}
          </div>
        )}
        {phase === 'WON' && (
          <div className="chr__banner chr__banner--won" role="status">
            Cashed out {money(lastWin ?? 0)}
          </div>
        )}

        {isPlaying ? (
          <button
            type="button"
            className="chr__action chr__action--cash"
            onClick={cashOut}
            disabled={lane === 0}
          >
            Cash Out ({money(payout)})
          </button>
        ) : (
          <button
            type="button"
            className="chr__action"
            onClick={startRound}
            disabled={betError !== null}
          >
            {isOver ? 'Play Again' : 'Start Round'}
          </button>
        )}

        <p className="chr__hint">
          {isPlaying
            ? 'Arrow Up / W, the button, or tap the board'
            : 'Cross a lane to unlock cash out'}
        </p>
      </div>
    </div>
  );
}
