/**
 * Chicken Road — canvas drawing.
 *
 * Pure rendering: every function here takes a context, a `View` (the camera,
 * see view.ts) and world coordinates, and draws. None of them decide anything
 * about the round, which is what keeps the outcome logic in one place and this
 * file safe to tune by eye.
 *
 * The scene is pseudo-3D: the road is a plane seen in perspective, cars and
 * barriers are extruded boxes standing on it, and every object casts a shadow
 * from the one point light in `view.ts`. Faces are shaded by which way they
 * point relative to that light, so the lighting and the shadows agree.
 */

import type { KeyedSprite } from '@/lib/spriteMask';

import type { View } from './view';

export function randomCarColour(): CarColour {
  return CAR_COLOURS[Math.floor(Math.random() * CAR_COLOURS.length)] ?? CAR_COLOURS[0];
}

// ─────────────────────────────────────────────
// Sizes and palette
// ─────────────────────────────────────────────

/**
 * Both grids are sized in abstract units and scaled at draw time. The car's
 * `len` runs *along* its lane and `width` across it; `body` and `cabin` are its
 * heights, so a car is a box on a box.
 */
export const CAR_UNITS = { len: 8, width: 5, body: 2.1, cabin: 1.7 } as const;
export const CHICKEN_UNITS = { w: 8, h: 7 } as const;

export const CAR_COLOURS = [
  { shell: '#e5484d', deep: '#a01f25', roof: '#f2686c' },
  { shell: '#3b82f6', deep: '#1d4ed8', roof: '#60a5fa' },
  { shell: '#e0b055', deep: '#b45309', roof: '#fbbf24' },
  { shell: '#4e9e7a', deep: '#15803d', roof: '#6fc59c' },
  { shell: '#e2e8f0', deep: '#94a3b8', roof: '#f8fafc' },
] as const;

export type CarColour = (typeof CAR_COLOURS)[number];

/** Lightens (f > 0) or darkens (f < 0) a #rrggbb colour. */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) =>
    Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `rgb(${r},${g},${b})`;
}

// ─────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────

type Pt = { x: number; y: number };

