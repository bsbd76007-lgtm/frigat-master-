'use client';

import { useEffect, useMemo, useRef } from 'react';

import { CRASH } from '@frigat/shared/constants';

import {
  useCanvasRenderer,
  usePrefersReducedMotion,
  type CanvasFrame,
} from '@/lib/useCanvasRenderer';

import {
  ACCENT,
  BOARD,
  FONT,
  GOLD,
  NEG,
  alpha,
  drawBackdrop,
  drawVignette,
  makeScene,
  poly,
} from './three';

export const CRASH_GROWTH_RATE_PER_SEC = CRASH.growthRatePerSec;

/**
 * Crash is single-player: a round runs only while this player has a stake in
 * it. 'BETTING' is retained for the shared-round shape but is no longer
 * reached — there is no betting window to wait through. 'CASHED_OUT' is the
 * round ending because the player took the money, which must not draw the
 * bust explosion.
 */
export type CrashPhase =
  | 'IDLE'
  | 'BETTING'
  | 'RUNNING'
  | 'CRASHED'
  | 'CASHED_OUT';

export interface CrashCanvasProps {
  phase: CrashPhase;
  multiplier: number;
  crashPoint?: number | null;
  bettingMsRemaining?: number | null;
  cashedOutAt?: number | null;
  height?: number;
  className?: string;
}

interface Particle {
  angle: number;
  speed: number;
  radius: number;
  hue: number;
}

/**
 * Blue while the round is live — the state the player is still acting on —
 * gold once it pays, red when it busts. That is the token contract rather than
 * the old amber board: gold is reward, so it is not allowed to mean "rising".
 */
const LIVE = ACCENT;
const CASHED = GOLD;
const BUST = NEG;

const EXPLOSION_MS = 1100;
/** The depth the flight plane stands at, and the floor band around it. */
const FLIGHT_Y = 0.52;
const FLOOR_NEAR = 0.98;
const FLOOR_FAR = 0.06;

export function elapsedSecondsFor(multiplier: number): number {
  if (multiplier <= 1) return 0;
  return Math.log(multiplier) / CRASH_GROWTH_RATE_PER_SEC;
}

export function multiplierAtSeconds(seconds: number): number {
  return Math.exp(CRASH_GROWTH_RATE_PER_SEC * Math.max(0, seconds));
}

/**
 * Particles are generated once per bust and stored, never re-rolled per frame —
 * re-randomising each frame would make the explosion strobe.
 */
function makeParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = i * 2.39996 + (i % 3) * 0.35;
    return {
      angle,
      speed: 60 + ((i * 37) % 90),
      radius: 1.5 + ((i * 13) % 5) * 0.6,
      hue: 8 + ((i * 17) % 40),
    };
  });
}

