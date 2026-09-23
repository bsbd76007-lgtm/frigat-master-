/**
 * The chrome every board shares: the ground it sits on and the light above it.
 *
 * Drawn first, so a board's own solids land on a consistent stage. Keeping this
 * out of the individual boards is what makes five different games read as one
 * table rather than five screens that each guessed at a background.
 */

import type { Scene } from './scene';
import { BOARD, ACCENT } from './palette';
import { drawFloorQuad } from './solids';

export interface BackdropOptions {
  /** World x the floor spans. Defaults to the full stage, generously overhung. */
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
  /** Tint the glow under the board — a win or a bust colours the whole table. */
  glow?: string;
  glowStrength?: number;
  /** Grid lines across the floor; 0 draws none. */
  gridRows?: number;
  gridCols?: number;
}

export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  options: BackdropOptions = {}
): void {
  const {
    x0 = -scene.width,
    x1 = scene.width * 2,
    y0 = 0,
    y1 = 1,
    glow = ACCENT,
    glowStrength = 0.1,
    gridRows = 0,
    gridCols = 0,
  } = options;

  // The page behind the board. Vertical, not radial: the board's own glow is
  // the only thing allowed to draw the eye to a point.
  const sky = ctx.createLinearGradient(0, 0, 0, scene.height);
  sky.addColorStop(0, BOARD.bg);
  sky.addColorStop(1, '#0a0a0c');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, scene.width, scene.height);

  // The floor, brighter at the far edge where the light is.
  const far = scene.project((x0 + x1) / 2, y0).y;
  const near = scene.project((x0 + x1) / 2, y1).y;
  const floor = ctx.createLinearGradient(0, far, 0, near);
  floor.addColorStop(0, BOARD.floor);
  floor.addColorStop(1, BOARD.floorDeep);
  drawFloorQuad(ctx, scene, x0, x1, y0, y1, floor);

  if (glowStrength > 0) {
    const centre = scene.project(scene.vanishX, y0 + (y1 - y0) * 0.35);
    const radius = Math.max(scene.width, scene.height) * 0.6;
    const halo = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, radius);
    halo.addColorStop(0, withAlpha(glow, glowStrength));
    halo.addColorStop(1, withAlpha(glow, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, scene.width, scene.height);
  }

  if (gridCols > 0 || gridRows > 0) {
    ctx.strokeStyle = BOARD.line;
    ctx.lineWidth = 1;
    for (let i = 1; i < gridCols; i += 1) {
      const x = x0 + ((x1 - x0) * i) / gridCols;
      const a = scene.project(x, y0);
      const b = scene.project(x, y1);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (let i = 1; i < gridRows; i += 1) {
      const y = y0 + ((y1 - y0) * i) / gridRows;
      const a = scene.project(x0, y);
      const b = scene.project(x1, y);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
}

/** Darkens the corners, so the board's own light is the brightest thing. */
export function drawVignette(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const gradient = ctx.createRadialGradient(
    scene.width / 2,
    scene.height * 0.52,
    Math.min(scene.width, scene.height) * 0.3,
    scene.width / 2,
    scene.height * 0.52,
    Math.max(scene.width, scene.height) * 0.78
  );
  gradient.addColorStop(0, 'rgba(5,5,6,0)');
  gradient.addColorStop(1, 'rgba(5,5,6,.55)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, scene.width, scene.height);
}

function withAlpha(hex: string, a: number): string {
  const body = hex.replace('#', '');
  const n = parseInt(body.length === 3 ? body.replace(/(.)/g, '$1$1') : body, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
