'use client';

import { useEffect, useMemo, useRef } from 'react';

import { CRASH } from '@frigat/shared/constants';

import {
  useCanvasRenderer,
  usePrefersReducedMotion,
  type CanvasFrame,
} from '@/lib/useCanvasRenderer';
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

const COLORS = {
  bg: '#0d1319',
  grid: '#1b2531',
  axis: '#243040',
  muted: '#6b7787',
  text: '#e6edf3',
  live: '#00e701',
  bust: '#f0616d',
  cashed: '#f5b83d',
};

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const EXPLOSION_MS = 1100;

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
        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, width, h);

        const padLeft = 44;
        const padRight = 16;
        const padTop = 18;
        const padBottom = 28;
        const plotW = Math.max(1, width - padLeft - padRight);
        const plotH = Math.max(1, h - padTop - padBottom);

        const live = Math.max(1, displayMultiplier || 1);
        const elapsed = elapsedSecondsFor(live);

        const spanSeconds = Math.max(6, elapsed * 1.12);
        const spanMultiplier = Math.max(2, live * 1.18);

        const toX = (seconds: number) => padLeft + (seconds / spanSeconds) * plotW;
        const toY = (m: number) =>
          padTop + plotH - ((m - 1) / (spanMultiplier - 1)) * plotH;

        ctx.lineWidth = 1;
        ctx.font = `11px ${FONT}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const steps = 4;
        for (let i = 0; i <= steps; i += 1) {
          const m = 1 + ((spanMultiplier - 1) * i) / steps;
          const y = Math.round(toY(m)) + 0.5;
          ctx.strokeStyle = i === 0 ? COLORS.axis : COLORS.grid;
          ctx.beginPath();
          ctx.moveTo(padLeft, y);
          ctx.lineTo(width - padRight, y);
          ctx.stroke();
          ctx.fillStyle = COLORS.muted;
          ctx.fillText(`${m.toFixed(2)}×`, padLeft - 8, y);
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const timeSteps = 4;
        for (let i = 1; i <= timeSteps; i += 1) {
          const seconds = (spanSeconds * i) / timeSteps;
          const x = Math.round(toX(seconds)) + 0.5;
          ctx.strokeStyle = COLORS.grid;
          ctx.beginPath();
          ctx.moveTo(x, padTop);
          ctx.lineTo(x, padTop + plotH);
          ctx.stroke();
          ctx.fillStyle = COLORS.muted;
          ctx.fillText(`${seconds.toFixed(0)}s`, x, padTop + plotH + 7);
        }

        const busted = phase === 'CRASHED';
        const cashed = phase === 'CASHED_OUT';
        // The round is over in both end states; only a bust keeps climbing to
        // the crash point and detonates.
        const ended = busted || cashed;
        const curveColor = busted
          ? COLORS.bust
          : cashed
            ? COLORS.cashed
            : COLORS.live;
        const showCurve = phase === 'RUNNING' || ended;

        if (showCurve) {
          const samples = 120;
          const points: Array<[number, number]> = [];
          for (let i = 0; i <= samples; i += 1) {
            const seconds = (elapsed * i) / samples;
            points.push([toX(seconds), toY(multiplierAtSeconds(seconds))]);
          }

          const fill = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
          fill.addColorStop(
            0,
            busted
              ? 'rgba(240,97,109,.28)'
              : cashed
                ? 'rgba(245,184,61,.26)'
                : 'rgba(45,212,167,.26)'
          );
          fill.addColorStop(1, 'rgba(13,19,25,0)');
          ctx.beginPath();
          ctx.moveTo(points[0][0], padTop + plotH);
          for (const [x, y] of points) ctx.lineTo(x, y);
          ctx.lineTo(points[points.length - 1][0], padTop + plotH);
          ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();

          ctx.beginPath();
          for (let i = 0; i < points.length; i += 1) {
            const [x, y] = points[i];
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = curveColor;
          ctx.lineWidth = 2.5;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.shadowColor = curveColor;
          ctx.shadowBlur = 12;
          ctx.stroke();
          ctx.shadowBlur = 0;

          const headX = points[points.length - 1][0];
          const headY = points[points.length - 1][1];

          if (cashedOutAt && cashedOutAt > 1) {
            const y = toY(cashedOutAt);
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = COLORS.cashed;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(padLeft, y);
            ctx.lineTo(width - padRight, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = COLORS.cashed;
            ctx.font = `600 11px ${FONT}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText(`cashed ${cashedOutAt.toFixed(2)}×`, padLeft + 6, y - 3);
          }

          if (!ended) {
            const prev = points[Math.max(0, points.length - 6)];
            const angle = Math.atan2(headY - prev[1], headX - prev[0]);

            ctx.save();
            ctx.translate(headX, headY);
            ctx.rotate(angle);

            const pulse = reducedMotion ? 1 : 0.75 + Math.sin(time / 70) * 0.25;
            const plume = ctx.createLinearGradient(-26 * pulse, 0, 0, 0);
            plume.addColorStop(0, 'rgba(245,184,61,0)');
            plume.addColorStop(1, 'rgba(245,184,61,.85)');
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
            ctx.fillStyle = COLORS.text;
            ctx.shadowColor = COLORS.live;
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.restore();
          } else if (cashed) {
            // A held marker where the player got out — no explosion.
            ctx.beginPath();
            ctx.arc(headX, headY, 6, 0, Math.PI * 2);
            ctx.fillStyle = COLORS.cashed;
            ctx.shadowColor = COLORS.cashed;
            ctx.shadowBlur = 12;
            ctx.fill();
            ctx.shadowBlur = 0;
          } else {
            const since = crashedAtRef.current
              ? performance.now() - crashedAtRef.current
              : 0;
            const progress = Math.min(1, since / EXPLOSION_MS);

            if (progress < 0.18) {
              const flash = 1 - progress / 0.18;
              ctx.beginPath();
              ctx.arc(headX, headY, 10 + flash * 34, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(255,236,200,${0.75 * flash})`;
              ctx.fill();
            }

            if (progress < 1) {
              const ring = progress ** 0.55;
              ctx.beginPath();
              ctx.arc(headX, headY, 8 + ring * 78, 0, Math.PI * 2);
              ctx.strokeStyle = `rgba(240,97,109,${0.5 * (1 - progress)})`;
              ctx.lineWidth = 2.5 * (1 - progress) + 0.5;
              ctx.stroke();
            }

            for (const p of particlesRef.current) {
              const distance = p.speed * progress;
              const px = headX + Math.cos(p.angle) * distance;
              const py = headY + Math.sin(p.angle) * distance + progress ** 2 * 26;
              ctx.beginPath();
              ctx.arc(px, py, p.radius * (1 - progress * 0.7), 0, Math.PI * 2);
              ctx.fillStyle = `hsla(${p.hue}, 90%, ${62 - progress * 20}%, ${1 - progress})`;
              ctx.fill();
            }
          }
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const cx = padLeft + plotW / 2;
        const cy = padTop + plotH / 2;

        if (phase === 'BETTING') {
          ctx.fillStyle = COLORS.muted;
          ctx.font = `600 12px ${FONT}`;
          ctx.fillText('NEXT ROUND', cx, cy - 26);
          ctx.fillStyle = COLORS.text;
          ctx.font = `700 46px ${FONT}`;
          const seconds = Math.max(0, (bettingMsRemaining ?? 0) / 1000);
          ctx.fillText(`${seconds.toFixed(1)}s`, cx, cy + 6);
          ctx.fillStyle = COLORS.muted;
          ctx.font = `12px ${FONT}`;
          ctx.fillText('Place your bet', cx, cy + 38);
        } else if (phase === 'IDLE') {
          // Nothing is running and nothing will until this player bets.
          ctx.fillStyle = COLORS.muted;
          ctx.font = `600 14px ${FONT}`;
          ctx.fillText('Place a bet to start a round', cx, cy);
        } else {
          const shake =
            busted && !reducedMotion
              ? Math.max(
                  0,
                  1 -
                    (crashedAtRef.current
                      ? performance.now() - crashedAtRef.current
                      : 0) /
                      260
                ) *
                Math.sin(time / 18) *
                4
              : 0;

          ctx.save();
          ctx.translate(shake, 0);
          ctx.fillStyle = busted
            ? COLORS.bust
            : cashed
              ? COLORS.cashed
              : COLORS.text;
          ctx.font = `700 58px ${FONT}`;
          ctx.shadowColor = busted
            ? COLORS.bust
            : cashed
              ? COLORS.cashed
              : COLORS.live;
          ctx.shadowBlur = 18;
          ctx.fillText(`${live.toFixed(2)}×`, cx, cy);
          ctx.shadowBlur = 0;

          if (busted) {
            ctx.fillStyle = COLORS.bust;
            ctx.font = `700 14px ${FONT}`;
            ctx.fillText('CRASHED', cx, cy + 44);
          } else if (cashed) {
            ctx.fillStyle = COLORS.cashed;
            ctx.font = `700 14px ${FONT}`;
            ctx.fillText('CASHED OUT', cx, cy + 44);
          }
          ctx.restore();
        }
      },
    [
      phase,
      displayMultiplier,
      bettingMsRemaining,
      cashedOutAt,
      reducedMotion,
    ]
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

export default CrashCanvas;
