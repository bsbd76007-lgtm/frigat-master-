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

const COLORS = {
  bg: '#0d1319',
  rim: '#2a3441',
  rimEdge: '#3a475a',
  red: '#c8384a',
  black: '#1c242e',
  green: '#1f9d63',
  separator: '#0d1319',
  text: '#e6edf3',
  muted: '#6b7787',
  ball: '#f2f5f8',
  marker: '#d9a441',
};

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
export const SEGMENT = (Math.PI * 2) / WHEEL_ORDER.length;
export const MARKER_ANGLE = -Math.PI / 2;
const IDLE_RATE = 0.00022;
const BALL_ORBITS = 6;
const WHEEL_SPINS = 4;

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
        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, width, height);

        const cx = width / 2;
        const cy = height / 2;
        const outer = Math.min(width, height) / 2 - 6;
        if (outer <= 12) return;

        const rimOuter = outer;
        const rimInner = outer * 0.86;
        const pocketOuter = rimInner;
        const pocketInner = outer * 0.56;
        const hub = outer * 0.36;
        const trackRadius = outer * 0.93;
        const restRadius = (pocketOuter + pocketInner) / 2;

        const now = performance.now();
        const delta = lastTimeRef.current === null ? 0 : now - lastTimeRef.current;
        lastTimeRef.current = now;

        const landing = landingRef.current;
        let wheelAngle: number;
        let progress = 1;

        if (landing) {
          progress = Math.min(1, (now - landing.startedAt) / duration);
          const eased = easeOutQuart(progress);
          wheelAngle =
            landing.wheelFrom + (landing.wheelTo - landing.wheelFrom) * eased;
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

        ctx.beginPath();
        ctx.arc(cx, cy, rimOuter, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.rim;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = COLORS.rimEdge;
        ctx.stroke();

        const winning = landing && progress >= 1 ? landing.pocket : null;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(wheelAngle);

        WHEEL_ORDER.forEach((value, index) => {
          const start = index * SEGMENT;
          const end = start + SEGMENT;
          const color = pocketColor(value);

          ctx.beginPath();
          ctx.arc(0, 0, pocketOuter, start, end);
          ctx.arc(0, 0, pocketInner, end, start, true);
          ctx.closePath();
          ctx.fillStyle =
            color === 'GREEN'
              ? COLORS.green
              : color === 'RED'
                ? COLORS.red
                : COLORS.black;
          ctx.fill();
          ctx.lineWidth = 0.8;
          ctx.strokeStyle = COLORS.separator;
          ctx.stroke();

          if (winning === value) {
            const pulse = 0.55 + Math.sin(time / 160) * 0.35;
            ctx.save();
            ctx.beginPath();
            ctx.arc(0, 0, pocketOuter, start, end);
            ctx.arc(0, 0, pocketInner, end, start, true);
            ctx.closePath();
            ctx.fillStyle = `rgba(217, 164, 65,${0.3 * pulse})`;
            ctx.fill();
            ctx.lineWidth = 2.2;
            ctx.strokeStyle = COLORS.marker;
            ctx.shadowColor = COLORS.marker;
            ctx.shadowBlur = 16;
            ctx.stroke();
            ctx.restore();
          }

          const mid = start + SEGMENT / 2;
          ctx.save();
          ctx.rotate(mid);
          ctx.translate((pocketOuter + pocketInner) / 2, 0);
          ctx.rotate(Math.PI / 2);
          ctx.fillStyle = COLORS.text;
          ctx.font = `700 ${Math.max(7, outer * 0.062)}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(value), 0, 0);
          ctx.restore();
        });

        ctx.restore();

        const hubFill = ctx.createRadialGradient(cx, cy, hub * 0.2, cx, cy, hub);
        hubFill.addColorStop(0, '#2a3441');
        hubFill.addColorStop(1, '#131a22');
        ctx.beginPath();
        ctx.arc(cx, cy, hub, 0, Math.PI * 2);
        ctx.fillStyle = hubFill;
        ctx.fill();
        ctx.strokeStyle = COLORS.rimEdge;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        if (landing) {
          const eased = easeOutQuart(progress);
          const ballAngle =
            landing.ballFrom + (landing.ballTo - landing.ballFrom) * eased;
          const fall = smoothstep((progress - 0.45) / 0.55);
          const radius = trackRadius + (restRadius - trackRadius) * fall;
          const hop =
            progress > 0.45 && progress < 0.98 && !reducedMotion
              ? Math.abs(Math.sin(progress * 26)) * (1 - fall) * outer * 0.03
              : 0;

          const bx = cx + Math.cos(ballAngle) * (radius + hop);
          const by = cy + Math.sin(ballAngle) * (radius + hop);
          const ballR = Math.max(3, outer * 0.035);

          ctx.beginPath();
          ctx.arc(bx, by, ballR, 0, Math.PI * 2);
          ctx.fillStyle = COLORS.ball;
          ctx.shadowColor = 'rgba(0,0,0,.55)';
          ctx.shadowBlur = 8;
          ctx.fill();
          ctx.shadowBlur = 0;
        }

        ctx.beginPath();
        ctx.moveTo(cx, cy - rimOuter - 1);
        ctx.lineTo(cx - 7, cy - rimOuter - 13);
        ctx.lineTo(cx + 7, cy - rimOuter - 13);
        ctx.closePath();
        ctx.fillStyle = COLORS.marker;
        ctx.fill();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (winning !== null) {
          const color = pocketColor(winning);
          ctx.fillStyle =
            color === 'GREEN'
              ? COLORS.green
              : color === 'RED'
                ? COLORS.red
                : COLORS.text;
          ctx.font = `700 ${outer * 0.3}px ${FONT}`;
          ctx.fillText(String(winning), cx, cy - outer * 0.02);
          ctx.fillStyle = COLORS.muted;
          ctx.font = `600 ${Math.max(9, outer * 0.055)}px ${FONT}`;
          ctx.fillText(color, cx, cy + outer * 0.18);
        } else {
          ctx.fillStyle = COLORS.muted;
          ctx.font = `600 ${Math.max(9, outer * 0.06)}px ${FONT}`;
          ctx.fillText(
            phase === 'SPINNING' ? 'SPINNING' : 'PLACE BETS',
            cx,
            cy
          );
        }
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
        maxWidth: size,
        aspectRatio: '1 / 1',
        margin: '0 auto',
      }}
      role="img"
      aria-label={label}
    />
  );
}

export default RouletteCanvas;
