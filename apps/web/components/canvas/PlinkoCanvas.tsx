'use client';

import { useEffect, useMemo, useRef } from 'react';

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
  alpha,
  drawBackdrop,
  drawBox,
  drawBoxShadow,
  drawCylinder,
  drawFaceText,
  drawFloorShadow,
  drawSphere,
  drawVignette,
  faces,
  makeScene,
  multiplierColour,
  shade,
} from './three';

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
const PEG_RADIUS = 3.4;
const PEG_HEIGHT = 10;
const BALL_RADIUS = 6.5;
/** The board's pegs end here, leaving the near strip for the payout slots. */
const FIELD_END = 0.78;
const BUCKET_TOP = 0.83;
const BUCKET_END = 0.99;

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
        const scene = makeScene(width, h, { top: 0.05, bottom: 0.97, focus: 0.62, far: 2.5 });

        const bucketCount = rows + 1;
        const inset = Math.min(width * 0.06, 30);
        const spacing = (width - inset * 2) / bucketCount;
        const centre = width / 2;
        const rowGap = (FIELD_END - 0.03) / Math.max(1, rows);

        /** World x of the node reached after `level` rows, `right` of them right. */
        const nodeX = (right: number, level: number) =>
          centre + (right - level / 2) * spacing;
        const nodeY = (level: number) => 0.03 + level * rowGap;

        const hot = [...landedRef.current.values()].some(
          (at) => performance.now() - at < LANDED_FLASH_MS
        );
        drawBackdrop(ctx, scene, {
          glow: hot ? GOLD : ACCENT,
          glowStrength: hot ? 0.13 : 0.08,
        });

        // Pegs, far rows first so a nearer peg overlaps the one behind it.
        for (let level = 0; level < rows; level += 1) {
          for (let j = 0; j <= level; j += 1) {
            const x = nodeX(j, level);
            const y = nodeY(level);
            drawFloorShadow(ctx, scene, x, y, PEG_RADIUS, 0, 0.5);
            drawCylinder(ctx, scene, x, y, PEG_RADIUS, 0, PEG_HEIGHT, BOARD.neutralLit);
          }
        }

        // Payout slots: taller is worth more, so the board's own profile reads
        // as the paytable before a single number is parsed.
        const bucketW = spacing * 0.9;
        const best = multipliers.reduce((m, v) => Math.max(m, v), 1);
        for (let b = 0; b < bucketCount; b += 1) {
          const multiplier = multipliers[b] ?? 0;
          const colour = multiplierColour(multiplier);
          const landedAt = landedRef.current.get(b);
          const flash = landedAt
            ? Math.max(0, 1 - (performance.now() - landedAt) / LANDED_FLASH_MS)
            : 0;

          const worth = Math.min(1, Math.log(Math.max(multiplier, 1) + 1) / Math.log(best + 1));
          const tall = 12 + worth * 26;
          const x = nodeX(b, rows);
          const box = {
            x0: x - bucketW / 2,
            x1: x + bucketW / 2,
            y0: BUCKET_TOP,
            y1: BUCKET_END,
            z0: 0,
            // A ball landing presses its slot in, then it springs back.
            z1: Math.max(4, tall - (reducedMotion ? 0 : flash * 7)),
          };

          drawBoxShadow(ctx, scene, box, 0.7);
          drawBox(
            ctx,
            scene,
            box,
            faces(flash > 0 ? shade(colour, 0.2 + flash * 0.3) : colour)
          );
          drawFaceText(ctx, scene, box, 'front', formatMultiplier(multiplier), {
            fill: slotLabelColour(multiplier, flash),
            size: Math.min(13, bucketW * 0.34),
            weight: 700,
            family: FONT.num,
          });
        }

        // Balls.
        for (const drop of drops) {
          const runtime = runtimeRef.current.get(drop.id);
          if (!runtime) continue;

          const steps = drop.path.length;
          const elapsed = performance.now() - runtime.startedAt;
          const progress = perSegment === 0 ? steps : Math.min(steps, elapsed / perSegment);
          const segment = Math.floor(progress);
          const t = progress - segment;

          let right = 0;
          for (let i = 0; i < Math.min(segment, steps); i += 1) {
            if (drop.path[i] === 'R') right += 1;
          }

          let x: number;
          let y: number;
          let z = PEG_HEIGHT + BALL_RADIUS;

          if (segment >= steps) {
            const bucket = bucketOf(drop);
            x = nodeX(right, steps);
            y = BUCKET_TOP - 0.02;
            z = PEG_HEIGHT + BALL_RADIUS;

            if (!runtime.completed) {
              runtime.completed = true;
              landedRef.current.set(bucket, performance.now());
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
            y = fromY + (toY - fromY) * (t * t);
            // A hop over the peg rather than a slide along the board.
            z += Math.sin(t * Math.PI) * 9;
          }

          drawFloorShadow(ctx, scene, x, y, BALL_RADIUS, z, 0.8);
          if (!reducedMotion && segment < steps) {
            const glow = scene.project(x, y, z);
            const r = BALL_RADIUS * scene.scale(y) * 2.1;
            ctx.beginPath();
            ctx.arc(glow.x, glow.y, r, 0, Math.PI * 2);
            ctx.fillStyle = alpha(GOLD, 0.14);
            ctx.fill();
          }
          drawSphere(ctx, scene, x, y, z, BALL_RADIUS, GOLD);
        }

        for (const [bucket, at] of [...landedRef.current.entries()]) {
          if (performance.now() - at > LANDED_FLASH_MS) landedRef.current.delete(bucket);
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

        drawVignette(ctx, scene);
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

function formatMultiplier(multiplier: number): string {
  return multiplier >= 100 ? `${Math.round(multiplier)}x` : `${multiplier}x`;
}

/** Dark text on the bright slots, light on the dim ones. */
function slotLabelColour(multiplier: number, flash: number): string {
  if (flash > 0) return '#241a04';
  if (multiplier >= 2) return '#241a04';
  return BOARD.text;
}

export default PlinkoCanvas;
