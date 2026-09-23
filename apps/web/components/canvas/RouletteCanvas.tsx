'use client';

import { useEffect, useMemo, useRef } from 'react';

import {
  ROULETTE_WHEEL_ORDER,
  pocketColor,
  type RoulettePocketColor,
} from '@frigat/shared/constants';

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
  GOLD_SOFT,
  NEG,
  POS,
  alpha,
  drawBackdrop,
  drawVignette,
  makeScene,
  poly,
  shade,
  type ScreenPoint,
} from './three';

export const WHEEL_ORDER = ROULETTE_WHEEL_ORDER;
export { pocketColor };
export type { RoulettePocketColor };

export type RoulettePhase = 'IDLE' | 'SPINNING' | 'RESULT';

export interface RouletteCanvasProps {
  phase: RoulettePhase;
  pocket: number | null;
  spinDurationMs?: number;
  onSpinComplete?: (pocket: number) => void;
  size?: number;
  className?: string;
}

/**
 * The wheel's own colours. Red and black are the game's, not the interface's —
 * a roulette wheel that took the accent for its red would stop being a roulette
 * wheel — but the win trim is the shared gold and the cloth is the board floor,
 * so the bowl sits on the same table as every other game.
 */
const WHEEL = {
  red: '#c8384a',
  black: '#191920',
  green: POS,
  frame: '#2c2c33',
  frameLit: '#3d3d47',
  ball: '#f4f4f7',
  separator: '#09090b',
} as const;

export const SEGMENT = (Math.PI * 2) / WHEEL_ORDER.length;
export const MARKER_ANGLE = -Math.PI / 2;
const IDLE_RATE = 0.00022;
const BALL_ORBITS = 6;
const WHEEL_SPINS = 4;
/** Steps a pocket's arc is chopped into; a wedge is too wide to draw straight. */
const ARC_STEPS = 4;

export function wheelAngleForPocket(
  pocket: number,
  fromAngle = 0,
  extraSpins = WHEEL_SPINS
): number {
  const seat = WHEEL_ORDER.indexOf(pocket);
  if (seat < 0) throw new Error(`roulette: pocket ${pocket} is not on the wheel`);

  let target = MARKER_ANGLE - (seat * SEGMENT + SEGMENT / 2);
  while (target < fromAngle) target += Math.PI * 2;
  return target + Math.PI * 2 * extraSpins;
}

const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;
const smoothstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

interface Landing {
  pocket: number;
  startedAt: number;
  wheelFrom: number;
  wheelTo: number;
  ballFrom: number;
  ballTo: number;
  notified: boolean;
}

