/**
 * Chicken Road — the pixel layer.
 *
 * The board renders into a buffer `PIXEL_SIZE` times smaller than the stage and
 * blits it back with smoothing off, so one art pixel is a hard square block.
 * That downscale is only half of a pixel look: art drawn with gradients and
 * curved strokes comes back through it as a photograph someone shrank — smooth
 * ramps break into muddy banding and thin strokes dissolve. What makes a board
 * read as *drawn* rather than *shrunk* is what this module provides:
 *
 *   a fixed palette   — flat, deliberate colours, so no ramp needs quantising;
 *   grid snapping     — every edge lands on an art-pixel boundary, so nothing
 *                       is half-covered and no edge shimmers as it moves;
 *   sprites           — figures authored as pixel matrices rather than paths.
 *
 * Nothing here decides anything about a round. It is all presentation, and the
 * outcome is settled server-side before any of it is called.
 */

import { PIXEL_SIZE } from './config';

// ─────────────────────────────────────────────
// Palette
// ─────────────────────────────────────────────

/**
 * The board's whole colour set. Every fill on the canvas comes from here, which
 * is what lets the posterise pass in `useCanvasRenderer` be switched off: a
 * palette this tight *is* the colour limit, and applying both gave banding on
 * top of banding.
 *
 * Grouped as ramps of three or four steps. A ramp is the pixel-art substitute
 * for a gradient — the far end of the road is a *different colour*, not the
 * same colour dimmed, so depth survives being flattened into blocks.
 */
export const PAL = {
  // Sky and haze over the far end.
  skyFar: '#9fd3e8',
  skyMid: '#7fbcd9',
  skyNear: '#63a3c7',

  // Grass verges, near to far. Cool and desaturated with distance.
  grassNear: '#4f9445',
  grassMid: '#5ea54e',
  grassFar: '#7bbb62',
  grassHaze: '#9ccb7e',

  // Asphalt, near to far. Blue-grey rather than neutral, so the warm kerb and
  // the yellow edge line have something to sit against.
  roadNear: '#3a3f52',
  roadMid: '#464c61',
  roadFar: '#565d74',
  roadHaze: '#6b7389',
  /** Alternate lane banding — one step off the band it sits on. */
  roadBand: '#414759',

  // Markings.
  paint: '#eef3f7',
  paintDim: '#c3ccd6',
  edgeLine: '#e8b74a',

  // Kerb concrete.
  kerbTop: '#c2c8d2',
  kerbFace: '#8d94a1',
  kerbDark: '#6d7482',

  // Manhole covers — the multiplier ladder.
  coverRim: '#5b6474',
  coverFace: '#3d4453',
  coverDeep: '#2b313d',
  coverLive: '#c9992f',
  coverLiveRim: '#f0c14b',
  coverDone: '#3c5a49',

  // The rooster.
  featherLit: '#ffffff',
  feather: '#e6ecf2',
  featherShade: '#b9c4d1',
  comb: '#e0454b',
  combDark: '#a92b32',
  beak: '#f2a52c',
  beakDark: '#c77c12',
  eye: '#1b2130',
  outline: '#3b4453',

  // Shared darks.
  shadow: 'rgba(10,14,22,.34)',
  shadowSoft: 'rgba(10,14,22,.18)',
  night: '#1b2130',
} as const;

/**
 * Car liveries. Four flat steps each: the lit top face, the two flanks and the
 * shaded side. Picked to stay apart from one another at a glance and from the
 * asphalt behind them — the old set was five near-identical greens, which at
 * this size read as one colour of box.
 */
