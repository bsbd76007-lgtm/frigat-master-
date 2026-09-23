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
  GOLD_SOFT,
  NEG,
  POS,
  drawBackdrop,
  drawBox,
  drawBoxShadow,
  drawFaceText,
  drawVignette,
  faces,
  makeScene,
  shade,
  type Box,
} from './three';

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
/** Headroom above the taller of target and result, so nothing touches the top. */
const HEADROOM = 1.45;

export function LimboCanvas({
  target,
  round,
  onRollComplete,
  height = 400,
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
        const scene = makeScene(width, h, { top: 0.26, bottom: 0.92, focus: 0.6, far: 2.8 });

        const achieved = round?.achievedMultiplier ?? 1;
        const run = runRef.current;

        let value = 1;
        let running = false;
        if (run) {
          const t = reducedMotion ? 1 : Math.min(1, (performance.now() - run.startedAt) / ROLLOUT_MS);
          // Cubic ease-out in log space: the climb through the small multipliers
          // is quick and the last stretch is where the tension is.
          const eased = 1 - Math.pow(1 - t, 3);
          value = Math.exp(Math.log(Math.max(achieved, 1.0001)) * eased);
          running = t < 1;
          if (!running && !run.done) {
            run.done = true;
            onCompleteRef.current?.();
          }
        }

        const settled = run?.done === true;
        const win = settled ? round?.win === true : null;

        drawBackdrop(ctx, scene, {
          glow: win === null ? ACCENT : win ? POS : NEG,
          glowStrength: settled ? 0.14 : 0.09,
        });

        // The vertical scale is logarithmic — the only scale on which 2x and
        // 200x can share a stage — and it is pinned to whichever of the target
        // and the result is higher, so the gate never leaves the frame.
        const ceiling = Math.max(target, achieved, 1.02) * HEADROOM;
        const logCeiling = Math.log(ceiling);
        const zSpan = h * 0.52;
        const zOf = (multiplier: number) =>
          (Math.log(Math.max(multiplier, 1)) / logCeiling) * zSpan;

        const centre = width / 2;
        const pillarW = Math.min(112, width * 0.24);
        const y0 = 0.42;
        const y1 = 0.62;

        // The plinth the pillar stands on — 1.00x, the floor of the game.
        const plinth: Box = {
          x0: centre - pillarW * 0.86,
          x1: centre + pillarW * 0.86,
          y0: y0 - 0.1,
          y1: y1 + 0.1,
          z0: 0,
          z1: 8,
        };
        drawBoxShadow(ctx, scene, plinth, 0.8);
        drawBox(ctx, scene, plinth, faces(shade(BOARD.neutral, -0.4)));

        const pillarColour = win === null ? ACCENT_DEEP : win ? POS : NEG;
        const pillarZ = Math.max(2, zOf(value));
        const pillar: Box = {
          x0: centre - pillarW / 2,
          x1: centre + pillarW / 2,
          y0,
          y1,
          z0: 8,
          z1: 8 + pillarZ,
        };
        drawBox(ctx, scene, pillar, faces(pillarColour));

        // Rungs up the flank, one per power of ten — the cue that the axis is
        // logarithmic rather than just tall.
        for (let decade = 10; decade < ceiling; decade *= 10) {
          const z = 8 + zOf(decade);
          if (z > pillar.z1) break;
          const band: Box = { ...pillar, z0: z - 1.2, z1: z + 1.2 };
          drawBox(ctx, scene, band, faces(shade(pillarColour, 0.34)));
        }

        // The target gate: a gold lintel the pillar has to grow past to pay.
        const gateZ = 8 + zOf(target);
        const gate: Box = {
          x0: centre - pillarW * 0.95,
          x1: centre + pillarW * 0.95,
          y0: y0 - 0.05,
          y1: y1 + 0.05,
          z0: gateZ,
          z1: gateZ + 7,
        };
        const cleared = value >= target;
        drawBox(ctx, scene, gate, faces(cleared ? GOLD : shade(GOLD, -0.45), {
          top: cleared ? GOLD_SOFT : shade(GOLD, -0.3),
        }));
        drawFaceText(ctx, scene, gate, 'front', `TARGET ${formatMultiplier(target)}x`, {
          fill: cleared ? '#3a2a08' : shade(GOLD, -0.05),
          size: 10,
          weight: 800,
          family: FONT.num,
        });

        // The readout, on a plate riding the top of the pillar.
        const plateW = Math.min(230, width * 0.56);
        const plateH = plateW * 0.3;
        const plate: Box = {
          x0: centre - plateW / 2,
          x1: centre + plateW / 2,
          y0: y0 + 0.02,
          y1: y0 + 0.06,
          z0: pillar.z1 + 16,
          z1: pillar.z1 + 16 + plateH,
        };
        drawBoxShadow(ctx, scene, plate, 0.35);
        drawBox(ctx, scene, plate, faces(shade(BOARD.floor, 0.1)));
        drawFaceText(ctx, scene, plate, 'front', `${formatMultiplier(value)}x`, {
          fill: win === null ? BOARD.text : win ? POS : NEG,
          size: plateH * 0.52,
          weight: 700,
          family: FONT.display,
          maxWidthFraction: 0.88,
        });

        if (!run) {
          const hint = scene.project(centre, y1 + 0.24, 0);
          ctx.fillStyle = BOARD.muted;
          ctx.font = `600 12px ${FONT.body}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('Set a target and roll', hint.x, hint.y);
        }

        drawVignette(ctx, scene);
      },
    [target, round, reducedMotion]
  );

  const canvasRef = useCanvasRenderer(draw);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', width: '100%', height, borderRadius: 12 }}
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

export default LimboCanvas;
