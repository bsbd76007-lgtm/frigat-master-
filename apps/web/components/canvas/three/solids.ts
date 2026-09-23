/**
 * Solids — what the boards are actually built out of.
 *
 * Every shape here is drawn through a `Scene` projection, so a box on one board
 * and a box on another agree about where the camera and the light are. Only the
 * faces turned toward the camera are drawn, back to front, which is why none of
 * this needs a depth buffer.
 *
 * Pure: no DOM beyond the 2D context, no React, and nothing that decides an
 * outcome. A board passes in a result the server already settled.
 */

import type { Scene, ScreenPoint } from './scene';

// ─────────────────────────────────────────────
// Colour
// ─────────────────────────────────────────────

/** Lightens (f > 0) or darkens (f < 0) a #rgb or #rrggbb colour. */
export function shade(hex: string, f: number): string {
  const { r, g, b } = parseHex(hex);
  const mix = (c: number) => Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f));
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

/** The same colour at an alpha — for glows, washes and shadows. */
export function alpha(hex: string, a: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Blends two #rgb or #rrggbb colours, `f` of the way from `a` to `b`. */
export function mixHex(a: string, b: string, f: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  const at = (p: number, q: number) => Math.round(p + (q - p) * f);
  return `rgb(${at(x.r, y.r)},${at(x.g, y.g)},${at(x.b, y.b)})`;
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  let body = hex.trim().replace('#', '');
  if (body.length === 3) {
    body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
  }
  const n = parseInt(body, 16);
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// ─────────────────────────────────────────────
// Boxes
// ─────────────────────────────────────────────

/** An axis-aligned box in world space. */
export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

export interface FaceColours {
  top: string;
  front: string;
  left: string;
  right: string;
}

export type BoxFace = 'top' | 'front' | 'left' | 'right';

/**
 * The four face colours of a solid in one base colour. The light is out to the
 * left, so the left flank is the lit one and the right flank is the darkest
 * thing on the solid — the cue that reads as "lit from somewhere" rather than
 * "shaded arbitrarily", and it has to be the same on every board or two solids
 * side by side look like they are in different rooms.
 */
export function faces(base: string, overrides: Partial<FaceColours> = {}): FaceColours {
  return {
    top: shade(base, 0.2),
    front: base,
    left: shade(base, 0.07),
    right: shade(base, -0.3),
    ...overrides,
  };
}

export function poly(
  ctx: CanvasRenderingContext2D,
  points: readonly ScreenPoint[],
  fill: string | CanvasGradient
): void {
  if (points.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * An extruded box: the top, the near face, and whichever flank faces the
 * vanishing line, drawn back to front.
 */
export function drawBox(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  b: Box,
  colours: FaceColours
): void {
  const P = scene.project;
  if (b.x0 > scene.vanishX) {
    poly(ctx, [P(b.x0, b.y0, b.z0), P(b.x0, b.y1, b.z0), P(b.x0, b.y1, b.z1), P(b.x0, b.y0, b.z1)], colours.left);
  }
  if (b.x1 < scene.vanishX) {
    poly(ctx, [P(b.x1, b.y0, b.z0), P(b.x1, b.y1, b.z0), P(b.x1, b.y1, b.z1), P(b.x1, b.y0, b.z1)], colours.right);
  }
  poly(ctx, [P(b.x0, b.y1, b.z0), P(b.x1, b.y1, b.z0), P(b.x1, b.y1, b.z1), P(b.x0, b.y1, b.z1)], colours.front);
  poly(ctx, [P(b.x0, b.y0, b.z1), P(b.x1, b.y0, b.z1), P(b.x1, b.y1, b.z1), P(b.x0, b.y1, b.z1)], colours.top);
}

/** A quad lying on one face of a box, inset by fractions — labels, insets, trim. */
export function faceQuad(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  face: Exclude<BoxFace, 'top'> | 'top',
  b: Box,
  [a0, a1]: readonly [number, number],
  [c0, c1]: readonly [number, number],
  fill: string | CanvasGradient
): void {
  const P = scene.project;
  if (face === 'top') {
    const x = (a: number) => b.x0 + (b.x1 - b.x0) * a;
    const y = (c: number) => b.y0 + (b.y1 - b.y0) * c;
    poly(ctx, [P(x(a0), y(c0), b.z1), P(x(a1), y(c0), b.z1), P(x(a1), y(c1), b.z1), P(x(a0), y(c1), b.z1)], fill);
    return;
  }
  const z = (c: number) => b.z0 + (b.z1 - b.z0) * c;
  if (face === 'front') {
    const x = (a: number) => b.x0 + (b.x1 - b.x0) * a;
    poly(ctx, [P(x(a0), b.y1, z(c0)), P(x(a1), b.y1, z(c0)), P(x(a1), b.y1, z(c1)), P(x(a0), b.y1, z(c1))], fill);
    return;
  }
  const flank = face === 'left' ? b.x0 : b.x1;
  if (face === 'left' ? flank <= scene.vanishX : flank >= scene.vanishX) return;
  const y = (a: number) => b.y0 + (b.y1 - b.y0) * a;
  poly(ctx, [P(flank, y(a0), z(c0)), P(flank, y(a1), z(c0)), P(flank, y(a1), z(c1)), P(flank, y(a0), z(c1))], fill);
}

/**
 * Ground shadow of a box: the hull of its footprint and of its top face cast
 * through the light. Two passes — a wide faint one and the core — stand in for
 * a soft edge without a blur filter, which not every canvas supports.
 */
export function drawBoxShadow(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  b: Box,
  strength = 1
): void {
  const corners: Array<{ x: number; y: number }> = [];
  for (const x of [b.x0, b.x1]) {
    for (const y of [b.y0, b.y1]) {
      corners.push({ x, y });
      corners.push(scene.shadowOf(x, y, b.z1));
    }
  }
  const outline = hull(corners);
  if (outline.length < 3) return;
  const cx = outline.reduce((s, p) => s + p.x, 0) / outline.length;
  const cy = outline.reduce((s, p) => s + p.y, 0) / outline.length;
  const grow = (k: number) =>
    outline.map((p) => scene.project(cx + (p.x - cx) * k, cy + (p.y - cy) * k));
  poly(ctx, grow(1.12), `rgba(6,6,9,${0.1 * strength})`);
  poly(ctx, grow(0.96), `rgba(6,6,9,${0.24 * strength})`);
}

/** Convex hull (monotone chain) — the outline of a shadow from its corners. */
function hull<T extends { x: number; y: number }>(points: readonly T[]): T[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: T, a: T, b: T) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: T[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: T[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// ─────────────────────────────────────────────
// Text on a face
// ─────────────────────────────────────────────

export interface FaceTextOptions {
  fill: string;
  /** Font size in screen pixels at the face, before foreshortening. */
  size: number;
  weight?: number | string;
  family?: string;
  /** Nudge, as a fraction of the face, from its centre. */
  offset?: readonly [number, number];
  maxWidthFraction?: number;
}

/**
 * Text lying on a face of a box, sheared into the face's plane.
 *
 * A projected face is a general quad and canvas transforms are affine, so the
 * face is approximated by the parallelogram through three of its corners. Over
 * a tile-sized face the error is well under a pixel, and the alternative — flat
 * text floating over a tilted tile — is the thing that makes a pseudo-3D board
 * look like a sticker sheet.
 */
export function drawFaceText(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  b: Box,
  face: BoxFace,
  text: string,
  options: FaceTextOptions
): void {
  const { fill, size, weight = 700, family, offset = [0, 0], maxWidthFraction = 0.86 } = options;

  let origin: ScreenPoint;
  let acrossEnd: ScreenPoint;
  let downEnd: ScreenPoint;
  const P = scene.project;

  if (face === 'top') {
    origin = P(b.x0, b.y0, b.z1);
    acrossEnd = P(b.x1, b.y0, b.z1);
    downEnd = P(b.x0, b.y1, b.z1);
  } else if (face === 'front') {
    origin = P(b.x0, b.y1, b.z1);
    acrossEnd = P(b.x1, b.y1, b.z1);
    downEnd = P(b.x0, b.y1, b.z0);
  } else {
    const flank = face === 'left' ? b.x0 : b.x1;
    if (face === 'left' ? flank <= scene.vanishX : flank >= scene.vanishX) return;
    origin = P(flank, b.y0, b.z1);
    acrossEnd = P(flank, b.y1, b.z1);
    downEnd = P(flank, b.y0, b.z0);
  }

  const ax = acrossEnd.x - origin.x;
  const ay = acrossEnd.y - origin.y;
  const dx = downEnd.x - origin.x;
  const dy = downEnd.y - origin.y;
  const across = Math.hypot(ax, ay);
  const down = Math.hypot(dx, dy);
  if (across < 1 || down < 1) return;

  ctx.save();
  ctx.transform(ax / across, ay / across, dx / down, dy / down, origin.x, origin.y);
  ctx.fillStyle = fill;
  ctx.font = `${weight} ${size}px ${family ?? 'inherit'}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    text,
    across * (0.5 + offset[0]),
    down * (0.5 + offset[1]),
    across * maxWidthFraction
  );
  ctx.restore();
}

// ─────────────────────────────────────────────
// Round solids
// ─────────────────────────────────────────────

export interface FloorEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/**
 * How a circle of world radius `r` on the floor at (x, y) draws. Measured
 * rather than derived: the depth radius is read off the projection itself, so
 * it stays correct whatever the scene's stretch and distances are.
 */
export function floorEllipse(scene: Scene, x: number, y: number, r: number, z = 0): FloorEllipse {
  const centre = scene.project(x, y, z);
  const side = scene.project(x + r, y, z);
  const depth = scene.project(x, y + r / scene.depthPx, z);
  return {
    cx: centre.x,
    cy: centre.y,
    rx: Math.abs(side.x - centre.x),
    ry: Math.max(0.6, Math.abs(depth.y - centre.y)),
  };
}

/** A soft blob under a round thing, for solids whose hull shadow is overkill. */
export function drawFloorShadow(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  x: number,
  y: number,
  r: number,
  z = 0,
  strength = 1
): void {
  const cast = scene.shadowOf(x, y, z);
  const e = floorEllipse(scene, cast.x, cast.y, r);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(e.cx, e.cy, e.rx * 1.25, e.ry * 1.25, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(6,6,9,${0.12 * strength})`;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(e.cx, e.cy, e.rx * 0.9, e.ry * 0.9, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(6,6,9,${0.26 * strength})`;
  ctx.fill();
  ctx.restore();
}

/** An upright cylinder — a peg, a chip stack, a coin on edge. */
export function drawCylinder(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  x: number,
  y: number,
  r: number,
  z0: number,
  z1: number,
  base: string
): void {
  const bottom = floorEllipse(scene, x, y, r, z0);
  const top = floorEllipse(scene, x, y, r, z1);

  const skirt = ctx.createLinearGradient(bottom.cx - bottom.rx, 0, bottom.cx + bottom.rx, 0);
  skirt.addColorStop(0, shade(base, 0.1));
  skirt.addColorStop(0.45, base);
  skirt.addColorStop(1, shade(base, -0.34));

  // The skirt is the band between the two ellipses' front halves: across the
  // bottom rim right to left, up the left side, back across the top rim.
  ctx.beginPath();
  ctx.ellipse(bottom.cx, bottom.cy, bottom.rx, bottom.ry, 0, 0, Math.PI);
  ctx.lineTo(top.cx - top.rx, top.cy);
  ctx.ellipse(top.cx, top.cy, top.rx, top.ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fillStyle = skirt;
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(top.cx, top.cy, top.rx, top.ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = shade(base, 0.22);
  ctx.fill();
}

/** A lit sphere — a ball, a bead, a pip. */
export function drawSphere(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  x: number,
  y: number,
  z: number,
  r: number,
  base: string
): void {
  const centre = scene.project(x, y, z);
  const rr = Math.max(1, r * scene.scale(y));
  const gradient = ctx.createRadialGradient(
    centre.x - rr * 0.35,
    centre.y - rr * 0.4,
    rr * 0.1,
    centre.x,
    centre.y,
    rr
  );
  gradient.addColorStop(0, shade(base, 0.55));
  gradient.addColorStop(0.5, base);
  gradient.addColorStop(1, shade(base, -0.4));
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, rr, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
}

// ─────────────────────────────────────────────
// Floor
// ─────────────────────────────────────────────

/** A rectangle of floor, in world space. */
export function drawFloorQuad(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  fill: string | CanvasGradient,
  z = 0
): void {
  const P = scene.project;
  poly(ctx, [P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)], fill);
}