export const CAR_PALETTES = [
  { roof: '#f2706f', shell: '#d93f47', side: '#a6272f', dark: '#7c1b22' },
  { roof: '#63b0f5', shell: '#2f7fd4', side: '#1f5ca3', dark: '#153f73' },
  { roof: '#ffd15c', shell: '#f0a91f', side: '#c07d0d', dark: '#8c5a08' },
  { roof: '#7fd9a8', shell: '#3aa873', side: '#247a52', dark: '#17573a' },
  { roof: '#f6f8fb', shell: '#cdd5e0', side: '#9ba5b5', dark: '#6f7684' },
  { roof: '#c39bf0', shell: '#8c5cd0', side: '#6a3fa8', dark: '#4a2a78' },
] as const;

export type CarPalette = (typeof CAR_PALETTES)[number];

// ─────────────────────────────────────────────
// Grid snapping
// ─────────────────────────────────────────────

/**
 * Rounds a stage coordinate onto the art grid.
 *
 * Draw calls are issued in CSS pixels into a buffer scaled by 1/PIXEL_SIZE, so
 * a coordinate lands on a whole buffer pixel exactly when it is a multiple of
 * PIXEL_SIZE. Snapping matters most for things that move: an unsnapped edge
 * creeps across a block boundary a fraction at a time and the anti-aliased
 * remainder flickers between two shades, which is the one artefact that most
 * reliably breaks the illusion.
 */
export const snap = (n: number): number => Math.round(n / PIXEL_SIZE) * PIXEL_SIZE;

