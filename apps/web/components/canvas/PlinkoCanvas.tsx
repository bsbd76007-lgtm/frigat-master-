'use client';

/**
 * FRIGAT — Plinko Visualizer
 *
 * Draws the triangular peg field, the bucket row, and an animated ball for each
 * drop. Level `i` carries `i + 1` pegs, so `rows` decisions produce `rows + 1`
 * buckets — the same Galton geometry the engine models.
 *
 * The ball follows the server's `path` (the `Array<'L' | 'R'>` in
 * plinko resultData) exactly, so the animation always terminates in the bucket
 * the ledger already paid out. No client-side physics decides where it lands;
 * the bounce is purely presentational easing between fixed waypoints.
 *
 * `multipliers` is required and must come from the server's PLINKO_TABLES.
 * Hard-coding a copy here would let the displayed payouts drift from the ones
 * actually settled — unacceptable for a gambling UI.
 */

import { useEffect, useMemo, useRef } from 'react';
import {
  useCanvasRenderer,
  usePrefersReducedMotion,
  type CanvasFrame,
} from '@/lib/useCanvasRenderer';

export interface PlinkoDrop {
  id: string;
  /** Server-derived left/right decisions, one per row. */
  path: Array<'L' | 'R'>;
  bucket?: number;
  multiplier?: number;
}

export interface PlinkoCanvasProps {
  rows: number;
  /** Bucket payout table from the server; length must be `rows + 1`. */
  multipliers: number[];
  drops: PlinkoDrop[];
  onDropComplete?: (drop: PlinkoDrop) => void;
  segmentMs?: number;
  height?: number;
  className?: string;
}

const COLORS = {
  bg: '#0d1319',
  peg: '#3a475a',
  pegLit: '#8b97a6',
  ball: '#f5b83d',
  text: '#e6edf3',
  muted: '#6b7787',
};

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const LANDED_FLASH_MS = 700;

/** Bucket colour by payout tier; mirrors GameHistoryBar's banding. */
function bucketColor(multiplier: number): string {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return '#f0616d';
  if (multiplier < 1) return '#f09261';
  if (multiplier < 2) return '#8b97a6';
  if (multiplier < 10) return '#ff6b00';
  return '#f5b83d';
}

/** Landing bucket = number of right-moves in the server path. */
export function bucketOf(drop: PlinkoDrop): number {
  if (typeof drop.bucket === 'number') return drop.bucket;
  return drop.path.reduce((count, step) => count + (step === 'R' ? 1 : 0), 0);
}

interface DropRuntime {
  startedAt: number;
  completed: boolean;
}