export function RouletteCanvas({
  phase,
  pocket,
  spinDurationMs = 4200,
  onSpinComplete,
  size = 340,
  className,
}: RouletteCanvasProps) {
  const reducedMotion = usePrefersReducedMotion();

  const idleAngleRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  const landingRef = useRef<Landing | null>(null);
  const onCompleteRef = useRef(onSpinComplete);
  onCompleteRef.current = onSpinComplete;

  const duration = reducedMotion ? 1 : Math.max(1, spinDurationMs);

  useEffect(() => {
    if (pocket === null || phase === 'IDLE') {
      landingRef.current = null;
      return;
    }
    if (landingRef.current?.pocket === pocket) return;

    if (!WHEEL_ORDER.includes(pocket)) return;

    const wheelFrom = idleAngleRef.current;
    const wheelTo = wheelAngleForPocket(pocket, wheelFrom);

    const ballFrom = MARKER_ANGLE + Math.PI;
    const ballTo = MARKER_ANGLE - Math.PI * 2 * BALL_ORBITS;

    landingRef.current = {
      pocket,
      startedAt: performance.now(),
      wheelFrom,
      wheelTo,
      ballFrom,
      ballTo,
      notified: false,
    };
  }, [pocket, phase]);

  const draw = useMemo(
    () =>
      ({ ctx, width, height, time }: CanvasFrame) => {
        // depthStretch is what sets the tilt: the wheel's diameter has to take
        // up well under the scene's full depth range, or the far rim climbs off
        // the top of the stage and the bowl reads as a tube.
        const scene = makeScene(width, height, {
          top: 0.2,
          bottom: 0.99,
          focus: 0.55,
          far: 3,
          depthStretch: 1.5,
        });

        const outer = Math.min(width * 0.46, height * 0.86);
        if (outer <= 12) return;

        const cx = width / 2;
        const cy = 0.55;

        /** Wheel space: radius and angle about the spindle, plus a height. */
        const P = (r: number, theta: number, z = 0): ScreenPoint =>
          scene.project(cx + r * Math.cos(theta), cy + (r * Math.sin(theta)) / scene.depthPx, z);

        const rimOuter = outer;
        const rimInner = outer * 0.86;
        const pocketOuter = rimInner;
        const pocketInner = outer * 0.56;
        const hub = outer * 0.36;
        const trackRadius = outer * 0.93;
        const restRadius = (pocketOuter + pocketInner) / 2;
        const wallH = outer * 0.13;
        const pocketZ = outer * 0.02;

        const now = performance.now();
        const delta = lastTimeRef.current === null ? 0 : now - lastTimeRef.current;
        lastTimeRef.current = now;

        const landing = landingRef.current;
        let wheelAngle: number;
        let progress = 1;

        if (landing) {
          progress = Math.min(1, (now - landing.startedAt) / duration);
          const eased = easeOutQuart(progress);
          wheelAngle = landing.wheelFrom + (landing.wheelTo - landing.wheelFrom) * eased;
          idleAngleRef.current = wheelAngle;

          if (progress >= 1 && !landing.notified) {
            landing.notified = true;
            onCompleteRef.current?.(landing.pocket);
          }
        } else {
          const spinning = phase === 'SPINNING' && !reducedMotion;
          idleAngleRef.current += delta * (spinning ? IDLE_RATE * 8 : IDLE_RATE);
          wheelAngle = idleAngleRef.current;
        }

        const winning = landing && progress >= 1 ? landing.pocket : null;
        drawBackdrop(ctx, scene, {
          y0: 0.02,
          y1: 0.99,
          glow: winning !== null ? GOLD : ACCENT,
          glowStrength: winning !== null ? 0.13 : 0.08,
        });

        // The bowl: its outer lip, then the well the pockets sit in.
        ringFill(ctx, P, rimOuter, wallH, shade(WHEEL.frame, -0.35));
        ringFill(ctx, P, rimInner, pocketZ, shade(WHEEL.frame, -0.6));

        // Back wall first, so the pockets paint over it.
        wallStrip(ctx, P, rimOuter, wallH, 'far', shade(WHEEL.frame, -0.15));

        // Pockets, far ones first: the near rim has to overlap them, and within
        // the ring a nearer separator should cover the one behind it.
        const seats = WHEEL_ORDER.map((value, index) => {
          const start = wheelAngle + index * SEGMENT;
          const mid = start + SEGMENT / 2;
          return { value, index, start, mid, depth: Math.sin(mid) };
        }).sort((a, b) => a.depth - b.depth);

        const numberSize = Math.max(7, outer * 0.062);
        for (const seat of seats) {
          const colour = pocketColor(seat.value);
          const base =
            colour === 'GREEN' ? WHEEL.green : colour === 'RED' ? WHEEL.red : WHEEL.black;
          // The far half of the wheel is turned away from the light.
          const lit = shade(base, 0.1 - Math.max(0, -seat.depth) * 0.22);

          const wedge = wedgePath(P, pocketInner, pocketOuter, seat.start, SEGMENT, pocketZ);
          poly(ctx, wedge, lit);
          ctx.beginPath();
          ctx.moveTo(wedge[0].x, wedge[0].y);
          for (let i = 1; i < wedge.length; i += 1) ctx.lineTo(wedge[i].x, wedge[i].y);
          ctx.closePath();
          ctx.strokeStyle = WHEEL.separator;
          ctx.lineWidth = 0.8;
          ctx.stroke();

          if (winning === seat.value) {
            const pulse = reducedMotion ? 0.7 : 0.55 + Math.sin(time / 160) * 0.35;
            poly(ctx, wedge, alpha(GOLD, 0.3 * pulse));
            ctx.strokeStyle = GOLD;
            ctx.lineWidth = 2.2;
            ctx.shadowColor = GOLD;
            ctx.shadowBlur = 16;
            ctx.stroke();
            ctx.shadowBlur = 0;
          }

          drawPocketNumber(ctx, P, seat.mid, pocketInner, pocketOuter, pocketZ, String(seat.value), {
            size: numberSize,
            fill: winning === seat.value ? '#3a2a08' : BOARD.text,
          });
        }

        // The cone over the spindle, standing proud of the pocket ring.
        const hubTop = P(0, 0, pocketZ + outer * 0.16);
        const hubRing = arc(P, hub, 0, Math.PI * 2, 48, pocketZ);
        poly(ctx, hubRing, shade(WHEEL.frame, -0.3));
        for (let i = 0; i < hubRing.length; i += 1) {
          const a = hubRing[i];
          const b = hubRing[(i + 1) % hubRing.length];
          const theta = (i / hubRing.length) * Math.PI * 2;
          // Lit on the left, like every other solid on the table.
          poly(ctx, [a, b, hubTop], shade(WHEEL.frameLit, -0.2 + Math.cos(theta) * -0.22));
        }

        if (landing) {
          const eased = easeOutQuart(progress);
          const ballAngle = landing.ballFrom + (landing.ballTo - landing.ballFrom) * eased;
          const fall = smoothstep((progress - 0.45) / 0.55);
          const radius = trackRadius + (restRadius - trackRadius) * fall;
          const hop =
            progress > 0.45 && progress < 0.98 && !reducedMotion
              ? Math.abs(Math.sin(progress * 26)) * (1 - fall) * outer * 0.05
              : 0;
          // The ball runs the rim high and drops into the well as it slows.
          const ballZ = pocketZ + wallH * (1 - fall) * 0.85 + hop;
          const ballR = Math.max(3, outer * 0.035);

          const at = P(radius, ballAngle, ballZ);
          const s = scene.scale(cy + (radius * Math.sin(ballAngle)) / scene.depthPx);
          const rr = Math.max(2, ballR * s);

          const shadowAt = P(radius, ballAngle, pocketZ);
          ctx.beginPath();
          ctx.ellipse(shadowAt.x, shadowAt.y, rr * 1.1, rr * 0.45, 0, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(5,5,6,.45)';
          ctx.fill();

          const shine = ctx.createRadialGradient(
            at.x - rr * 0.35,
            at.y - rr * 0.4,
            rr * 0.1,
            at.x,
            at.y,
            rr
          );
          shine.addColorStop(0, '#ffffff');
          shine.addColorStop(0.6, WHEEL.ball);
          shine.addColorStop(1, '#9a9aa6');
          ctx.beginPath();
          ctx.arc(at.x, at.y, rr, 0, Math.PI * 2);
          ctx.fillStyle = shine;
          ctx.fill();
        }

        // Near wall last: in a bowl seen at an angle it stands in front of the
        // pockets nearest the camera.
        wallStrip(ctx, P, rimOuter, wallH, 'near', WHEEL.frameLit);

        // The marker, a post at the far lip where the winning pocket comes to.
        const markerBase = P(rimOuter, MARKER_ANGLE, wallH);
        const markerTip = P(rimOuter, MARKER_ANGLE, wallH + outer * 0.1);
        poly(
          ctx,
          [
            { x: markerBase.x - outer * 0.035, y: markerBase.y },
            { x: markerBase.x + outer * 0.035, y: markerBase.y },
            markerTip,
          ],
          GOLD
        );

        // A compact status line above the bowl. The page already prints the full
        // result under the canvas, so repeating it large here would only crowd
        // the far rim — the wheel's own gold pocket and marker say which one won.
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const readoutY = height * 0.08;
        if (winning !== null) {
          const colour = pocketColor(winning);
          const text = `${winning} ${colour}`;
          ctx.font = `800 ${Math.max(11, Math.min(16, outer * 0.1))}px ${FONT.num}`;
          const pill = ctx.measureText(text).width + 22;
          // Capped against the stage as well as the wheel: at phone width the
          // header strip above the far lip is only a couple of dozen pixels.
          const pillH = Math.max(20, Math.min(outer * 0.13, height * 0.075));
          roundedPill(ctx, width / 2 - pill / 2, readoutY - pillH / 2, pill, pillH, alpha(GOLD, 0.16));
          ctx.strokeStyle = alpha(GOLD, 0.5);
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle =
            colour === 'GREEN' ? WHEEL.green : colour === 'RED' ? NEG : GOLD_SOFT;
          ctx.fillText(text, width / 2, readoutY + 0.5);
        } else {
          ctx.fillStyle = BOARD.muted;
          ctx.font = `700 ${Math.max(10, Math.min(13, outer * 0.07))}px ${FONT.body}`;
          ctx.fillText(phase === 'SPINNING' ? 'SPINNING' : 'PLACE BETS', width / 2, readoutY);
        }

        drawVignette(ctx, scene);
      },
    [phase, duration, reducedMotion]
  );

  const canvasRef = useCanvasRenderer(draw);

  const label =
    phase === 'RESULT' && pocket !== null
      ? `Roulette result: ${pocket} ${pocketColor(pocket).toLowerCase()}`
      : phase === 'SPINNING'
        ? 'Roulette wheel spinning'
        : 'European roulette wheel, awaiting bets';

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        display: 'block',
        width: '100%',
        // Wider than tall now: a wheel lying on the table is an ellipse, and a
        // square frame around one is mostly empty cloth.
        maxWidth: size * 1.3,
        aspectRatio: '4 / 3',
        margin: '0 auto',
      }}
      role="img"
      aria-label={label}
    />
  );
}

