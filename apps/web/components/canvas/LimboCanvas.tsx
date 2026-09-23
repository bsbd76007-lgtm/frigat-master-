'use client';

import { useEffect, useMemo, useRef } from 'react';

import {
  useCanvasRenderer,
  usePrefersReducedMotion,
  type CanvasFrame,
} from '@/lib/useCanvasRenderer';

import { ACCENT_DEEP, BOARD, FONT, GOLD, NEG, POS, alpha, shade } from './three';

export interface LimboRound {
  /** Changes per round; a new id is what starts the count-up. */
  id: string;
  achievedMultiplier: number;
  win: boolean;
}

export interface LimboCanvasProps {
  target: number;
  /** Null between rounds. Set once the server has settled the round. */
  round: LimboRound | null;
  /** Called when the count-up finishes — the page settles the round there. */
  onRollComplete?: () => void;
  height?: number;
  className?: string;
}

const ROLLOUT_MS = 850;

/**
 * Flat: a big count-up and a bar racing a target line.
 *
 * The count-up is the whole game, so it gets the whole board. The bar is on a
 * log scale because that is the only scale on which 2x and 200x can share a
 * track, and it is pinned to the target — reaching the line is the win
 * condition, drawn literally.
 */
export function LimboCanvas({
  target,
  round,
  onRollComplete,
  height = 260,
  className,
}: LimboCanvasProps) {
  const reducedMotion = usePrefersReducedMotion();

  const runRef = useRef<{ id: string; startedAt: number; done: boolean } | null>(null);
  const onCompleteRef = useRef(onRollComplete);
  onCompleteRef.current = onRollComplete;

  useEffect(() => {
    if (!round) {
      runRef.current = null;
      return;
    }
    if (runRef.current?.id === round.id) return;
    runRef.current = { id: round.id, startedAt: performance.now(), done: false };
  }, [round]);

  const draw = useMemo(
    () =>
      ({ ctx, width, height: h }: CanvasFrame) => {
        ctx.clearRect(0, 0, width, h);

        const achieved = round?.achievedMultiplier ?? 1;
        const run = runRef.current;

        let value = 1;
        if (run) {
          const t = reducedMotion ? 1 : Math.min(1, (performance.now() - run.startedAt) / ROLLOUT_MS);
          // Cubic ease-out in log space: the climb through the small multipliers
          // is quick and the last stretch is where the tension is.
          const eased = 1 - Math.pow(1 - t, 3);
          value = Math.exp(Math.log(Math.max(achieved, 1.0001)) * eased);
          if (t >= 1 && !run.done) {
            run.done = true;
            onCompleteRef.current?.();
          }
        }

        const settled = run?.done === true;
        const win = settled ? round?.win === true : null;
        const tint = win === null ? BOARD.text : win ? POS : NEG;

        // The readout.
        const readoutY = h * 0.4;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = tint;
        const size = Math.min(72, width * 0.17);
        ctx.font = `700 ${size}px ${FONT.num}`;
        ctx.fillText(`${formatMultiplier(value)}x`, width / 2, readoutY);

        if (settled) {
          ctx.fillStyle = win ? POS : NEG;
          ctx.font = `800 13px ${FONT.body}`;
          ctx.fillText(win ? 'TARGET CLEARED' : 'BELOW TARGET', width / 2, readoutY + size * 0.72);
        }

        // The bar: how far the roll got toward the target, on a log scale.
        const pad = Math.min(width * 0.1, 52);
        const left = pad;
        const span = width - pad * 2;
        const barY = h * 0.78;
        const barH = 12;
        const logTarget = Math.log(Math.max(target, 1.0001));
        const progress = Math.min(1.12, Math.log(Math.max(value, 1)) / logTarget);

        roundedRect(ctx, left, barY, span, barH, barH / 2);
        ctx.fillStyle = shade(BOARD.neutral, -0.3);
        ctx.fill();

        if (progress > 0) {
          ctx.save();
          roundedRect(ctx, left, barY, span, barH, barH / 2);
          ctx.clip();
          ctx.fillStyle = win === false ? NEG : win === true ? POS : ACCENT_DEEP;
          ctx.fillRect(left, barY, span * Math.min(1, progress), barH);
          ctx.restore();
        }

        // The target line sits at the bar's own 100% mark: the fill either
        // reaches it or stalls short, which is the result in one glance.
        const targetX = left + span;
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(Math.round(targetX) + 0.5, barY - 7);
        ctx.lineTo(Math.round(targetX) + 0.5, barY + barH + 7);
        ctx.stroke();

        ctx.font = `600 11px ${FONT.num}`;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillStyle = BOARD.dim;
        ctx.fillText('1.00x', left, barY + barH + 10);
        ctx.textAlign = 'right';
        ctx.fillStyle = alpha(GOLD, 0.9);
        ctx.fillText(`${formatMultiplier(target)}x`, targetX, barY + barH + 10);

      },
    [target, round, reducedMotion]
  );

  const canvasRef = useCanvasRenderer(draw);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', width: '100%', height }}
      role="img"
      aria-label={
        round
          ? `Limbo. Rolled ${formatMultiplier(round.achievedMultiplier)}x against a target of ${formatMultiplier(target)}x`
          : `Limbo. Target ${formatMultiplier(target)}x`
      }
    />
  );
}

function formatMultiplier(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toFixed(2);
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export default LimboCanvas;