export function CrashCanvas({
  phase,
  multiplier,
  crashPoint = null,
  bettingMsRemaining = null,
  cashedOutAt = null,
  height = 320,
  className,
}: CrashCanvasProps) {
  const reducedMotion = usePrefersReducedMotion();

  const particlesRef = useRef<Particle[]>([]);
  const crashedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (phase === 'CRASHED') {
      if (crashedAtRef.current === null) {
        crashedAtRef.current = performance.now();
        particlesRef.current = makeParticles(reducedMotion ? 0 : 28);
      }
    } else {
      crashedAtRef.current = null;
      particlesRef.current = [];
    }
  }, [phase, reducedMotion]);

  const displayMultiplier =
    phase === 'CRASHED' && crashPoint != null
      ? crashPoint
      : phase === 'CASHED_OUT' && cashedOutAt != null
        ? cashedOutAt
        : multiplier;

  const draw = useMemo(
    () =>
      ({ ctx, width, height: h, time }: CanvasFrame) => {
        const scene = makeScene(width, h, {
          top: 0.1,
          bottom: 0.99,
          focus: FLIGHT_Y,
          far: 2.4,
          depthStretch: 1.5,
        });

        const padLeft = 50;
        const padRight = 18;
        const plotW = Math.max(1, width - padLeft - padRight);
        /** How much of the stage the climb is allowed to use. */
        const zSpan = h * 0.58;

        const live = Math.max(1, displayMultiplier || 1);
        const elapsed = elapsedSecondsFor(live);
        const spanSeconds = Math.max(6, elapsed * 1.12);
        const spanMultiplier = Math.max(2, live * 1.18);

        const xOf = (seconds: number) => padLeft + (seconds / spanSeconds) * plotW;
        const zOf = (m: number) => ((m - 1) / (spanMultiplier - 1)) * zSpan;

        const busted = phase === 'CRASHED';
        const cashed = phase === 'CASHED_OUT';
        const ended = busted || cashed;
        const curveColour = busted ? BUST : cashed ? CASHED : LIVE;

        drawBackdrop(ctx, scene, {
          x0: padLeft - plotW * 0.08,
          x1: width - padRight,
          y0: FLOOR_FAR,
          y1: FLOOR_NEAR,
          glow: curveColour,
          glowStrength: phase === 'RUNNING' || ended ? 0.12 : 0.07,
          gridCols: 8,
          gridRows: 4,
        });

        // Multiplier rungs: horizontal lines standing in the flight plane, the
        // 3D stand-in for the old flat y-axis.
        ctx.font = `600 11px ${FONT.num}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const steps = 4;
        for (let i = 0; i <= steps; i += 1) {
          const m = 1 + ((spanMultiplier - 1) * i) / steps;
          const z = zOf(m);
          const a = scene.project(padLeft, FLIGHT_Y, z);
          const b = scene.project(width - padRight, FLIGHT_Y, z);
          ctx.strokeStyle = i === 0 ? BOARD.line2 : BOARD.line;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.fillStyle = BOARD.dim;
          ctx.fillText(`${m.toFixed(2)}×`, a.x - 8, a.y);
        }

        // Time ticks, lying on the floor where the flight plane meets it.
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.font = `600 10px ${FONT.num}`;
        for (let i = 1; i <= 4; i += 1) {
          const seconds = (spanSeconds * i) / 4;
          const at = scene.project(xOf(seconds), FLOOR_NEAR, 0);
          ctx.fillStyle = BOARD.dim;
          ctx.fillText(`${seconds.toFixed(0)}s`, at.x, at.y - 14);
        }

        const showCurve = phase === 'RUNNING' || ended;
        let head = { x: scene.vanishX, y: h / 2 };

        if (showCurve) {
          const samples = 120;
          const top: Array<{ x: number; y: number }> = [];
          const base: Array<{ x: number; y: number }> = [];
          for (let i = 0; i <= samples; i += 1) {
            const seconds = (elapsed * i) / samples;
            const x = xOf(seconds);
            top.push(scene.project(x, FLIGHT_Y, zOf(multiplierAtSeconds(seconds))));
            base.push(scene.project(x, FLIGHT_Y, 0));
          }
          head = top[top.length - 1];

          // The climb as a wall standing on the floor: the same area fill the
          // flat chart had, except it now has a footing you can see.
          const fill = ctx.createLinearGradient(0, scene.project(0, FLIGHT_Y, zSpan).y, 0, base[0].y);
          fill.addColorStop(0, alpha(curveColour, 0.34));
          fill.addColorStop(1, alpha(curveColour, 0.02));
          poly(ctx, [...top, ...base.slice().reverse()], fill);

          // The curve itself, along the top of the wall.
          ctx.beginPath();
          for (let i = 0; i < top.length; i += 1) {
            if (i === 0) ctx.moveTo(top[i].x, top[i].y);
            else ctx.lineTo(top[i].x, top[i].y);
          }
          ctx.strokeStyle = curveColour;
          ctx.lineWidth = 2.5;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.shadowColor = curveColour;
          ctx.shadowBlur = 12;
          ctx.stroke();
          ctx.shadowBlur = 0;

          if (cashedOutAt && cashedOutAt > 1) {
            const z = zOf(cashedOutAt);
            const a = scene.project(padLeft, FLIGHT_Y, z);
            const b = scene.project(width - padRight, FLIGHT_Y, z);
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = CASHED;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = CASHED;
            ctx.font = `600 11px ${FONT.num}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText(`cashed ${cashedOutAt.toFixed(2)}×`, a.x + 6, a.y - 3);
          }

          if (!ended) {
            drawRocket(ctx, top, reducedMotion ? 1 : 0.75 + Math.sin(time / 70) * 0.25);
          } else if (cashed) {
            // A held marker where the player got out — no explosion.
            ctx.beginPath();
            ctx.arc(head.x, head.y, 6, 0, Math.PI * 2);
            ctx.fillStyle = CASHED;
            ctx.shadowColor = CASHED;
            ctx.shadowBlur = 12;
            ctx.fill();
            ctx.shadowBlur = 0;
          } else {
            drawExplosion(ctx, head, crashedAtRef.current, particlesRef.current);
          }
        }

        // The readout is head-up display, not part of the board, so it stays in
        // screen space — a number sheared into the flight plane would be the one
        // thing on the stage the player cannot read at a glance.
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const cx = padLeft + plotW / 2;
        const cy = h * 0.42;

        if (phase === 'BETTING') {
          ctx.fillStyle = BOARD.muted;
          ctx.font = `600 12px ${FONT.body}`;
          ctx.fillText('NEXT ROUND', cx, cy - 26);
          ctx.fillStyle = BOARD.text;
          ctx.font = `700 46px ${FONT.num}`;
          const seconds = Math.max(0, (bettingMsRemaining ?? 0) / 1000);
          ctx.fillText(`${seconds.toFixed(1)}s`, cx, cy + 6);
          ctx.fillStyle = BOARD.muted;
          ctx.font = `600 12px ${FONT.body}`;
          ctx.fillText('Place your bet', cx, cy + 38);
        } else if (phase === 'IDLE') {
          // Nothing is running and nothing will until this player bets.
          ctx.fillStyle = BOARD.muted;
          ctx.font = `600 14px ${FONT.body}`;
          ctx.fillText('Place a bet to start a round', cx, cy);
        } else {
          const since = crashedAtRef.current ? performance.now() - crashedAtRef.current : 0;
          const shake =
            busted && !reducedMotion
              ? Math.max(0, 1 - since / 260) * Math.sin(time / 18) * 4
              : 0;

          ctx.save();
          ctx.translate(shake, 0);
          ctx.fillStyle = busted ? BUST : cashed ? CASHED : BOARD.text;
          // Tabular figures: the climb through 9.99 → 10.00 must not shift.
          ctx.font = `700 58px ${FONT.num}`;
          ctx.shadowColor = curveColour;
          ctx.shadowBlur = 18;
          ctx.fillText(`${live.toFixed(2)}×`, cx, cy);
          ctx.shadowBlur = 0;

          if (busted || cashed) {
            ctx.fillStyle = busted ? BUST : CASHED;
            ctx.font = `800 14px ${FONT.body}`;
            ctx.fillText(busted ? 'CRASHED' : 'CASHED OUT', cx, cy + 44);
          }
          ctx.restore();
        }

        drawVignette(ctx, scene);
      },
    [phase, displayMultiplier, bettingMsRemaining, cashedOutAt, reducedMotion]
  );

  const canvasRef = useCanvasRenderer(draw);

  const label =
    phase === 'CRASHED'
      ? `Crash round busted at ${(crashPoint ?? multiplier).toFixed(2)}x`
      : phase === 'CASHED_OUT'
        ? `Cashed out at ${(cashedOutAt ?? multiplier).toFixed(2)}x`
        : phase === 'RUNNING'
          ? `Crash multiplier ${multiplier.toFixed(2)}x and rising`
          : phase === 'BETTING'
            ? 'Crash betting window open'
            : 'Place a bet to start a crash round';

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', width: '100%', height, borderRadius: 12 }}
      role="img"
      aria-label={label}
    />
  );
}