/** A grid-aligned rectangle, guaranteed at least one art pixel each way. */
export function px(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string
): void {
  const x0 = snap(x);
  const y0 = snap(y);
  // Snap the far edge too rather than the width, or rounding the two
  // independently lets a shared boundary between neighbours gap by one pixel.
  const x1 = Math.max(x0 + PIXEL_SIZE, snap(x + w));
  const y1 = Math.max(y0 + PIXEL_SIZE, snap(y + h));
  ctx.fillStyle = fill;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

/**
 * A quad with its corners snapped to the grid. Used for the road and anything
 * else laid in perspective, where the shape is a trapezium rather than a box.
 *
 * The edges between two such quads still land on the same snapped corners, so
 * the road's lanes tile without seams.
 */
export function pxQuad(
  ctx: CanvasRenderingContext2D,
  pts: ReadonlyArray<{ x: number; y: number }>,
  fill: string
): void {
  ctx.beginPath();
  ctx.moveTo(snap(pts[0].x), snap(pts[0].y));
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(snap(pts[i].x), snap(pts[i].y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

// ─────────────────────────────────────────────
// Sprites
// ─────────────────────────────────────────────

/**
 * A sprite is rows of single-character palette keys, one character per art
 * pixel, with `.` transparent. Authoring them as text rather than as paths is
 * the point: what is written is exactly what is drawn, at any size, and a
 * feature survives being three pixels wide because it was placed as three
 * pixels rather than as a curve that happens to be thin.
 */
export interface Sprite {
  readonly rows: readonly string[];
  readonly key: Readonly<Record<string, string>>;
}

export const spriteWidth = (s: Sprite): number => s.rows[0]?.length ?? 0;
export const spriteHeight = (s: Sprite): number => s.rows.length;

/**
 * Blits a sprite with its *feet* centred on (cx, footY), scaled so the whole
 * figure is `drawH` tall.
 *
 * Runs of one colour are drawn as a single rect rather than a rect per pixel:
 * a 16-wide sprite is mostly horizontal runs, so this is a handful of fills
 * instead of a few hundred, and it also removes the hairline seams that
 * abutting per-pixel rects leave on a fractional device ratio.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite,
  cx: number,
  footY: number,
  drawH: number,
  options: { flip?: boolean; tint?: Record<string, string> } = {}
): void {
  const rows = sprite.rows;
  const cols = spriteWidth(sprite);
  if (!cols) return;

  // One art pixel of the sprite, in stage pixels, never below a whole block —
  // a sprite scaled under 1:1 would otherwise drop rows and lose its features.
  const unit = Math.max(PIXEL_SIZE, snap(drawH / rows.length));
  const w = cols * unit;
  const h = rows.length * unit;
  const left = snap(cx - w / 2);
  const top = snap(footY - h);

  const key = options.tint ? { ...sprite.key, ...options.tint } : sprite.key;

  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    let c = 0;
    while (c < cols) {
      const ch = row[options.flip ? cols - 1 - c : c] ?? '.';
      if (ch === '.') {
        c += 1;
        continue;
      }
      // Extend the run while the colour holds.
      let run = 1;
      while (c + run < cols && (row[options.flip ? cols - 1 - c - run : c + run] ?? '.') === ch) {
        run += 1;
      }
      const fill = key[ch];
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(left + c * unit, top + r * unit, run * unit, unit);
      }
      c += run;
    }
  }
}

// ─────────────────────────────────────────────
// The rooster
// ─────────────────────────────────────────────

const BIRD_KEY = {
  K: PAL.outline,
  W: PAL.featherLit,
  w: PAL.feather,
  s: PAL.featherShade,
  R: PAL.comb,
  r: PAL.combDark,
  B: PAL.beak,
  b: PAL.beakDark,
  E: PAL.eye,
} as const;

/**
 * The rooster, facing right — the way it crosses.
 *
 * Chibi proportions: a big head on a small body, stubby legs, and a short
 * tail of shaded feathers at body height — not at head height and not in the
 * comb's red, which read as a second comb floating beside the bird.
 * Every feature is placed at a size that survives the board's smallest lane —
 * the comb is three pixels tall, the beak two, the eye one — because a feature
 * drawn thinner than an art pixel is a feature that disappears.
 *
 * Two frames, alternated on the idle beat and on the hop. They differ only in
 * the legs and the tail, so the silhouette stays put and the bird reads as
 * bobbing rather than as sliding.
 */
export const CHICKEN_IDLE: Sprite = {
  key: BIRD_KEY,
  rows: [
    '..........rRr...',
    '.........rRRRr..',
    '.........rRRRr..',
    '.........KKKKK..',
    '........KKWWWKK.',
    '........KWWWWWK.',
    '........KWWEWWKB',
    '.......KKWWWWWKB',
    '..KK...KWWWWWWK.',
    '.KssK.KKWWWWWWK.',
    '.KsssKKWWWWWWWK.',
    '.KsssWWWWWWWWWK.',
    '..KWWWWWWWWWWWK.',
    '..KWwsWWWWWwsWK.',
    '...KKKKKKKKKKK..',
    '.....BB...BB....',
    '....BBB...BBB...',
  ],
};

/**
 * The off-beat frame: tail lifted, legs together, body a pixel lower.
 *
 * Exactly the same grid as the idle frame — 16 by 17. Two frames of different
 * sizes would be scaled to the same drawn height and the bird would pulse
 * between them, which is the opposite of the intended bob.
 */
export const CHICKEN_STEP: Sprite = {
  key: BIRD_KEY,
  rows: [
    '................',
    '..........rRr...',
    '.........rRRRr..',
    '.........rRRRr..',
    '.........KKKKK..',
    '........KKWWWKK.',
    '........KWWWWWK.',
    '........KWWEWWKB',
    '.KK....KKWWWWWKB',
    'KssK..KKWWWWWWK.',
    'KsssKKKWWWWWWWK.',
    '.KssWWWWWWWWWWK.',
    '..KWWWWWWWWWWWK.',
    '..KWwsWWWWWwsWK.',
    '...KKKKKKKKKKK..',
    '......BB.BB.....',
    '.....BBB.BBB....',
  ],
};

/**
 * Picks the frame for a moment in time. One swap per beat rather than a
 * continuous squash: a two-frame cycle is what a pixel bird does, and
 * interpolating between them would put the sprite back on fractional rows.
 */
export function chickenFrame(timeSeconds: number): Sprite {
  return Math.floor(timeSeconds * 4.6) % 2 === 0 ? CHICKEN_IDLE : CHICKEN_STEP;
}