export function PlinkoCanvas({
  rows,
  multipliers,
  drops,
  onDropComplete,
  segmentMs = 110,
  height = 420,
  className,
}: PlinkoCanvasProps) {
  const reducedMotion = usePrefersReducedMotion();

  const runtimeRef = useRef(new Map<string, DropRuntime>());
  const landedRef = useRef(new Map<number, number>()); // bucket -> landed timestamp
  const onCompleteRef = useRef(onDropComplete);
  onCompleteRef.current = onDropComplete;

  useEffect(() => {
    const runtime = runtimeRef.current;
    const seen = new Set(drops.map((d) => d.id));
    for (const drop of drops) {
      if (!runtime.has(drop.id)) {
        runtime.set(drop.id, { startedAt: performance.now(), completed: false });
      }
    }
    for (const id of [...runtime.keys()]) {
      if (!seen.has(id)) runtime.delete(id);
    }
  }, [drops]);

  const perSegment = reducedMotion ? 0 : Math.max(1, segmentMs);

  const draw = useMemo(
    () =>
      ({ ctx, width, height: h, time }: CanvasFrame) => {
        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, width, h);

        const bucketCount = rows + 1;
        const padX = 14;
        const bucketH = 26;
        const topY = 26;
        const fieldH = Math.max(1, h - topY - bucketH - 18);
        const rowGap = fieldH / Math.max(1, rows);
        const spacing = Math.min(
          rowGap * 1.05,
          (width - padX * 2) / Math.max(1, bucketCount)
        );
        const cx = width / 2;
        const bucketY = topY + rows * rowGap + 10;

        const nodeX = (rightCount: number, level: number) =>
          cx + (rightCount - level / 2) * spacing;
        const nodeY = (level: number) => topY + level * rowGap;

        for (let level = 0; level < rows; level += 1) {
          for (let j = 0; j <= level; j += 1) {
            const x = nodeX(j, level);
            const y = nodeY(level);
            ctx.beginPath();
            ctx.arc(x, y, 2.6, 0, Math.PI * 2);
            ctx.fillStyle = COLORS.peg;
            ctx.fill();
          }
        }

        const bucketW = spacing * 0.92;
        for (let b = 0; b < bucketCount; b += 1) {
          const multiplier = multipliers[b] ?? 0;
          const x = nodeX(b, rows) - bucketW / 2;
          const color = bucketColor(multiplier);

          const landedAt = landedRef.current.get(b);
          const flash = landedAt
            ? Math.max(0, 1 - (performance.now() - landedAt) / LANDED_FLASH_MS)
            : 0;

          ctx.beginPath();
          const r = 5;
          const y = bucketY + (reducedMotion ? 0 : flash * 3);
          ctx.moveTo(x + r, y);
          ctx.arcTo(x + bucketW, y, x + bucketW, y + bucketH, r);
          ctx.arcTo(x + bucketW, y + bucketH, x, y + bucketH, r);
          ctx.arcTo(x, y + bucketH, x, y, r);
          ctx.arcTo(x, y, x + bucketW, y, r);
          ctx.closePath();

          ctx.fillStyle = color;
          ctx.globalAlpha = 0.16 + flash * 0.55;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1 + flash;
          ctx.stroke();

          ctx.fillStyle = color;
          ctx.font = `700 ${Math.min(12, bucketW * 0.34)}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const text =
            multiplier >= 100 ? `${Math.round(multiplier)}x` : `${multiplier}x`;
          ctx.fillText(text, x + bucketW / 2, y + bucketH / 2);
        }

        for (const drop of drops) {
          const runtime = runtimeRef.current.get(drop.id);
          if (!runtime) continue;

          const steps = drop.path.length;
          const elapsed = time >= 0 ? performance.now() - runtime.startedAt : 0;
          const progress =
            perSegment === 0 ? steps : Math.min(steps, elapsed / perSegment);
          const segment = Math.floor(progress);
          const t = progress - segment;

          // Waypoints are fixed by the server path; easing only shapes travel.
          let rightCount = 0;
          for (let i = 0; i < Math.min(segment, steps); i += 1) {
            if (drop.path[i] === 'R') rightCount += 1;
          }

          let x: number;
          let y: number;
          if (segment >= steps) {
            x = nodeX(rightCount, steps);
            y = nodeY(steps) - 4;

            if (!runtime.completed) {
              runtime.completed = true;
              landedRef.current.set(bucketOf(drop), performance.now());
              onCompleteRef.current?.(drop);
            }
          } else {
            const goesRight = drop.path[segment] === 'R';
            const fromX = nodeX(rightCount, segment);
            const toX = nodeX(rightCount + (goesRight ? 1 : 0), segment + 1);
            const fromY = nodeY(segment);
            const toY = nodeY(segment + 1);

            const easeX = t * t * (3 - 2 * t); // smoothstep
            x = fromX + (toX - fromX) * easeX;
            y = fromY + (toY - fromY) * (t * t) - Math.sin(t * Math.PI) * rowGap * 0.14;
          }

          if (!reducedMotion && segment < steps) {
            ctx.beginPath();
            ctx.arc(x, y, 8, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(245,184,61,.16)';
            ctx.fill();
          }

          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.fillStyle = COLORS.ball;
          ctx.shadowColor = COLORS.ball;
          ctx.shadowBlur = 12;
          ctx.fill();
          ctx.shadowBlur = 0;
        }

        // Expire finished bucket flashes so the map cannot grow unbounded.
        for (const [bucket, at] of [...landedRef.current.entries()]) {
          if (performance.now() - at > LANDED_FLASH_MS) {
            landedRef.current.delete(bucket);
          }
        }

        if (multipliers.length !== bucketCount) {
          ctx.fillStyle = COLORS.muted;
          ctx.font = `11px ${FONT}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(
            `expected ${bucketCount} multipliers, got ${multipliers.length}`,
            10,
            8
          );
        }
      },
    [rows, multipliers, drops, perSegment, reducedMotion]
  );

  const canvasRef = useCanvasRenderer(draw);

  const latest = drops[drops.length - 1];
  const label = latest
    ? `Plinko board, ${rows} rows. Latest ball landed in bucket ${bucketOf(latest)} paying ${
        latest.multiplier ?? multipliers[bucketOf(latest)] ?? 0
      }x`
    : `Plinko board with ${rows} rows and ${rows + 1} payout buckets`;

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

export default PlinkoCanvas;