/**
 * The craft at the head of the curve, banked along it. Drawn in screen space:
 * it is a few pixels across, so projecting a hull would cost a lot of maths to
 * land inside the same pixels this does.
 */
function drawRocket(
  ctx: CanvasRenderingContext2D,
  top: ReadonlyArray<{ x: number; y: number }>,
  pulse: number
): void {
  const head = top[top.length - 1];
  const prev = top[Math.max(0, top.length - 6)];
  const angle = Math.atan2(head.y - prev.y, head.x - prev.x);

  ctx.save();
  ctx.translate(head.x, head.y);
  ctx.rotate(angle);

  const plume = ctx.createLinearGradient(-26 * pulse, 0, 0, 0);
  plume.addColorStop(0, alpha(LIVE, 0));
  plume.addColorStop(1, alpha(LIVE, 0.85));
  ctx.beginPath();
  ctx.moveTo(-26 * pulse, 0);
  ctx.lineTo(-8, -4.5);
  ctx.lineTo(-8, 4.5);
  ctx.closePath();
  ctx.fillStyle = plume;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(11, 0);
  ctx.lineTo(-8, -6.5);
  ctx.lineTo(-4, 0);
  ctx.lineTo(-8, 6.5);
  ctx.closePath();
  ctx.fillStyle = BOARD.text;
  ctx.shadowColor = LIVE;
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawExplosion(
  ctx: CanvasRenderingContext2D,
  head: { x: number; y: number },
  crashedAt: number | null,
  particles: readonly Particle[]
): void {
  const since = crashedAt ? performance.now() - crashedAt : 0;
  const progress = Math.min(1, since / EXPLOSION_MS);

  if (progress < 0.18) {
    const flash = 1 - progress / 0.18;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 10 + flash * 34, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,236,200,${0.75 * flash})`;
    ctx.fill();
  }

  if (progress < 1) {
    const ring = progress ** 0.55;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 8 + ring * 78, 0, Math.PI * 2);
    ctx.strokeStyle = alpha(BUST, 0.5 * (1 - progress));
    ctx.lineWidth = 2.5 * (1 - progress) + 0.5;
    ctx.stroke();
  }

  for (const p of particles) {
    const distance = p.speed * progress;
    const px = head.x + Math.cos(p.angle) * distance;
    const py = head.y + Math.sin(p.angle) * distance + progress ** 2 * 26;
    ctx.beginPath();
    ctx.arc(px, py, p.radius * (1 - progress * 0.7), 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${p.hue}, 90%, ${62 - progress * 20}%, ${1 - progress})`;
    ctx.fill();
  }
}

export default CrashCanvas;
