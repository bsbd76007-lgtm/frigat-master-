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
  NEG,
  ON_ACCENT,
  alpha,
  drawBackdrop,
  drawBox,
  drawBoxShadow,
  drawVignette,
  faces,
  makeScene,
  makeTileGrid,
  poly,
  shade,
  type Scene,
} from './three';

export type MineTileState = 'idle' | 'safe' | 'mine' | 'hit';

export interface MinesCanvasProps {
  gridSize: number;
  columns?: number;
  /** Tiles the server has confirmed safe. */
  revealed: number[];
  /** Every mine, sent only once the round is over. */
  minePositions: number[];
  /** The mine that ended the round. */
  hitTile: number | null;
  /** Whether a click should try to reveal. False between rounds and while busy. */
  interactive: boolean;
  onReveal(tile: number): void;
  /** Translated board name for assistive tech; the status is appended to it. */
  ariaLabel?: string;
  height?: number;
  className?: string;
}

/** An unrevealed tile stands proud of the floor; revealing presses it in. */
const THICKNESS = { idle: 17, hover: 21, revealed: 7, hit: 13 } as const;
const PRESS_MS = 260;
const FLASH_MS = 900;

export function MinesCanvas({
  gridSize,
  columns = 5,
  revealed,
  minePositions,
  hitTile,
  interactive,
  onReveal,
  ariaLabel = 'Mines board',
  height = 420,
  className,
}: MinesCanvasProps) {
  const reducedMotion = usePrefersReducedMotion();
  const rows = Math.max(1, Math.ceil(gridSize / columns));

  const [hovered, setHovered] = useState<number | null>(null);
  const gridRef = useRef<ReturnType<typeof makeTileGrid> | null>(null);
  /** When each tile turned — drives the press-in, so it must survive a redraw. */
  const turnedAtRef = useRef(new Map<number, number>());

  const revealedSet = useMemo(() => new Set(revealed), [revealed]);
  const mineSet = useMemo(() => new Set(minePositions), [minePositions]);

  const stateOf = useCallback(
    (tile: number): MineTileState => {
      if (hitTile === tile) return 'hit';
      if (mineSet.has(tile)) return 'mine';
      if (revealedSet.has(tile)) return 'safe';
      return 'idle';
    },
    [hitTile, mineSet, revealedSet]
  );

  // A tile's turn time is recorded once, the frame its state first stops being
  // idle. Reading it during the draw instead would restart the animation on
  // every frame.
  useEffect(() => {
    const turned = turnedAtRef.current;
    const now = performance.now();
    for (let tile = 0; tile < gridSize; tile += 1) {
      const isOpen = stateOf(tile) !== 'idle';
      if (isOpen && !turned.has(tile)) turned.set(tile, now);
      if (!isOpen && turned.has(tile)) turned.delete(tile);
    }
  }, [gridSize, stateOf]);

  const draw = useMemo(
    () =>
      ({ ctx, width, height: h }: CanvasFrame) => {
        const scene = makeScene(width, h, { top: 0.08, bottom: 0.94, focus: 0.55 });
        const inset = Math.min(width * 0.12, 64);
        const grid = makeTileGrid(scene, {
          columns,
          rows,
          x0: inset,
          x1: width - inset,
          y0: 0.06,
          y1: 0.94,
          gap: 0.14,
        });
        gridRef.current = grid;

        const busted = hitTile !== null;
        drawBackdrop(ctx, scene, {
          glow: busted ? NEG : ACCENT,
          glowStrength: busted ? 0.13 : 0.09,
        });

        const now = performance.now();

        // Far to near: a nearer tile has to paint over the one behind it.
        for (const tile of grid.drawOrder()) {
          if (tile >= gridSize) continue;
          const state = stateOf(tile);
          const turnedAt = turnedAtRef.current.get(tile);
          const press = turnedAt
            ? reducedMotion
              ? 1
              : Math.min(1, (now - turnedAt) / PRESS_MS)
            : 0;
          const eased = 1 - Math.pow(1 - press, 3);

          const isHovered = hovered === tile && interactive && state === 'idle';
          const from = isHovered ? THICKNESS.hover : THICKNESS.idle;
          const to = state === 'hit' ? THICKNESS.hit : THICKNESS.revealed;
          const thickness = state === 'idle' ? from : from + (to - from) * eased;

          const box = grid.boxOf(tile, { thickness });
          drawBoxShadow(ctx, scene, box, state === 'idle' ? 0.9 : 0.5);
          drawBox(ctx, scene, box, tileFaces(state, isHovered));

          // A hairline inset on the top face reads as a bevel and stops a run
          // of same-coloured tiles reading as one slab.
          const rim = state === 'idle' ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.08)';
          drawTopRim(ctx, scene, box, rim);

          if (state === 'safe') {
            drawGem(ctx, scene, box, ON_ACCENT, eased);
          } else if (state === 'mine' || state === 'hit') {
            drawMine(ctx, scene, box, state === 'hit', eased);
          }

          if (state === 'hit' && !reducedMotion) {
            const flash = Math.max(0, 1 - (now - (turnedAt ?? now)) / FLASH_MS);
            if (flash > 0) drawTopRim(ctx, scene, box, alpha(NEG, 0.2 + flash * 0.7), 2);
          }
        }

        if (!interactive && revealed.length === 0 && !busted) {
          const centre = scene.project(scene.vanishX, 0.5, 90);
          ctx.fillStyle = BOARD.muted;
          ctx.font = `600 13px ${FONT.body}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('Place a bet to open the board', centre.x, centre.y);
        }

        drawVignette(ctx, scene);
      },
    [columns, rows, gridSize, stateOf, hovered, interactive, hitTile, revealed.length, reducedMotion]
  );

  const canvasRef = useCanvasRenderer(draw);

  const tileAt = (event: React.PointerEvent<HTMLCanvasElement>): number | null => {
    const canvas = canvasRef.current;
    const grid = gridRef.current;
    if (!canvas || !grid) return null;
    const rect = canvas.getBoundingClientRect();
    const tile = grid.indexAt({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    return tile !== null && tile < gridSize ? tile : null;
  };

  const canReveal = (tile: number | null) =>
    tile !== null && interactive && stateOf(tile) === 'idle';

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        display: 'block',
        width: '100%',
        height,
        borderRadius: 12,
        cursor: canReveal(hovered) ? 'pointer' : 'default',
        touchAction: 'manipulation',
      }}
      role="img"
      aria-label={
        hitTile !== null
          ? `${ariaLabel}, round over on tile ${hitTile + 1}`
          : `${ariaLabel}, ${revealed.length} of ${gridSize} tiles revealed`
      }
      onPointerMove={(event) => setHovered(tileAt(event))}
      onPointerLeave={() => setHovered(null)}
      onPointerDown={(event) => {
        const tile = tileAt(event);
        if (canReveal(tile)) onReveal(tile as number);
      }}
    />
  );
}

function tileFaces(state: MineTileState, hovered: boolean) {
  switch (state) {
    case 'safe':
      return faces(ACCENT_DEEP);
    case 'hit':
      return faces(NEG, { top: shade(NEG, 0.28) });
    case 'mine':
      return faces(shade(NEG, -0.45));
    default:
      return faces(hovered ? BOARD.neutralLit : BOARD.neutral);
  }
}

/** A hairline along the edge of the top face. */
function drawTopRim(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  box: { x0: number; x1: number; y0: number; y1: number; z1: number },
  colour: string,
  lineWidth = 1
): void {
  const P = scene.project;
  const corners = [
    P(box.x0, box.y0, box.z1),
    P(box.x1, box.y0, box.z1),
    P(box.x1, box.y1, box.z1),
    P(box.x0, box.y1, box.z1),
  ];
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.strokeStyle = colour;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

/**
 * A four-sided pyramid standing on a tile — the safe-tile gem. Built from the
 * scene rather than drawn as a glyph so it catches the same light as the tile
 * under it and grows out of it as the tile presses in.
 */
function drawGem(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  box: { x0: number; x1: number; y0: number; y1: number; z1: number },
  base: string,
  grow: number
): void {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const half = (box.x1 - box.x0) * 0.3;
  const halfDepth = (box.y1 - box.y0) * 0.3;
  const apexZ = box.z1 + half * 1.5 * Math.max(0.05, grow);

  const apex = scene.project(cx, cy, apexZ);
  const rim = [
    scene.project(cx - half, cy, box.z1),
    scene.project(cx, cy - halfDepth, box.z1),
    scene.project(cx + half, cy, box.z1),
    scene.project(cx, cy + halfDepth, box.z1),
  ];
  // Left-facing flanks are the lit ones, matching every box on the board.
  const tone = [0.0, -0.18, -0.34, 0.16];
  for (let i = 0; i < rim.length; i += 1) {
    poly(ctx, [rim[i], rim[(i + 1) % rim.length], apex], shade(base, tone[i]));
  }
}

/** A dark bead with a glint — the mine. Bright while it is the one that hit. */
function drawMine(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  box: { x0: number; x1: number; y0: number; y1: number; z1: number },
  hit: boolean,
  grow: number
): void {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const r = (box.x1 - box.x0) * 0.22 * Math.max(0.2, grow);
  const centre = scene.project(cx, cy, box.z1 + r);
  const rr = Math.max(2, r * scene.scale(cy));
  const base = hit ? GOLD : shade(BOARD.bg, 0.3);

  if (hit) {
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, rr * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = alpha(GOLD, 0.16);
    ctx.fill();
  }

  const gradient = ctx.createRadialGradient(
    centre.x - rr * 0.35,
    centre.y - rr * 0.4,
    rr * 0.1,
    centre.x,
    centre.y,
    rr
  );
  gradient.addColorStop(0, shade(base, 0.5));
  gradient.addColorStop(0.55, base);
  gradient.addColorStop(1, shade(base, -0.5));
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, rr, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Spikes, so a mine is still a mine without colour.
  ctx.strokeStyle = hit ? shade(GOLD, -0.2) : shade(BOARD.neutralLit, 0.2);
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(centre.x + Math.cos(angle) * rr * 0.9, centre.y + Math.sin(angle) * rr * 0.9);
    ctx.lineTo(centre.x + Math.cos(angle) * rr * 1.5, centre.y + Math.sin(angle) * rr * 1.5);
    ctx.stroke();
  }
}

export default MinesCanvas;
