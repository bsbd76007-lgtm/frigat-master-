'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  ON_ACCENT,
  alpha,
  drawBackdrop,
  drawBox,
  drawBoxShadow,
  drawFaceText,
  drawVignette,
  faces,
  makeScene,
  makeTileGrid,
  shade,
} from './three';

export type KenoTileState = 'idle' | 'picked' | 'drawn' | 'hit';

export interface KenoCanvasProps {
  tileCount: number;
  columns?: number;
  picks: number[];
  /** Drawn numbers already turned — the page reveals them one at a time. */
  drawn: number[];
  /** False while a draw is running, so picks cannot change mid-reveal. */
  interactive: boolean;
  onToggle(tile: number): void;
  /** Translated board name for assistive tech; the status is appended to it. */
  ariaLabel?: string;
  height?: number;
  className?: string;
}

const THICKNESS = { idle: 10, hover: 14, picked: 20, drawn: 7, hit: 24 } as const;
const TURN_MS = 240;

export function KenoCanvas({
  tileCount,
  columns = 8,
  picks,
  drawn,
  interactive,
  onToggle,
  ariaLabel = 'Keno board',
  height = 400,
  className,
}: KenoCanvasProps) {
  const reducedMotion = usePrefersReducedMotion();
  const rows = Math.max(1, Math.ceil(tileCount / columns));

  const [hovered, setHovered] = useState<number | null>(null);
  const gridRef = useRef<ReturnType<typeof makeTileGrid> | null>(null);
  const turnedAtRef = useRef(new Map<number, number>());

  const pickSet = useMemo(() => new Set(picks), [picks]);
  const drawnSet = useMemo(() => new Set(drawn), [drawn]);

  const stateOf = useCallback(
    (tile: number): KenoTileState => {
      const isDrawn = drawnSet.has(tile);
      const isPicked = pickSet.has(tile);
      if (isDrawn && isPicked) return 'hit';
      if (isDrawn) return 'drawn';
      if (isPicked) return 'picked';
      return 'idle';
    },
    [drawnSet, pickSet]
  );

  // Only a draw animates. A pick is a click and should answer instantly, so it
  // is not recorded here.
  useEffect(() => {
    const turned = turnedAtRef.current;
    const now = performance.now();
    for (const tile of drawnSet) if (!turned.has(tile)) turned.set(tile, now);
    for (const tile of [...turned.keys()]) if (!drawnSet.has(tile)) turned.delete(tile);
  }, [drawnSet]);

  const draw = useMemo(
    () =>
      ({ ctx, width, height: h }: CanvasFrame) => {
        const scene = makeScene(width, h, { top: 0.1, bottom: 0.95, focus: 0.55, far: 2.3 });
        const inset = Math.min(width * 0.06, 34);
        const grid = makeTileGrid(scene, {
          columns,
          rows,
          x0: inset,
          x1: width - inset,
          y0: 0.05,
          y1: 0.95,
          gap: 0.16,
        });
        gridRef.current = grid;

        const anyHit = [...drawnSet].some((tile) => pickSet.has(tile));
        drawBackdrop(ctx, scene, {
          glow: anyHit ? GOLD : ACCENT,
          glowStrength: anyHit ? 0.12 : 0.08,
        });

        const now = performance.now();
        const label = Math.max(9, Math.min(15, width / (columns * 3.4)));

        for (const tile of grid.drawOrder()) {
          if (tile >= tileCount) continue;
          const state = stateOf(tile);
          const isHovered = hovered === tile && interactive;

          let thickness: number;
          if (state === 'idle') thickness = isHovered ? THICKNESS.hover : THICKNESS.idle;
          else if (state === 'picked') thickness = THICKNESS.picked;
          else {
            const turnedAt = turnedAtRef.current.get(tile) ?? now;
            const t = reducedMotion ? 1 : Math.min(1, (now - turnedAt) / TURN_MS);
            const eased = 1 - Math.pow(1 - t, 3);
            const from = state === 'hit' ? THICKNESS.picked : THICKNESS.idle;
            const to = state === 'hit' ? THICKNESS.hit : THICKNESS.drawn;
            // A hit overshoots on the way up — the only tile that celebrates.
            const overshoot =
              state === 'hit' && !reducedMotion ? Math.sin(t * Math.PI) * 5 : 0;
            thickness = from + (to - from) * eased + overshoot;
          }

          const box = grid.boxOf(tile, { thickness });
          drawBoxShadow(ctx, scene, box, state === 'drawn' ? 0.45 : 0.85);
          drawBox(ctx, scene, box, tileFaces(state, isHovered));

          if (state === 'hit') {
            const turnedAt = turnedAtRef.current.get(tile) ?? now;
            const flash = reducedMotion ? 0 : Math.max(0, 1 - (now - turnedAt) / 700);
            if (flash > 0) {
              const centre = scene.project((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, box.z1);
              const r = (box.x1 - box.x0) * scene.scale(box.y1) * (0.6 + flash * 0.9);
              ctx.beginPath();
              ctx.arc(centre.x, centre.y, r, 0, Math.PI * 2);
              ctx.fillStyle = alpha(GOLD, 0.22 * flash);
              ctx.fill();
            }
          }

          drawFaceText(ctx, scene, box, 'top', String(tile + 1), {
            fill: labelColour(state),
            size: label,
            weight: state === 'idle' ? 600 : 700,
            family: FONT.num,
          });
        }

        if (picks.length === 0 && drawn.length === 0) {
          const centre = scene.project(scene.vanishX, 0.5, 74);
          ctx.fillStyle = BOARD.muted;
          ctx.font = `600 13px ${FONT.body}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('Pick your numbers', centre.x, centre.y);
        }

        drawVignette(ctx, scene);
      },
    [
      columns,
      rows,
      tileCount,
      stateOf,
      hovered,
      interactive,
      drawnSet,
      pickSet,
      picks.length,
      drawn.length,
      reducedMotion,
    ]
  );

  const canvasRef = useCanvasRenderer(draw);

  const tileAt = (event: React.PointerEvent<HTMLCanvasElement>): number | null => {
    const canvas = canvasRef.current;
    const grid = gridRef.current;
    if (!canvas || !grid) return null;
    const rect = canvas.getBoundingClientRect();
    const tile = grid.indexAt({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    return tile !== null && tile < tileCount ? tile : null;
  };

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        display: 'block',
        width: '100%',
        height,
        borderRadius: 12,
        cursor: interactive && hovered !== null ? 'pointer' : 'default',
        touchAction: 'manipulation',
      }}
      role="img"
      aria-label={`${ariaLabel}, ${tileCount} tiles, ${picks.length} picked${
        drawn.length > 0 ? `, ${drawn.length} drawn` : ''
      }`}
      onPointerMove={(event) => setHovered(tileAt(event))}
      onPointerLeave={() => setHovered(null)}
      onPointerDown={(event) => {
        if (!interactive) return;
        const tile = tileAt(event);
        if (tile !== null) onToggle(tile);
      }}
    />
  );
}

function tileFaces(state: KenoTileState, hovered: boolean) {
  switch (state) {
    case 'picked':
      return faces(ACCENT_DEEP);
    case 'hit':
      return faces(GOLD, { top: GOLD_SOFT });
    case 'drawn':
      // A miss is still information: lighter than an untouched tile, but flat.
      return faces(shade(BOARD.neutral, -0.25));
    default:
      return faces(hovered ? BOARD.neutralLit : BOARD.neutral);
  }
}

function labelColour(state: KenoTileState): string {
  switch (state) {
    case 'picked':
      return ON_ACCENT;
    case 'hit':
      return '#3a2a08';
    case 'drawn':
      return BOARD.dim;
    default:
      return BOARD.muted;
  }
}

export default KenoCanvas;
