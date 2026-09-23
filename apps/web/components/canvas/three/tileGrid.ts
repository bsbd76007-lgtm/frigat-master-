/**
 * A grid of tiles lying on the board floor.
 *
 * Mines and Keno are the same object with different labels on it, so the
 * geometry and — more importantly — the hit test live here once. Getting a
 * click back to a tile is the part a pseudo-3D board gets wrong: the tiles are
 * projected quads, not CSS boxes, so a rectangle test against the grid's
 * bounding box picks the wrong tile everywhere except the focus row.
 *
 * Rows are indexed far to near and columns left to right, so tile 0 is the far
 * left one — the same order the server's tile indices are in.
 */

import type { Scene, ScreenPoint } from './scene';
import type { Box } from './solids';

export interface TileGridSpec {
  columns: number;
  rows: number;
  /** The floor rectangle the grid is laid out inside, in world space. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Gap between tiles, as a fraction of a cell. */
  gap?: number;
  /** Tile thickness, in world pixels. */
  thickness?: number;
}

export interface TileGrid {
  count: number;
  columns: number;
  rows: number;
  /** The solid for a tile, optionally lifted off the floor and re-thickened. */
  boxOf(index: number, options?: { lift?: number; thickness?: number }): Box;
  /** World centre of a tile's top face. */
  centreOf(index: number): { x: number; y: number };
  /** The tile under a canvas point, or null. Nearer tiles win. */
  indexAt(point: ScreenPoint): number | null;
  /** Row of a tile, 0 at the far edge — reveal order, stagger, depth sorting. */
  rowOf(index: number): number;
  /** Tiles far to near, the order they must be drawn in. */
  drawOrder(): number[];
}

export function makeTileGrid(scene: Scene, spec: TileGridSpec): TileGrid {
  const { columns, rows, x0, x1, y0, y1, gap = 0.12, thickness = 14 } = spec;
  const count = columns * rows;
  const cellW = (x1 - x0) / columns;
  const cellD = (y1 - y0) / rows;
  const padX = (cellW * gap) / 2;
  const padY = (cellD * gap) / 2;

  const boxOf = (index: number, options: { lift?: number; thickness?: number } = {}): Box => {
    const { lift = 0, thickness: th = thickness } = options;
    const col = index % columns;
    const row = Math.floor(index / columns);
    return {
      x0: x0 + col * cellW + padX,
      x1: x0 + (col + 1) * cellW - padX,
      y0: y0 + row * cellD + padY,
      y1: y0 + (row + 1) * cellD - padY,
      z0: lift,
      z1: lift + th,
    };
  };

  const centreOf = (index: number) => {
    const b = boxOf(index);
    return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
  };

  const indexAt = (point: ScreenPoint): number | null => {
    // Near rows first: a raised tile in front can cover the one behind it.
    for (let row = rows - 1; row >= 0; row -= 1) {
      for (let col = 0; col < columns; col += 1) {
        const index = row * columns + col;
        const b = boxOf(index);
        const quad = [
          scene.project(b.x0, b.y0, b.z1),
          scene.project(b.x1, b.y0, b.z1),
          scene.project(b.x1, b.y1, b.z1),
          scene.project(b.x0, b.y1, b.z1),
        ];
        if (insideQuad(point, quad)) return index;
      }
    }
    return null;
  };

  const drawOrder = () => Array.from({ length: count }, (_, i) => i);

  return {
    count,
    columns,
    rows,
    boxOf,
    centreOf,
    indexAt,
    rowOf: (index) => Math.floor(index / columns),
    drawOrder,
  };
}

/** Winding test against a convex quad — every projected tile top is convex. */
function insideQuad(p: ScreenPoint, quad: readonly ScreenPoint[]): boolean {
  let sign = 0;
  for (let i = 0; i < quad.length; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % quad.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross === 0) continue;
    const next = cross > 0 ? 1 : -1;
    if (sign === 0) sign = next;
    else if (sign !== next) return false;
  }
  return true;
}