function poly(ctx: CanvasRenderingContext2D, pts: readonly Pt[], fill: string | CanvasGradient) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Convex hull (monotone chain) — the outline of a shadow from its corners. */
function hull(points: Array<{ u: number; t: number }>): Array<{ u: number; t: number }> {
  const pts = [...points].sort((a, b) => a.u - b.u || a.t - b.t);
  const cross = (o: typeof pts[0], a: typeof pts[0], b: typeof pts[0]) =>
    (a.u - o.u) * (b.t - o.t) - (a.t - o.t) * (b.u - o.u);
  const lower: typeof pts = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: typeof pts = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

interface Box {
  u0: number;
  u1: number;
  t0: number;
  t1: number;
  h0: number;
  h1: number;
}

/**
 * Ground shadow of a box: the hull of its footprint and of its top face cast
 * through the light. Two passes — a wide faint one and the core — stand in for
 * a soft edge without a blur filter, which not every canvas supports.
 */
export function drawBoxShadow(ctx: CanvasRenderingContext2D, v: View, b: Box, strength = 1) {
  const corners: Array<{ u: number; t: number }> = [];
  for (const u of [b.u0, b.u1]) {
    for (const t of [b.t0, b.t1]) {
      corners.push({ u, t });
      corners.push(v.shadowOf(u, t, b.h1));
    }
  }
  const outline = hull(corners);
  const cu = outline.reduce((s, p) => s + p.u, 0) / outline.length;
  const ct = outline.reduce((s, p) => s + p.t, 0) / outline.length;
  /** The outline scaled about its centre — the faint pass is a size up. */
  const grow = (k: number) =>
    outline.map((p) => v.project(cu + (p.u - cu) * k, ct + (p.t - ct) * k));
  poly(ctx, grow(1.1), `rgba(10,14,22,${0.1 * strength})`);
  poly(ctx, grow(0.96), `rgba(10,14,22,${0.22 * strength})`);
}

/**
 * An extruded box. Only faces turned toward the camera are drawn — the top,
 * the near face, and whichever flank faces the vanishing line — in back-to-front
 * order, so no depth buffer is needed. `left` is the lit flank: the light is out
 * to the left of the road.
 */
function drawBox(
  ctx: CanvasRenderingContext2D,
  v: View,
  b: Box,
  colours: { top: string; front: string; left: string; right: string }
) {
  const P = (u: number, t: number, h: number) => v.project(u, t, h);
  if (b.u0 > v.vanishX) {
    poly(ctx, [P(b.u0, b.t0, b.h0), P(b.u0, b.t1, b.h0), P(b.u0, b.t1, b.h1), P(b.u0, b.t0, b.h1)], colours.left);
  }
  if (b.u1 < v.vanishX) {
    poly(ctx, [P(b.u1, b.t0, b.h0), P(b.u1, b.t1, b.h0), P(b.u1, b.t1, b.h1), P(b.u1, b.t0, b.h1)], colours.right);
  }
  poly(ctx, [P(b.u0, b.t1, b.h0), P(b.u1, b.t1, b.h0), P(b.u1, b.t1, b.h1), P(b.u0, b.t1, b.h1)], colours.front);
  poly(ctx, [P(b.u0, b.t0, b.h1), P(b.u1, b.t0, b.h1), P(b.u1, b.t1, b.h1), P(b.u0, b.t1, b.h1)], colours.top);
}

/** A quad lying on one face of a box, inset by fractions — windows, lamps. */
function faceQuad(
  ctx: CanvasRenderingContext2D,
  v: View,
  face: 'front' | 'left' | 'right',
  b: Box,
  [a0, a1]: readonly [number, number],
  [z0, z1]: readonly [number, number],
  fill: string
) {
  const h = (z: number) => b.h0 + (b.h1 - b.h0) * z;
  if (face === 'front') {
    const u = (a: number) => b.u0 + (b.u1 - b.u0) * a;
    poly(ctx, [v.project(u(a0), b.t1, h(z0)), v.project(u(a1), b.t1, h(z0)), v.project(u(a1), b.t1, h(z1)), v.project(u(a0), b.t1, h(z1))], fill);
    return;
  }
  const uu = face === 'left' ? b.u0 : b.u1;
  if (face === 'left' ? uu <= v.vanishX : uu >= v.vanishX) return;
  const t = (a: number) => b.t0 + (b.t1 - b.t0) * a;
  poly(ctx, [v.project(uu, t(a0), h(z0)), v.project(uu, t(a1), h(z0)), v.project(uu, t(a1), h(z1)), v.project(uu, t(a0), h(z1))], fill);
}

// ─────────────────────────────────────────────
// Cars
// ─────────────────────────────────────────────

/** A car's two boxes, from its lane centre `u`, row `t` and sprite scale. */
export function carBoxes(u: number, t: number, scale: number, depthPx: number) {
  const halfW = (CAR_UNITS.width * scale) / 2;
  const halfL = (CAR_UNITS.len * scale) / depthPx / 2;
  const bodyH = CAR_UNITS.body * scale;
  const body: Box = { u0: u - halfW, u1: u + halfW, t0: t - halfL, t1: t + halfL, h0: scale * 0.55, h1: bodyH };
  const cabin: Box = {
    u0: u - halfW * 0.8,
    u1: u + halfW * 0.8,
    t0: t - halfL * 0.62,
    t1: t + halfL * 0.2,
    h0: bodyH,
    h1: bodyH + CAR_UNITS.cabin * scale,
  };
  return { body, cabin };
}

export function drawCarShadow(ctx: CanvasRenderingContext2D, v: View, u: number, t: number, scale: number) {
  const { body, cabin } = carBoxes(u, t, scale, v.depthPx);
  drawBoxShadow(ctx, v, { ...body, h1: cabin.h1 * 0.92 }, 0.8);
}

/**
 * A car driving down its lane toward the camera: a body box on four wheels,
 * a glasshouse set back on top, lamps on the nose.
 */
export function drawCar3D(
  ctx: CanvasRenderingContext2D,
  v: View,
  u: number,
  t: number,
  scale: number,
  colour: CarColour
) {
  const { body, cabin } = carBoxes(u, t, scale, v.depthPx);

  // Wheels first: four dark blocks under the body, only their outer faces and
  // the front pair's tread ever show.
  const wheelW = scale * 0.75;
  const wheelL = (scale * 1.6) / v.depthPx;
  for (const wt of [body.t0 + (body.t1 - body.t0) * 0.2, body.t1 - (body.t1 - body.t0) * 0.2]) {
    for (const wu of [body.u0 - wheelW * 0.15, body.u1 - wheelW * 0.85]) {
      drawBox(ctx, v, { u0: wu, u1: wu + wheelW, t0: wt - wheelL / 2, t1: wt + wheelL / 2, h0: 0, h1: scale * 1.15 }, {
        top: '#1f2530',
        front: '#12161f',
        left: '#1a1f29',
        right: '#0d1017',
      });
    }
  }

  drawBox(ctx, v, body, {
    top: colour.roof,
    front: colour.shell,
    left: shade(colour.shell, 0.08),
    right: colour.deep,
  });

  // Nose: grille band, then the two headlamps either side of it.
  faceQuad(ctx, v, 'front', body, [0.3, 0.7], [0.18, 0.5], 'rgba(15,20,30,.7)');
  for (const [a0, a1] of [[0.06, 0.26], [0.74, 0.94]] as const) {
    faceQuad(ctx, v, 'front', body, [a0, a1], [0.38, 0.72], '#fff4c2');
  }
  // Bumper, a darker strip along the bottom of the nose.
  faceQuad(ctx, v, 'front', body, [0, 1], [0, 0.16], shade(colour.deep, -0.35));
  // Door line down the visible flank.
  for (const face of ['left', 'right'] as const) {
    faceQuad(ctx, v, face, body, [0.46, 0.475], [0.15, 0.95], 'rgba(0,0,0,.25)');
  }

  drawBox(ctx, v, cabin, {
    top: shade(colour.roof, 0.12),
    front: '#223047',
    left: shade(colour.shell, 0.02),
    right: shade(colour.deep, -0.1),
  });
  // Glass: windscreen across the near face, side windows along the flanks.
  faceQuad(ctx, v, 'front', cabin, [0.08, 0.92], [0.08, 0.88], 'rgba(148,190,230,.55)');
  for (const face of ['left', 'right'] as const) {
    faceQuad(ctx, v, face, cabin, [0.12, 0.88], [0.15, 0.85], 'rgba(30,45,70,.78)');
  }
  // A glint on the roof, where the light catches it.
  const g0 = v.project(cabin.u0 + (cabin.u1 - cabin.u0) * 0.15, cabin.t0 + (cabin.t1 - cabin.t0) * 0.3, cabin.h1);
  const g1 = v.project(cabin.u0 + (cabin.u1 - cabin.u0) * 0.45, cabin.t0 + (cabin.t1 - cabin.t0) * 0.3, cabin.h1);
  const g2 = v.project(cabin.u0 + (cabin.u1 - cabin.u0) * 0.35, cabin.t0 + (cabin.t1 - cabin.t0) * 0.7, cabin.h1);
  poly(ctx, [g0, g1, g2], 'rgba(255,255,255,.22)');
}

// ─────────────────────────────────────────────
// Road
// ─────────────────────────────────────────────

export interface RoadSpec {
  /** First lane of asphalt; lane 0 is the grass verge the chicken starts on. */
  firstLane: number;
  /** Last lane of the road; the finish verge begins after it. */
  lastLane: number;
}

/** Ground, asphalt, kerb, lane markings and the finish strip. */
export function drawRoad(ctx: CanvasRenderingContext2D, v: View, road: RoadSpec) {
  const { width, height } = v;
  const top = v.project(0, 0).y;

  // Grass everywhere first, hazier with distance.
  const grass = ctx.createLinearGradient(0, top, 0, height);
  grass.addColorStop(0, '#a3c48c');
  grass.addColorStop(1, '#5a8c45');
  ctx.fillStyle = grass;
  ctx.fillRect(0, 0, width, height);

  const roadL = v.laneLeft(road.firstLane);
  const roadR = v.laneLeft(road.lastLane + 1);
  const far = -0.15;
  const near = 1.2;
  const corners = [v.project(roadL, far), v.project(roadR, far), v.project(roadR, near), v.project(roadL, near)];
  const asphalt = ctx.createLinearGradient(0, top, 0, height);
  asphalt.addColorStop(0, '#7b8491');
  asphalt.addColorStop(0.45, '#4a515d');
  asphalt.addColorStop(1, '#2c323c');
  poly(ctx, corners, asphalt);

  // Every other lane a shade lighter: in perspective the dashes alone thin to
  // nothing at the far end, and the banding keeps the lanes countable.
  for (let lane = road.firstLane; lane <= road.lastLane; lane += 2) {
    const l0 = v.laneLeft(lane);
    const l1 = l0 + v.laneW;
    poly(ctx, [v.project(l0, far), v.project(l1, far), v.project(l1, near), v.project(l0, near)], 'rgba(255,255,255,.035)');
  }

  // Lane dividers: dashes laid on the asphalt, so they foreshorten with it.
  const lineW = Math.max(2, v.laneW * 0.022);
  for (let lane = road.firstLane + 1; lane <= road.lastLane; lane += 1) {
    const u = v.laneLeft(lane);
    for (let t = -0.1; t < 1.15; t += 0.1) {
      const t1 = t + 0.055;
      poly(
        ctx,
        [v.project(u - lineW / 2, t), v.project(u + lineW / 2, t), v.project(u + lineW / 2, t1), v.project(u - lineW / 2, t1)],
        'rgba(255,255,255,.82)'
      );
    }
  }

  // Kerbs: a raised concrete lip along both edges of the asphalt, with the
  // yellow edge line painted along its top.
  const kerbW = v.laneW * 0.08;
  const kerbH = Math.max(4, v.laneW * 0.05);
  for (const [u0, u1] of [[roadL - kerbW, roadL], [roadR, roadR + kerbW]] as const) {
    drawBox(ctx, v, { u0, u1, t0: far, t1: near, h0: 0, h1: kerbH }, {
      top: '#c9ced6',
      front: '#9aa1ab',
      left: '#b5bbc4',
      right: '#8b929c',
    });
    const mid = (u0 + u1) / 2;
    poly(
      ctx,
      [v.project(mid - kerbW * 0.22, far, kerbH), v.project(mid + kerbW * 0.22, far, kerbH), v.project(mid + kerbW * 0.22, near, kerbH), v.project(mid - kerbW * 0.22, near, kerbH)],
      '#e0b055'
    );
  }

  // Finish strip on the far verge: a chequer laid on the grass past the kerb.
  const f0 = roadR + kerbW * 1.6;
  const cellU = v.laneW * 0.16;
  const cellT = 0.06;
  for (let col = 0; col < 2; col += 1) {
    for (let row = 0; row * cellT < 1.2; row += 1) {
      const u0 = f0 + col * cellU;
      const t0 = -0.1 + row * cellT;
      poly(
        ctx,
        [v.project(u0, t0), v.project(u0 + cellU, t0), v.project(u0 + cellU, t0 + cellT), v.project(u0, t0 + cellT)],
        (col + row) % 2 === 0 ? '#f8fafc' : '#111827'
      );
    }
  }
}

/**
 * Atmosphere, painted last: haze thickening toward the far end, and a soft
 * vignette. The haze is what makes the far lanes read as *far* rather than
 * as small, and it swallows cars as they spawn so none pops in.
 */
export function drawAtmosphere(ctx: CanvasRenderingContext2D, v: View) {
  const { width, height } = v;
  const fogEnd = v.project(0, 0.32).y;
  const fog = ctx.createLinearGradient(0, 0, 0, fogEnd);
  fog.addColorStop(0, 'rgba(206,222,236,.92)');
  fog.addColorStop(0.35, 'rgba(206,222,236,.45)');
  fog.addColorStop(1, 'rgba(206,222,236,0)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, width, fogEnd);

  const vignette = ctx.createRadialGradient(width / 2, height * 0.55, height * 0.35, width / 2, height * 0.55, width * 0.75);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,.28)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

// ─────────────────────────────────────────────
// Manhole covers — the multiplier ladder
// ─────────────────────────────────────────────

export type CoverState = 'ahead' | 'next' | 'stand' | 'cleared';

/**
 * A cast-iron cover set into the asphalt at the chicken's row, carrying the
 * lane's multiplier and the odds of getting there. The disc lies on the road
 * and foreshortens with it; the numbers stand up off it, facing the camera,
 * because text laid flat at this angle would be unreadable.
 */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  v: View,
  u: number,
  t: number,
  radius: number,
  state: CoverState,
  multiplier: string,
  chance: string,
  timeSeconds: number,
  /** Below the unlock lane: it counts toward the ladder but cannot be banked. */
  locked = false
) {
  const ring = (r: number) => {
    const pts: Pt[] = [];
    for (let i = 0; i < 36; i += 1) {
      const a = (i / 36) * Math.PI * 2;
      pts.push(v.project(u + Math.cos(a) * r, t + (Math.sin(a) * r) / v.depthPx));
    }
    return pts;
  };

  ctx.save();
  if (state === 'cleared') ctx.globalAlpha = 0.55;

  if (state === 'next') {
    // The lane in play glows, breathing, so the eye finds it without reading.
    const pulse = 0.55 + 0.45 * Math.sin(timeSeconds * 4);
    poly(ctx, ring(radius * 1.32), `rgba(250,204,21,${0.22 + 0.2 * pulse})`);
  }

  // Recess, rim and face: three rings, dark to light, for a cast edge.
  poly(ctx, ring(radius * 1.06), 'rgba(8,12,18,.55)');
  poly(ctx, ring(radius), state === 'next' ? '#b8913a' : '#5c6773');
  poly(ctx, ring(radius * 0.8), state === 'cleared' ? '#3f5a4a' : '#3b4450');
  // Tread: a cross-hatch of short bars on the face.
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  ctx.lineWidth = Math.max(1, radius * 0.05 * v.scale(t));
  for (let i = -2; i <= 2; i += 1) {
    const a = v.project(u + i * radius * 0.28, t - (radius * 0.55) / v.depthPx);
    const b = v.project(u + i * radius * 0.28, t + (radius * 0.55) / v.depthPx);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  // Bolt heads around the rim.
  ctx.fillStyle = 'rgba(210,218,228,.7)';
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const p = v.project(u + Math.cos(a) * radius * 0.9, t + (Math.sin(a) * radius * 0.9) / v.depthPx);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1, radius * 0.05 * v.scale(t)), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * A cover's multiplier and win chance.
 *
 * Split out of `drawCover` so it can be drawn in the board's crisp overlay
 * pass. The board renders its world at a quarter resolution for the pixel look,
 * and a 12px label resolved into that buffer comes back as three pixels of
 * mush — the ladder is the one thing on this board a player has to read exactly.
 */
export function drawCoverLabels(
  ctx: CanvasRenderingContext2D,
  v: View,
  u: number,
  t: number,
  radius: number,
  state: CoverState,
  multiplier: string,
  chance: string,
  locked = false
) {
  // The chicken stands on its own cover and hides it; everything else labels.
  if (state === 'stand') return;

  ctx.save();
  if (state === 'cleared') ctx.globalAlpha = 0.55;

  const c = v.project(u, t);
  const s = v.scale(t);
  const big = Math.max(10, radius * 0.46 * s);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.font = `900 ${big}px ui-sans-serif, system-ui, sans-serif`;
  ctx.lineWidth = Math.max(2, big * 0.22);
  ctx.strokeStyle = 'rgba(8,12,18,.85)';
  ctx.strokeText(multiplier, c.x, c.y - big * 0.28);
  ctx.fillStyle = locked
    ? '#94a3b8'
    : state === 'next'
      ? '#fde68a'
      : state === 'cleared'
        ? '#86efac'
        : '#ffffff';
  ctx.fillText(multiplier, c.x, c.y - big * 0.28);
  const small = big * 0.62;
  ctx.font = `800 ${small}px ui-sans-serif, system-ui, sans-serif`;
  ctx.lineWidth = Math.max(2, small * 0.24);
  ctx.strokeText(chance, c.x, c.y + big * 0.62);
  ctx.fillStyle = 'rgba(226,232,240,.9)';
  ctx.fillText(chance, c.x, c.y + big * 0.62);
  ctx.restore();
}

// ─────────────────────────────────────────────
// Barriers
// ─────────────────────────────────────────────

/**
 * A boom barrier at the kerb end of a lane. `closed` runs 0 (arm straight up)
 * to 1 (arm down across the lane, holding its traffic). The post and the arm
 * both cast shadows, so the arm's shadow sweeps across the asphalt as it drops.
 */
export function barrierGeometry(v: View, lane: number, t: number, closed: number) {
  const post = { u: v.laneLeft(lane) + v.laneW * 0.06, w: v.laneW * 0.07, h: v.laneW * 0.34 };
  const pivotH = post.h * 0.86;
  const angle = (Math.PI / 2) * (1 - closed);
  const length = v.laneW * 0.86;
  const tip = { u: post.u + post.w / 2 + Math.cos(angle) * length, h: pivotH + Math.sin(angle) * length };
  const postBox: Box = { u0: post.u, u1: post.u + post.w, t0: t - 0.012, t1: t + 0.012, h0: 0, h1: post.h };
  return { postBox, pivot: { u: post.u + post.w / 2, h: pivotH }, tip, t };
}

export function drawBarrierShadow(ctx: CanvasRenderingContext2D, v: View, lane: number, t: number, closed: number) {
  const g = barrierGeometry(v, lane, t, closed);
  drawBoxShadow(ctx, v, g.postBox, 0.8);
  const a = v.shadowOf(g.pivot.u, t, g.pivot.h);
  const b = v.shadowOf(g.tip.u, t, g.tip.h);
  const pa = v.project(a.u, a.t);
  const pb = v.project(b.u, b.t);
  ctx.strokeStyle = 'rgba(10,14,22,.28)';
  ctx.lineWidth = Math.max(2, v.laneW * 0.045 * v.scale(t));
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pa.x, pa.y);
  ctx.lineTo(pb.x, pb.y);
  ctx.stroke();
}

export function drawBarrier(ctx: CanvasRenderingContext2D, v: View, lane: number, t: number, closed: number) {
  const g = barrierGeometry(v, lane, t, closed);
  drawBox(ctx, v, g.postBox, { top: '#f1f5f9', front: '#cbd5e1', left: '#e2e8f0', right: '#94a3b8' });

  // The arm: red and white bands along its length, as a thick stroked line.
  const width = Math.max(3, v.laneW * 0.05 * v.scale(t));
  const bands = 7;
  ctx.lineCap = 'butt';
  ctx.lineWidth = width;
  for (let i = 0; i < bands; i += 1) {
    const f0 = i / bands;
    const f1 = (i + 1) / bands;
    const p0 = v.project(g.pivot.u + (g.tip.u - g.pivot.u) * f0, t, g.pivot.h + (g.tip.h - g.pivot.h) * f0);
    const p1 = v.project(g.pivot.u + (g.tip.u - g.pivot.u) * f1, t, g.pivot.h + (g.tip.h - g.pivot.h) * f1);
    ctx.strokeStyle = i % 2 === 0 ? '#ef4444' : '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
  // Lamp on the tip, lit once the arm is down.
  if (closed > 0.95) {
    const tip = v.project(g.tip.u, t, g.tip.h);
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, width * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─────────────────────────────────────────────
// Chicken
// ─────────────────────────────────────────────

/**
 * The chicken's shadow: an ellipse under its feet, cast away from the light
 * and stretched as the hop lifts it — the one cue that tells a jump apart
 * from a slide.
 */
export function drawChickenShadow(
  ctx: CanvasRenderingContext2D,
  v: View,
  u: number,
  t: number,
  size: number,
  lift: number
) {
  const castFrom = v.shadowOf(u, t, size * 0.6 + lift);
  const c = v.project((u + castFrom.u) / 2, (t + castFrom.t) / 2);
  const s = v.scale(t);
  const spread = 1 + lift / (size * 1.2);
  const rx = size * 0.42 * s * spread + Math.abs(castFrom.u - u) * s * 0.35;
  const ry = size * 0.12 * s * spread;
  const alpha = 0.34 / spread;
  const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, rx);
  g.addColorStop(0, `rgba(8,12,20,${alpha})`);
  g.addColorStop(1, 'rgba(8,12,20,0)');
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.scale(1, ry / rx);
  ctx.translate(-c.x, -c.y);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c.x, c.y, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x, y + radius);
  ctx.closePath();
}

/**
 * Which renderer draws the player.
 *
 * `vector` is the default because it is simply the higher-quality of the two.
 * The image path loads `/chicken.modal.jpg`, whose transparency was flattened
 * into an opaque checkerboard when it was saved as JPEG; `spriteMask.ts` keys
 * that back out at load, but the bird is white against a white-and-grey
 * background and the recovered silhouette keeps a small ragged bite near the
 * left cheek. The vector rooster has real transparency, no artefacts, and stays
 * crisp at any device pixel ratio instead of being downscaled from 617px.
 *
 * Switch to `'image'` to go back to the photographic sprite — both paths size
 * from the same box, so nothing else changes.
 */
export const CHICKEN_RENDERER: 'vector' | 'image' = 'vector';

/** Where the image renderer sources the player. Keyed at load — see `spriteMask.ts`. */
export const CHICKEN_SPRITE_SRC = '/chicken.modal.jpg';

/**
 * Draws the chicken sprite centred on (cx, cy), scaled to `boxH` tall.
 *
 * The source is cropped to the silhouette before it gets here, so centring the
 * image *is* centring the bird. Width follows from the sprite's own aspect
 * ratio rather than the lane box, which is what keeps it from being stretched
 * as lane width and stage height change independently.
 */
export function drawChickenSprite(
  ctx: CanvasRenderingContext2D,
  sprite: KeyedSprite,
  cx: number,
  cy: number,
  boxH: number
) {
  const aspect = sprite.width / sprite.height;
  const drawH = boxH;
  const drawW = boxH * aspect;
  ctx.drawImage(sprite.canvas, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
}

/**
 * The rooster, facing right — the direction it crosses in.
 *
 * The default renderer, and the fallback for the image path: whichever is
 * selected, the board is never without a bird. Drawn as layered paths rather
 * than a blitted bitmap, so it carries real transparency and resolves at the
 * device's pixel ratio however small the lane gets.
 */
export function drawChicken(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  boxH: number,
  timeSeconds: number
) {
  // Sized off the same box the image path uses, so switching renderer cannot
  // change how big the bird is on the road.
  const h = boxH;
  const w = boxH * (CHICKEN_UNITS.w / CHICKEN_UNITS.h);
  const line = Math.max(0.6, h * 0.014);

  // ── Idle bounce ──
  // Squash and stretch about the feet rather than the centre, so the bird
  // presses into the road instead of hovering and sinking. Cosmetic only: the
  // hitbox stays on the base size, or a collision would depend on the frame
  // the animation happened to be on.
  const beat = timeSeconds * 4.6;
  const squash = 1 + Math.sin(beat) * 0.05;
  const stretch = 1 - Math.sin(beat) * 0.04;
  const bob = -Math.abs(Math.sin(beat)) * h * 0.035;

  ctx.save();
  ctx.translate(cx, cy + bob);
  ctx.translate(0, h * 0.5);
  ctx.scale(stretch, squash);
  ctx.translate(0, -h * 0.5);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const OUTLINE = 'rgba(71,85,105,.45)';

  // ── Legs ──
  // Short and stubby: long shanks read as poultry, stubby ones read as cute.
  for (const [lx, shade] of [
    [-w * 0.07, '#e08a12'],
    [w * 0.1, '#ffb52e'],
  ] as const) {
    ctx.strokeStyle = shade;
    ctx.lineWidth = Math.max(1.6, h * 0.062);
    ctx.beginPath();
    ctx.moveTo(lx, h * 0.3);
    ctx.lineTo(lx, h * 0.42);
    ctx.stroke();
    ctx.lineWidth = Math.max(1.2, h * 0.045);
    ctx.beginPath();
    ctx.moveTo(lx - w * 0.05, h * 0.45);
    ctx.lineTo(lx, h * 0.42);
    ctx.lineTo(lx + w * 0.06, h * 0.45);
    ctx.stroke();
  }

  // ── Tail ──
  // A small rounded fan. The long sickle plumes of a real rooster fight the
  // chibi proportions — they stretch the silhouette away from the head.
  const tail: ReadonlyArray<readonly [number, number, string]> = [
    [-0.4, -0.12, '#a9b4c2'],
    [-0.36, -0.28, '#cbd5e1'],
    [-0.24, -0.38, '#eef2f7'],
  ];
  // Stroked with a round cap rather than filled. A filled plume tapers to its
  // tip, and since the body covers the wide root, the only part left visible
  // was the point — three wisps instead of three feathers. A stroke keeps its
  // width the whole way out, including at the end.
  for (const [tipX, tipY, colour] of tail) {
    ctx.beginPath();
    ctx.moveTo(-w * 0.1, h * 0.12);
    ctx.quadraticCurveTo(w * tipX * 0.6, h * tipY * 0.9, w * tipX, h * tipY);
    // Dark pass first, slightly wider, which leaves an outline around the
    // colour pass laid over it.
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = h * 0.125;
    ctx.stroke();
    ctx.strokeStyle = colour;
    ctx.lineWidth = h * 0.1;
    ctx.stroke();
  }

  // ── Body ──
  // A small round pillow under a big head: the whole chibi trick is the ratio.
  const body = ctx.createRadialGradient(
    -w * 0.02,
    h * 0.04,
    h * 0.03,
    -w * 0.02,
    h * 0.14,
    h * 0.32
  );
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.65, '#f7f9fb');
  body.addColorStop(1, '#d3dbe4');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(-w * 0.03, h * 0.15, w * 0.27, h * 0.23, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = line;
  ctx.stroke();

  // Wing: one soft rounded pad with a single crease, not a feather diagram.
  ctx.fillStyle = '#e6ebf1';
  ctx.beginPath();
  ctx.ellipse(-w * 0.04, h * 0.16, w * 0.13, h * 0.12, -0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(71,85,105,.32)';
  ctx.lineWidth = line;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-w * 0.12, h * 0.14);
  ctx.quadraticCurveTo(-w * 0.02, h * 0.19, w * 0.05, h * 0.13);
  ctx.stroke();

  // ── Head ──
  // Deliberately oversized — roughly the body's own width. This is the single
  // change that reads as "cute" rather than "poultry".
  const headX = w * 0.14;
  const headY = -h * 0.19;
  const headR = h * 0.27;

  const head = ctx.createRadialGradient(
    headX - headR * 0.35,
    headY - headR * 0.4,
    headR * 0.12,
    headX,
    headY,
    headR
  );
  head.addColorStop(0, '#ffffff');
  head.addColorStop(0.7, '#fbfdfe');
  head.addColorStop(1, '#dde5ed');

  // ── Comb ──
  // Three soft lobes. A serrated crest is anatomically right and reads spiky,
  // which is the opposite of the brief.
  ctx.fillStyle = '#ef4b52';
  ctx.beginPath();
  ctx.arc(headX - headR * 0.34, headY - headR * 0.86, headR * 0.2, 0, Math.PI * 2);
  ctx.arc(headX + headR * 0.02, headY - headR * 1.02, headR * 0.24, 0, Math.PI * 2);
  ctx.arc(headX + headR * 0.38, headY - headR * 0.84, headR * 0.19, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.beginPath();
  ctx.arc(headX - headR * 0.02, headY - headR * 1.14, headR * 0.09, 0, Math.PI * 2);
  ctx.fill();

  // Head fill over the comb bases, so the lobes sit on the skull.
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.arc(headX, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = line;
  ctx.stroke();

  // Cheek blush — small, warm, and low on the face.
  ctx.fillStyle = 'rgba(248,113,113,.28)';
  ctx.beginPath();
  ctx.ellipse(headX + headR * 0.52, headY + headR * 0.42, headR * 0.2, headR * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Wattle ──
  // Tucked under the jaw and drawn before the beak, which then overlaps its
  // top edge. Placed further out it reads as a stray red dot beside the head.
  ctx.fillStyle = '#e5484d';
  ctx.beginPath();
  ctx.arc(headX + headR * 0.62, headY + headR * 0.66, headR * 0.145, 0, Math.PI * 2);
  ctx.fill();

  // ── Beak ──
  // A small rounded wedge. Anything long or hooked reads as a bird of prey.
  ctx.fillStyle = '#ffb52e';
  ctx.beginPath();
  ctx.moveTo(headX + headR * 0.72, headY + headR * 0.06);
  ctx.quadraticCurveTo(headX + headR * 1.32, headY + headR * 0.28, headX + headR * 0.7, headY + headR * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(180,110,10,.5)';
  ctx.lineWidth = line;
  ctx.stroke();

  // ── Eyes ──
  // Two, both visible in a three-quarter view, and big: the pupil carries a
  // large highlight plus a small secondary, which is what makes an eye read as
  // glossy rather than as a dot.
  const eyes: ReadonlyArray<readonly [number, number]> = [
    [headX + headR * 0.34, headY - headR * 0.06],
    [headX - headR * 0.32, headY - headR * 0.04],
  ];
  for (const [ex, ey] of eyes) {
    const r = headR * 0.3;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(ex, ey, r * 0.92, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(71,85,105,.35)';
    ctx.lineWidth = line * 0.8;
    ctx.stroke();

    ctx.fillStyle = '#141c2b';
    ctx.beginPath();
    ctx.ellipse(ex + r * 0.1, ey + r * 0.06, r * 0.6, r * 0.68, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ex + r * 0.32, ey - r * 0.3, r * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex - r * 0.16, ey + r * 0.34, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
