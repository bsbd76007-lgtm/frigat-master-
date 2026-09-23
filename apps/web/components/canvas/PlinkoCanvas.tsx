'use client';

import { useEffect, useMemo, useRef } from 'react';

import {
  useCanvasRenderer,
  usePrefersReducedMotion,
  type CanvasFrame,
} from '@/lib/useCanvasRenderer';

import { BOARD, FONT, GOLD, alpha, multiplierColour, shade } from './three';

export interface PlinkoDrop {
  id: string;
  path: Array<'L' | 'R'>;
  bucket?: number;
  multiplier?: number;
}

export interface PlinkoCanvasProps {
  rows: number;
  multipliers: number[];
  drops: PlinkoDrop[];
  onDropComplete?: (drop: PlinkoDrop) => void;
  segmentMs?: number;
  height?: number;
  className?: string;
}

const LANDED_FLASH_MS = 700;
const PEG_R = 3;
const BALL_R = 6;
const SLOT_H = 26;

export function bucketOf(drop: PlinkoDrop): number {
  if (typeof drop.bucket === 'number') return drop.bucket;
  return drop.path.reduce((count, step) => count + (step === 'R' ? 1 : 0), 0);
}

interface DropRuntime {
  startedAt: number;
  completed: boolean;
}

/**
 * Front-on and flat: the peg triangle, the ball falling through it, the payout
 * slots underneath.
 *
 * The board is read as a shape — where in the triangle the ball is, and which
 * slot it is heading for — and a tilted camera makes the slots nearest the
 * bottom of the screen read as bigger than the ones at the edges, which is
 * exactly the comparison the player is trying to make.
 */
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
  const landedRef = useRef(new Map<number, number>());
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
      ({ ctx, width, height: h }: CanvasFrame) => {
        ctx.clearRect(0, 0, width, h);

        const bucketCount = rows + 1;
        const padX = 14;
        const topY = 24;
        const fieldH = Math.max(1, h - topY - SLOT_H - 20);
        const rowGap = fieldH / Math.max(1, rows);
        const spacing = Math.min(rowGap * 1.05, (width - padX * 2) / Math.max(1, bucketCount));
        const cx = width / 2;
        const slotY = topY + rows * rowGap + 12;

        const nodeX = (right: number, level: number) => cx + (right - level / 2) * spacing;
        const nodeY = (level: number) => topY + level * rowGap;

        const now = performance.now();

        // Pegs.
        ctx.fillStyle = BOARD.neutralLit;
        for (let level = 0; level < rows; level += 1) {
          for (let j = 0; j <= level; j += 1) {
            ctx.beginPath();
            ctx.arc(nodeX(j, level), nodeY(level), PEG_R, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Payout slots.
        const slotW = spacing * 0.92;
        for (let b = 0; b < bucketCount; b += 1) {
          const multiplier = multipliers[b] ?? 0;
          const colour = multiplierColour(multiplier);
          const landedAt = landedRef.current.get(b);
          const flash = landedAt ? Math.max(0, 1 - (now - landedAt) / LANDED_FLASH_MS) : 0;

          const x = nodeX(b, rows) - slotW / 2;
          // A ball landing knocks its slot down, and it springs back.
          const y = slotY + (reducedMotion ? 0 : flash * 4);

          roundedRect(ctx, x, y, slotW, SLOT_H, 5);
          ctx.fillStyle = alpha(colour, 0.22 + flash * 0.58);
          ctx.fill();
          ctx.strokeStyle = colour;
          ctx.lineWidth = 1 + flash;
          ctx.stroke();

          // The mid slots are the dullest colour on the board, so their label
          // takes the text ramp rather than the slot's own near-grey.
          ctx.fillStyle = flash > 0.35 ? '#141419' : multiplier < 2 ? BOARD.muted : colour;
          ctx.font = `700 ${Math.min(11, slotW * 0.3)}px ${FONT.num}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            multiplier >= 100 ? `${Math.round(multiplier)}x` : `${multiplier}x`,
            x + slotW / 2,
            y + SLOT_H / 2,
            // Clamped, or a four-digit multiplier runs into the next slot.
            slotW - 6
          );
        }

        // Balls.
        for (const drop of drops) {
          const runtime = runtimeRef.current.get(drop.id);
          if (!runtime) continue;

          const steps = drop.path.length;
          const elapsed = now - runtime.startedAt;
          const progress = perSegment === 0 ? steps : Math.min(steps, elapsed / perSegment);
          const segment = Math.floor(progress);
          const t = progress - segment;

          let right = 0;
          for (let i = 0; i < Math.min(segment, steps); i += 1) {
            if (drop.path[i] === 'R') right += 1;
          }

          let x: number;
          let y: number;
          if (segment >= steps) {
            x = nodeX(right, steps);
            y = nodeY(steps) - 4;
            if (!runtime.completed) {
              runtime.completed = true;
              landedRef.current.set(bucketOf(drop), now);
              onCompleteRef.current?.(drop);
            }
          } else {
            const goesRight = drop.path[segment] === 'R';
            const fromX = nodeX(right, segment);
            const toX = nodeX(right + (goesRight ? 1 : 0), segment + 1);
            const fromY = nodeY(segment);
            const toY = nodeY(segment + 1);
            const easeX = t * t * (3 - 2 * t);
            x = fromX + (toX - fromX) * easeX;
            // Falls with gravity, and hops a little off each peg.
            y = fromY + (toY - fromY) * (t * t) - Math.sin(t * Math.PI) * rowGap * 0.14;
          }

          if (!reducedMotion && segment < steps) {
            ctx.beginPath();
            ctx.arc(x, y, BALL_R * 1.8, 0, Math.PI * 2);
            ctx.fillStyle = alpha(GOLD, 0.15);
            ctx.fill();
          }

          const shine = ctx.createRadialGradient(x - BALL_R * 0.35, y - BALL_R * 0.4, 1, x, y, BALL_R);
          shine.addColorStop(0, shade(GOLD, 0.5));
          shine.addColorStop(1, shade(GOLD, -0.22));
          ctx.beginPath();
          ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
          ctx.fillStyle = shine;
          ctx.fill();
        }

        for (const [bucket, at] of [...landedRef.current.entries()]) {
          if (now - at > LANDED_FLASH_MS) landedRef.current.delete(bucket);
        }

        if (multipliers.length !== bucketCount) {
          ctx.fillStyle = BOARD.dim;
          ctx.font = `600 11px ${FONT.body}`;
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
      style={{ display: 'block', width: '100%', height }}
      role="img"
      aria-label={label}
    />
  );
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

export default PlinkoCanvas;