type Project = (r: number, theta: number, z?: number) => ScreenPoint;

/** The status pill behind the result. Left as a live path so it can be stroked. */
function roundedPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string
): void {
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Points along an arc in wheel space. */
function arc(
  P: Project,
  radius: number,
  from: number,
  sweep: number,
  steps: number,
  z: number
): ScreenPoint[] {
  const points: ScreenPoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    points.push(P(radius, from + (sweep * i) / steps, z));
  }
  return points;
}

/** A filled disc at one height — the bowl's lip and its well. */
function ringFill(
  ctx: CanvasRenderingContext2D,
  P: Project,
  radius: number,
  z: number,
  fill: string
): void {
  poly(ctx, arc(P, radius, 0, Math.PI * 2, 56, z), fill);
}

/** One pocket: an arc at each radius, joined into a wedge. */
function wedgePath(
  P: Project,
  inner: number,
  outer: number,
  from: number,
  sweep: number,
  z: number
): ScreenPoint[] {
  return [
    ...arc(P, outer, from, sweep, ARC_STEPS, z),
    ...arc(P, inner, from + sweep, -sweep, ARC_STEPS, z),
  ];
}

/**
 * The inside of the bowl wall, on one half of the rim. Drawn as two strips so
 * the far half can go behind the pockets and the near half in front of them —
 * the cheapest thing that reads as a bowl rather than a printed disc.
 */
