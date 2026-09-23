'use client';

import { useEffect, useMemo, useRef } from 'react';

import {
  useCanvasRenderer,
  usePrefersReducedMotion,
  type CanvasFrame,
} from '@/lib/useCanvasRenderer';

import {
  ACCENT,
  ACCENT_DEEP,
  BOARD,
  FONT,
  GOLD,
  NEG,
  ON_ACCENT,
  POS,
  alpha,
  drawBackdrop,
  drawBox,
  drawBoxShadow,
  drawCylinder,
  drawFaceText,
  drawFloorShadow,
  drawVignette,
  faces,
  makeScene,
  shade,
  type Box,
} from './three';

export type DiceDirection = 'OVER' | 'UNDER';

export interface DiceCanvasProps {
  /** 1–99. The line the roll is compared against. */
  target: number;
  direction: DiceDirection;
  /**
   * The settled roll and an id that changes per round. A new id is what starts
   * the slide, so re-rolling the same number still animates.
   */
  roll: number | null;
  rollId: string | null;
  won: boolean | null;
  /** Called once the needle has finished settling on the roll. */
  onRollComplete?: () => void;
  height?: number;
  className?: string;
}

const RAIL_Z = 9;
const ZONE_Z = 17;
const SLIDE_MS = 560;

export function DiceCanvas({
  target,
  direction,
  roll,
  rollId,
  won,
  onRollComplete,
  height = 300,
  className,
}: DiceCanvasProps) {
  const reducedMotion = usePrefersReducedMotion();

  /** Where the needle currently stands, so the next roll slides from here. */
  const needleRef = useRef(50);
  const slideRef = useRef<{ from: number; to: number; startedAt: number; done: boolean } | null>(
    null
  );
  const onCompleteRef = useRef(onRollComplete);
  onCompleteRef.current = onRollComplete;

  useEffect(() => {
    if (rollId === null || roll === null) {
      slideRef.current = null;
      return;
    }
    slideRef.current = {
      from: needleRef.current,
      to: roll,
      startedAt: performance.now(),
      done: false,
    };
  }, [rollId, roll]);

  const draw = useMemo(
    () =>
      ({ ctx, width, height: h }: CanvasFrame) => {
        const scene = makeScene(width, h, { top: 0.2, bottom: 0.9, focus: 0.62, far: 2.6 });
        const pad = Math.min(width * 0.08, 46);
        const left = pad;
        const right = width - pad;
        const span = right - left;
        const at = (value: number) => left + (span * Math.min(100, Math.max(0, value))) / 100;

        const slide = slideRef.current;
        let needle = needleRef.current;
        if (slide) {
          const t = reducedMotion ? 1 : Math.min(1, (performance.now() - slide.startedAt) / SLIDE_MS);
          // Ease out with a touch of settle, so the needle arrives rather than
          // stopping dead on the number.
          const eased = 1 - Math.pow(1 - t, 4);
          needle = slide.from + (slide.to - slide.from) * eased;
          if (t >= 1 && !slide.done) {
            slide.done = true;
            needle = slide.to;
            onCompleteRef.current?.();
          }
        }
        needleRef.current = needle;

        const settled = slide?.done === true;
        drawBackdrop(ctx, scene, {
          glow: settled && won !== null ? (won ? POS : NEG) : ACCENT,
          glowStrength: settled ? 0.13 : 0.08,
          gridCols: 0,
        });

        const y0 = 0.3;
        const y1 = 0.74;

        // The rail: the whole 0–100 range, recessed and unlit.
        const rail: Box = { x0: left, x1: right, y0, y1, z0: 0, z1: RAIL_Z };
        drawBoxShadow(ctx, scene, rail, 0.7);
        drawBox(ctx, scene, rail, faces(shade(BOARD.neutral, -0.4)));

        // The win zone, standing proud of the rail on the side that pays.
        const zone: Box =
          direction === 'UNDER'
            ? { x0: left, x1: at(target), y0, y1, z0: RAIL_Z, z1: ZONE_Z }
            : { x0: at(target), x1: right, y0, y1, z0: RAIL_Z, z1: ZONE_Z };
        if (zone.x1 - zone.x0 > 1) {
          drawBox(ctx, scene, zone, faces(ACCENT_DEEP));
          drawFaceText(ctx, scene, zone, 'top', direction === 'UNDER' ? 'UNDER' : 'OVER', {
            fill: alpha(ON_ACCENT, 0.5),
            size: 11,
            weight: 800,
            family: FONT.body,
            maxWidthFraction: 0.5,
          });
        }

        // The line itself — a gold post, because it is the thing the player set.
        const postX = at(target);
        const post: Box = {
          x0: postX - 1.6,
          x1: postX + 1.6,
          y0: y0 - 0.02,
          y1: y1 + 0.02,
          z0: 0,
          z1: ZONE_Z + 12,
        };
        drawBox(ctx, scene, post, faces(GOLD));

        // Scale, lying on the floor in front of the rail.
        for (const mark of [0, 25, 50, 75, 100]) {
          const x = at(mark);
          const tick: Box = {
            x0: x - span * 0.045,
            x1: x + span * 0.045,
            y0: y1 + 0.06,
            y1: y1 + 0.2,
            z0: 0,
            z1: 0,
          };
          drawFaceText(ctx, scene, tick, 'top', String(mark), {
            fill: BOARD.dim,
            size: 11,
            weight: 600,
            family: FONT.num,
          });
        }

        // The needle: a post on the rail with the roll on a plate above it.
        const needleX = at(needle);
        const needleColour = settled && won !== null ? (won ? POS : NEG) : BOARD.neutralLit;
        const midY = (y0 + y1) / 2;

        drawFloorShadow(ctx, scene, needleX, midY, 11, ZONE_Z + 30, 0.9);
        drawCylinder(ctx, scene, needleX, midY, 4.5, ZONE_Z, ZONE_Z + 34, shade(needleColour, -0.15));
        drawCylinder(ctx, scene, needleX, midY, 12, ZONE_Z, ZONE_Z + 7, needleColour);

        const plateW = Math.min(96, span * 0.24);
        const plate: Box = {
          x0: needleX - plateW / 2,
          x1: needleX + plateW / 2,
          y0: midY - 0.02,
          y1: midY + 0.02,
          z0: ZONE_Z + 34,
          z1: ZONE_Z + 34 + plateW * 0.42,
        };
        drawBox(ctx, scene, plate, faces(shade(BOARD.neutralLit, -0.12)));
        drawFaceText(ctx, scene, plate, 'front', formatRoll(needle, settled, roll), {
          fill: settled && won !== null ? (won ? POS : NEG) : BOARD.text,
          size: plateW * 0.24,
          weight: 700,
          family: FONT.num,
        });

        drawVignette(ctx, scene);
      },
    [target, direction, roll, won, reducedMotion]
  );

  const canvasRef = useCanvasRenderer(draw);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', width: '100%', height, borderRadius: 12 }}
      role="img"
      aria-label={
        roll !== null
          ? `Dice rail. Rolled ${roll.toFixed(2)}, ${direction.toLowerCase()} ${target}`
          : `Dice rail. Win zone is ${direction.toLowerCase()} ${target}`
      }
    />
  );
}

/** Mid-slide the needle shows where it is; settled, it shows the exact roll. */
function formatRoll(needle: number, settled: boolean, roll: number | null): string {
  if (settled && roll !== null) return roll.toFixed(2);
  return needle.toFixed(2);
}

export default DiceCanvas;