function wallStrip(
  ctx: CanvasRenderingContext2D,
  P: Project,
  radius: number,
  wallH: number,
  half: 'near' | 'far',
  base: string
): void {
  const steps = 40;
  const from = half === 'near' ? 0 : Math.PI;
  const top = arc(P, radius, from, Math.PI, steps, wallH);
  const bottom = arc(P, radius, from + Math.PI, -Math.PI, steps, 0);
  const gradient = ctx.createLinearGradient(top[0].x, 0, top[top.length - 1].x, 0);
  gradient.addColorStop(0, shade(base, 0.12));
  gradient.addColorStop(0.5, base);
  gradient.addColorStop(1, shade(base, -0.3));
  poly(ctx, [...top, ...bottom], gradient);
}

/**
 * A pocket's number, sheared into the ring. The pocket's tangent and its radius
 * give the two screen axes to shear along, the same affine approximation the
 * shared kit uses for box faces.
 */
function drawPocketNumber(
  ctx: CanvasRenderingContext2D,
  P: Project,
  mid: number,
  inner: number,
  outer: number,
  z: number,
  text: string,
  options: { size: number; fill: string }
): void {
  const midRadius = (inner + outer) / 2;
  const span = SEGMENT * 0.42;
  const centre = P(midRadius, mid, z);
  const along = P(midRadius, mid + span, z);
  const outward = P(outer, mid, z);

  const ax = along.x - centre.x;
  const ay = along.y - centre.y;
  const bx = outward.x - centre.x;
  const by = outward.y - centre.y;
  const aLen = Math.hypot(ax, ay);
  const bLen = Math.hypot(bx, by);
  if (aLen < 0.4 || bLen < 0.4) return;

  ctx.save();
  ctx.transform(bx / bLen, by / bLen, ax / aLen, ay / aLen, centre.x, centre.y);
  ctx.fillStyle = options.fill;
  ctx.font = `700 ${options.size}px ${FONT.num}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export default RouletteCanvas;
