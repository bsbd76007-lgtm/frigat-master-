'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useCanvasRenderer, type CanvasFrame } from '@/lib/useCanvasRenderer';
import { useInjectedStyles } from '@/lib/useInjectedStyles';
import { loadKeyedSprite, type KeyedSprite } from '@/lib/spriteMask';

/**
 * Chicken Road — side-scrolling arcade crossing, drawn on a canvas.
 *
 * The chicken starts on the left verge and hops one lane right per tap — the
 * sprite itself is the control, with a hit target the render loop keeps pinned
 * to it. There is no far side: lanes are generated on demand as the camera
 * follows the chicken, so a round only ends when the player cashes out or a car
 * lands. Traffic is one-way, running top to bottom in every lane.
 *
 * No balance appears anywhere on this board — it neither reads nor reports the
 * wallet, and nothing here can move money (only the server does, via
 * ledger.service.ts).
 *
 * ── On the odds ────────────────────────────────────────────────────────────
 * Traffic is scenery. Whether a hop survives is decided by one roll against the
 * traffic mode's hazard rate at the moment the player presses, and the ladder is
 * priced off that survival probability (`rtp / p^lanes`) so the edge stays flat
 * however far the player goes — a flat per-step increment would not hold.
 * When the roll fails, a car is launched into the target lane timed to arrive as
 * the chicken lands, so the animation shows the outcome instead of deciding it.
 * The roll still happens in the browser: this is a practice board until a
 * server-side engine owns it (see `apps/server/src/engines/`).
 *
 * ── Barriers ───────────────────────────────────────────────────────────────
 * A gate lands *across* each lane the chicken has entered, spanning the asphalt
 * between the lane's dividers rather than sitting on them, and swinging up from
 * below the lane. Traffic queues and stops at it, which is what makes the lanes
 * behind the chicken safe. The bar sits upstream of the crossing line because
 * cars come from the top — put it downstream and they would drive through the
 * chicken before anything stopped them.
 *
 * Styling is injected CSS — this project ships no utility CSS framework, so
 * `bg-[#7c8b9e]` would resolve to nothing.
 */

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────

export const GAME_CONFIG = {
  minBet: 1,
  maxBet: 1000,
  currency: '$',
  /** Return to player the ladder is priced against. */
  rtp: 0.99,
  /** Lanes across the stage; the camera scrolls, the lane count does not cap. */
  visibleLanes: 5,
  /** Lanes kept rendered ahead of the chicken. */
  lookahead: 6,
  /** Lanes kept rendered behind the chicken. */
  lookbehind: 2,
  /** Cash out only unlocks once this lane is reached. */
  minCashoutLane: 5,
} as const;

export type Phase = 'IDLE' | 'PLAYING' | 'WON' | 'LOST';

export interface TrafficMode {
  id: string;
  label: string;
  /** Chance a single crossing fails. Drives both the ladder and the traffic. */
  difficulty: number;
  /** Seconds between spawns in an open lane. */
  gap: readonly [number, number];
  /** Lane lengths per second. */
  speed: readonly [number, number];
}

/**
 * Difficulty is the hazard rate, so the selector reads as "how much traffic".
 * Spawn gap and speed are derived from the same number, which is what keeps the
 * board looking like the odds it is paying.
 */
export const TRAFFIC_MODES: readonly TrafficMode[] = [
  { id: 'low', label: '15%', difficulty: 0.15, gap: [2.4, 3.6], speed: [0.22, 0.32] },
  { id: 'medium', label: '25%', difficulty: 0.25, gap: [1.7, 2.7], speed: [0.26, 0.38] },
  { id: 'high', label: '50%', difficulty: 0.5, gap: [1.0, 1.8], speed: [0.34, 0.5] },
  { id: 'extreme', label: '75%', difficulty: 0.75, gap: [0.55, 1.1], speed: [0.42, 0.64] },
] as const;

const DEFAULT_MODE = TRAFFIC_MODES[1];

/** Milliseconds a hop takes; the crash car is timed against this. */
const HOP_MS = 320;

/**
 * Board geometry as fractions of the stage. The canvas and the DOM overlay both
 * derive from these, so coins and gates can never drift off the asphalt.
 */
const LAYOUT = {
  /** The line the chicken walks — coins are centred on it too. */
  chickenY: 0.5,
  /** Where a gate stops downward traffic, and (mirrored) upward traffic. */
  gateY: 0.32,
} as const;

/**
 * Sprite dimensions along the travel axis, as fractions of stage height. They
 * fall out of the drawn scale rather than being guessed, so spawn points,
 * despawn points, following distance and the collision box all stay tied to how
 * big the cars actually are. Seeded with the values for a typical stage and
 * refreshed every frame from the live scale.
 */
interface Geometry {
  /** Full car length along the lane. */
  carLen: number;
  /** Half a car, i.e. nose or tail to centre. */
  carHalf: number;
  /** Half the chicken's collision box along the lane. */
  chickenHalf: number;
}

const SEED_GEOMETRY: Geometry = { carLen: 0.14, carHalf: 0.07, chickenHalf: 0.02 };

/** Clear air kept between a car's tail and the nose of the one behind it. */
const FOLLOW_GAP = 0.03;

/**
 * Every lane flows the same way — top to bottom. Kept as a function because the
 * traffic model still carries a signed direction, so one-way is a policy here
 * rather than an assumption baked through the physics.
 */
function laneDirection(_lane: number): 1 | -1 {
  return 1;
}

/**
 * The stop line a gate imposes on its lane, in travel-axis fractions. It has to
 * sit upstream of the crossing line: traffic arrives from the top, so a gate
 * below the chicken would let cars drive through it before stopping.
 */
function gateFraction(lane: number): number {
  return laneDirection(lane) > 0 ? LAYOUT.gateY : 1 - LAYOUT.gateY;
}

/** Multiplier once `lane` lanes are behind the chicken, for a given hazard. */
export function multiplierAt(lane: number, difficulty: number): number {
  if (lane <= 0) return 1;
  const survival = 1 - difficulty;
  return Number(Math.max(1.01, GAME_CONFIG.rtp / survival ** lane).toFixed(2));
}

/** Chance of clearing one more lane. Constant per mode, by construction. */
export function crossingChanceAt(difficulty: number): number {
  return 1 - difficulty;
}

/**
 * Chance of reaching `lane` from the verge — the *cumulative* survival odds,
 * `p^lane`, not the per-hop rate.
 *
 * The per-hop number is the same on every lane by construction, so printing it
 * on each tile said nothing about how far the player had gone: a row of
 * identical "75%" badges reads as a fixed chance of winning the whole run. The
 * cumulative figure is the one that actually falls away as the ladder climbs,
 * and it is the exact complement of the multiplier beside it (`rtp / p^lane`).
 */
export function cumulativeChanceAt(lane: number, difficulty: number): number {
  if (lane <= 0) return 1;
  return crossingChanceAt(difficulty) ** lane;
}

function money(value: number): string {
  return `${GAME_CONFIG.currency}${value.toFixed(2)}`;
}

/** Ladders on the harder modes outgrow a fixed-width badge within a few lanes. */
function formatMultiplier(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}K`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  if (value >= 100) return value.toFixed(0);
  return value.toFixed(2);
}

/**
 * Cumulative odds as a percentage. Deep lanes on the harder modes fall below
 * half a percent, where rounding would print a flat "0%" on a lane that is
 * still reachable — those get "<1%" instead.
 */
function formatChance(chance: number): string {
  const pct = chance * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

function randomBetween([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}

function randomCarColour(): CarColour {
  return CAR_COLOURS[Math.floor(Math.random() * CAR_COLOURS.length)] ?? CAR_COLOURS[0];
}

// ─────────────────────────────────────────────
// Traffic model
// ─────────────────────────────────────────────

interface Car {
  /** Position along the lane's travel axis, as a fraction of stage height. */
  t: number;
  /** Lane lengths per second, always positive; the lane carries direction. */
  speed: number;
  /** Cars already past a closing gate clear out rather than freeze mid-lane. */
  fleeing: boolean;
  /** The one car allowed to hit the chicken, on a failed crossing roll. */
  doomed: boolean;
  /** Fixed at spawn, so a car never changes colour as it drives. */
  colour: CarColour;
}

interface LaneTraffic {
  dir: 1 | -1;
  cars: Car[];
  /** `performance.now()` stamp of the next spawn. */
  nextSpawnAt: number;
}

// ─────────────────────────────────────────────
// Vector sprites
// ─────────────────────────────────────────────

/**
 * Sprites are drawn as vector paths at the device pixel ratio rather than as
 * blocks of `fillRect`, so they stay crisp at any stage size and on any display.
 * Nothing here rounds a coordinate: snapping a rotated or scrolling sprite to
 * whole pixels is exactly what makes a car look like it is shuffling sideways
 * while it drives.
 *
 * Both grids are sized in abstract units and scaled at draw time. The car's
 * `len` runs *along* its lane and `width` across it, so the sprite is drawn
 * already facing down the lane — no canvas rotation, and therefore no rotated
 * basis for a sub-pixel wobble to live in.
 */
const CAR_UNITS = { len: 8, width: 5 } as const;
const CHICKEN_UNITS = { w: 8, h: 7 } as const;

const CAR_COLOURS = [
  { shell: '#e5484d', deep: '#a01f25', roof: '#f2686c' },
  { shell: '#3b82f6', deep: '#1d4ed8', roof: '#60a5fa' },
  { shell: '#f59e0b', deep: '#b45309', roof: '#fbbf24' },
  { shell: '#f59e0b', deep: '#15803d', roof: '#4e9e7a' },
  { shell: '#e2e8f0', deep: '#94a3b8', roof: '#f8fafc' },
] as const;

export type CarColour = (typeof CAR_COLOURS)[number];

function roundedRect(
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
 * A car seen from above, nose pointing down the +Y axis. `cx` is the lane
 * centre and `cy` the position along the lane — the only two numbers that move,
 * and `cx` is constant for the life of the car.
 */
function drawCar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  colour: CarColour,
  dir: 1 | -1
) {
  const len = CAR_UNITS.len * scale;
  const width = CAR_UNITS.width * scale;
  const half = { l: len / 2, w: width / 2 };

  ctx.save();
  ctx.translate(cx, cy);
  // Mirror rather than rotate for upstream lanes: still axis-aligned, so the
  // travel line stays exactly vertical.
  if (dir < 0) ctx.scale(1, -1);

  // Ground shadow, offset slightly across the lane.
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  roundedRect(ctx, -half.w + scale * 0.4, -half.l + scale * 0.5, width, len, scale * 1.2);
  ctx.fill();

  // Wheels, sunk under the shell on both flanks.
  ctx.fillStyle = '#12161f';
  for (const sy of [-half.l * 0.58, half.l * 0.5]) {
    for (const sx of [-half.w, half.w - scale * 0.5]) {
      roundedRect(ctx, sx - scale * 0.1, sy - scale * 0.7, scale * 0.7, scale * 1.5, scale * 0.3);
      ctx.fill();
    }
  }

  // Shell.
  const shell = ctx.createLinearGradient(-half.w, 0, half.w, 0);
  shell.addColorStop(0, colour.roof);
  shell.addColorStop(0.55, colour.shell);
  shell.addColorStop(1, colour.deep);
  ctx.fillStyle = shell;
  roundedRect(ctx, -half.w, -half.l, width, len, scale * 1.3);
  ctx.fill();

  // Cabin glass: windscreen at the nose, rear window at the tail.
  ctx.fillStyle = 'rgba(15,23,42,.62)';
  roundedRect(ctx, -half.w * 0.72, half.l * 0.08, width * 0.72, len * 0.22, scale * 0.5);
  ctx.fill();
  roundedRect(ctx, -half.w * 0.72, -half.l * 0.52, width * 0.72, len * 0.2, scale * 0.5);
  ctx.fill();

  // Roof highlight between the two windows.
  ctx.fillStyle = 'rgba(255,255,255,.16)';
  roundedRect(ctx, -half.w * 0.6, -half.l * 0.26, width * 0.6, len * 0.3, scale * 0.4);
  ctx.fill();

  // Headlights at the nose, tail lights behind.
  ctx.fillStyle = '#fff7d6';
  for (const sx of [-half.w * 0.62, half.w * 0.34]) {
    roundedRect(ctx, sx, half.l - scale * 0.85, scale * 1.4, scale * 0.6, scale * 0.3);
    ctx.fill();
  }
  ctx.fillStyle = '#b91c1c';
  for (const sx of [-half.w * 0.62, half.w * 0.34]) {
    roundedRect(ctx, sx, -half.l + scale * 0.25, scale * 1.4, scale * 0.5, scale * 0.25);
    ctx.fill();
  }

  ctx.restore();
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
const CHICKEN_RENDERER: 'vector' | 'image' = 'vector';

/** Where the image renderer sources the player. Keyed at load — see `spriteMask.ts`. */
const CHICKEN_SPRITE_SRC = '/chicken.modal.jpg';

/**
 * Draws the chicken sprite centred on (cx, cy), scaled to `boxH` tall.
 *
 * The source is cropped to the silhouette before it gets here, so centring the
 * image *is* centring the bird. Width follows from the sprite's own aspect
 * ratio rather than the lane box, which is what keeps it from being stretched
 * as lane width and stage height change independently.
 */
function drawChickenSprite(
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
function drawChicken(
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

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────

const STYLE_ID = 'fg-chicken-road-styles';

const CSS = `
.chr { display: flex; flex-direction: column; align-items: center; gap: 24px;
  width: 100%; max-width: 1100px; margin-inline: auto; padding: 16px;
  box-sizing: border-box; color: #e2e8f0;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (min-width: 1024px) {
  .chr { flex-direction: row; align-items: flex-start; justify-content: center; }
}

/* ── Canvas ────────────────────────────────────────── */
/* Horizontal board: the crossing reads left → right, so the stage is wider
   than it is tall. */
/* --chr-lane / --chr-cam place the overlay against the camera; --chr-chick-x /
   --chr-chick-y follow the sprite so its hit target rides along with it. All
   four are written by the render loop and inherited by everything inside. */
.chr__stage { position: relative; width: 100%; max-width: 700px; min-width: 0;
  aspect-ratio: 3 / 2; background: #7c8b9e; border: 4px solid #e5a059;
  border-radius: 16px; overflow: hidden;
  box-shadow: 0 25px 50px -12px rgba(0,0,0,.6);
  --chr-lane: 0px; --chr-cam: 0; --chr-chick-x: 0px; --chr-chick-y: 0px; }
/* Two layers, because the hatches are DOM and the bird is canvas.
   The road canvas sits under the overlay so the covers are readable; the bird
   needs to be *over* them, and a DOM element cannot be slotted between two
   canvas draws. So the bird gets its own transparent canvas on top. Without
   this it was painted under the hatch and its multiplier text. */
.chr__canvas { display: block; width: 100%; height: 100%; }
.chr__canvas--fg { position: absolute; inset: 0; z-index: 3;
  pointer-events: none; }

/* The chicken itself is the step control: a hit target pinned to the sprite. */
.chr__chick { position: absolute; left: var(--chr-chick-x); top: var(--chr-chick-y);
  width: 76px; height: 76px; margin: -38px 0 0 -38px; padding: 0;
  background: transparent; border: 0; border-radius: 999px; cursor: pointer;
  z-index: 2; }
.chr__chick::after { content: ''; position: absolute; inset: 6px; border-radius: 999px;
  border: 2px dashed rgba(255,255,255,.35); opacity: 0;
  transition: opacity .2s ease; }
.chr__chick:hover::after { opacity: .9; }
.chr__chick:focus-visible { outline: none; }
.chr__chick:focus-visible::after { opacity: 1; border-color: var(--fg-accent); border-style: solid; }
.chr__chick:disabled { cursor: default; pointer-events: none; }
.chr__chick:disabled::after { opacity: 0; }

.chr__hud { position: absolute; left: 12px; right: 12px; top: 12px; display: flex;
  justify-content: space-between; gap: 8px; pointer-events: none; }
.chr__chip { padding: 5px 11px; font-size: 11px; font-weight: 800; letter-spacing: .06em;
  text-transform: uppercase; color: #0f172a; background: rgba(255,255,255,.82);
  border-radius: 999px; }

/* ── Overlay: coins and gates, aligned to the canvas geometry ──────────── */
/* --chr-lane (lane width in px) and --chr-cam (camera position in lanes) are
   written by the render loop, so every overlay element scrolls in lockstep with
   what the canvas draws. */
.chr__overlay { position: absolute; inset: 0; pointer-events: none; }

/* A slot owns the positioning; the visual inside owns the transforms, so an
   animation can never fight the layout. */
.chr__coin-slot { position: absolute; top: 50%; width: 0; height: 0; }
.chr__gate-slot { position: absolute; width: var(--chr-lane); height: 0; }

/* Manhole hatch: a cast-metal cover set into the asphalt, in place of the gold
   coin that used to sit here. Three layers do the work — a brushed radial face,
   a ring of bolt heads around the rim, and a cross-hatched tread pattern — with
   a hard inner shadow so the cover reads as sunk into the road rather than
   resting on it. The chicken's landing point is this element's exact centre. */
.chr__coin { position: absolute; left: 0; top: 0; display: flex;
  flex-direction: column; align-items: center; justify-content: center;
  width: 68px; height: 68px; margin-left: -34px; margin-top: -34px;
  border-radius: 999px; text-align: center;
  background:
    /* Inner face, painted over the rim and stopping short of the edge. */
    radial-gradient(circle closest-side at 38% 30%,
      #8e9aa9 0%, #66727f 46%, #414c59 74%, #333d48 100%) content-box,
    /* Heavy machined rim. A conic sweep gives it a light side and a dark side,
       which is what makes a ring read as a bevelled casting rather than a
       painted circle — a radial gradient alone is lit from everywhere. */
    conic-gradient(from 210deg,
      #2a323c 0deg, #7e8b99 55deg, #c3ccd6 92deg, #78848f 140deg,
      #232a33 200deg, #4c5764 268deg, #99a5b2 310deg, #2a323c 360deg);
  padding: 7px;
  box-sizing: border-box;
  border: 2px solid #171d26;
  box-shadow:
    /* depth: dark at the bottom inside, light along the top lip */
    inset 0 -7px 12px rgba(0,0,0,.6),
    inset 0 4px 8px rgba(255,255,255,.3),
    /* the recess the cover sits in */
    0 3px 0 rgba(0,0,0,.5),
    0 8px 16px rgba(0,0,0,.55);
  transition: transform .3s ease, filter .3s ease, opacity .3s ease; }

/* Rivet ring. Two conic families offset by a couple of degrees: the pale one
   is the lit crown of each stud, the dark one the shadow just behind it, and
   the offset is what domes them. Masked to the rim band so they sit on the
   casting, not on the face. */
.chr__coin::before { content: ''; position: absolute; inset: 2px;
  border-radius: inherit; pointer-events: none;
  background:
    repeating-conic-gradient(from 21deg,
      rgba(233,240,247,.85) 0deg 3.4deg, transparent 3.4deg 45deg),
    repeating-conic-gradient(from 25deg,
      rgba(0,0,0,.65) 0deg 3.4deg, transparent 3.4deg 45deg);
  -webkit-mask: radial-gradient(circle, transparent 0 74%, #000 77% 92%, transparent 95%);
  mask: radial-gradient(circle, transparent 0 74%, #000 77% 92%, transparent 95%); }

/* Sewer grating: radial slots cut into the face. Held to an annulus so the
   centre stays plain — a grate running under the type is what would make the
   multiplier hard to read, and real covers leave the middle clear too. */
.chr__coin-grate { position: absolute; inset: 7px; border-radius: 999px;
  pointer-events: none;
  background:
    repeating-conic-gradient(from 11deg,
      rgba(9,13,20,.72) 0deg 7deg, transparent 7deg 22.5deg),
    repeating-conic-gradient(from 18deg,
      rgba(255,255,255,.14) 0deg 1.4deg, transparent 1.4deg 22.5deg);
  -webkit-mask: radial-gradient(circle, transparent 0 52%, #000 58% 88%, transparent 93%);
  mask: radial-gradient(circle, transparent 0 52%, #000 58% 88%, transparent 93%); }

/* Machined inner ring around the type, plus the specular sweep across the
   whole face that keeps it reading as metal rather than as grey plastic. */
.chr__coin::after { content: ''; position: absolute; inset: 13px;
  border-radius: 999px; pointer-events: none;
  border: 1.5px solid rgba(9,13,20,.6);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.26),
    inset 0 -3px 7px rgba(0,0,0,.45);
  background: linear-gradient(148deg, rgba(255,255,255,.2) 0%,
    rgba(255,255,255,.04) 38%, rgba(255,255,255,0) 60%); }

/* The multiplier is the headline — it is what the lane pays. Light type on the
   dark cover: a dark halo for contrast against the metal, then a faint light
   glow so the glyphs lift off the grating rather than sinking into it. */
.chr__coin-mult { position: relative; z-index: 2; font-size: 15px; font-weight: 900;
  font-variant-numeric: tabular-nums; line-height: 1; color: #ffffff;
  letter-spacing: -.02em; -webkit-font-smoothing: antialiased;
  text-shadow:
    0 1px 2px rgba(0,0,0,.95),
    0 0 3px rgba(0,0,0,.9),
    0 0 9px rgba(186,230,253,.45); }
/* Cumulative odds of reaching this lane, under it in a quieter weight. */
.chr__coin-pct { position: relative; z-index: 2; margin-top: 3px; font-size: 10px;
  font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1;
  color: #cbd5e1; -webkit-font-smoothing: antialiased;
  text-shadow: 0 1px 2px rgba(0,0,0,.95), 0 0 3px rgba(0,0,0,.85); }

/* Already crossed. The cover is grey to begin with, so grayscale would do
   nothing here — dimming is what reads as "behind you". */
.chr__coin--cleared { filter: brightness(.62) saturate(.7); transform: scale(.85); }
.chr__coin--next { animation: chr-coin-bob 1.9s ease-in-out infinite; }
/* The lane the chicken is standing in. The badge no longer has to fade out of
   the bird's way — the bird is on a layer above it now — so it only grows
   slightly to mark where the player is standing. */
.chr__coin--stand { opacity: .82; transform: scale(1.16); animation: none; }

/* Concrete gate: a bar laid ACROSS the lane, between its dividers, so it blocks
   traffic rather than sitting on a lane line. It settles on the upstream side of
   the crossing — that is where it has to be to hold the traffic — and swings up
   into place from below the lane rather than dropping in from above. */
.chr__gate { position: absolute; left: 6%; right: 6%; top: 0; height: 16px;
  margin-top: -8px; border-radius: 3px; opacity: 0; transform: translateY(42px);
  background:
    repeating-linear-gradient(90deg, rgba(0,0,0,.16) 0 2px, transparent 2px 26px),
    linear-gradient(180deg, #d8dce3 0%, #a9b1bb 55%, #7d848e 100%);
  border: 1px solid rgba(15,23,42,.5);
  box-shadow: 0 4px 10px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.55); }
/* Hazard flashes, so it reads as roadworks at a glance. */
.chr__gate::after { content: ''; position: absolute; inset: 4px 8px; border-radius: 2px;
  background: repeating-linear-gradient(115deg, #e33a3a 0 9px, #f8fafc 9px 18px);
  opacity: .9; }
.chr__gate--down { animation: chr-thunk .42s cubic-bezier(.34,1.3,.5,1) forwards; }

@keyframes chr-coin-bob {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-4px) scale(1.04); }
}
/* Comes up from below the lane and settles across it. */
@keyframes chr-thunk {
  0% { transform: translateY(42px) scaleY(.9); opacity: 0; }
  55% { transform: translateY(0) scaleY(1.18); opacity: 1; }
  75% { transform: translateY(3px) scaleY(.94); opacity: 1; }
  100% { transform: translateY(0) scaleY(1); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .chr__coin--next { animation: none; }
  /* The gate still lands — that is state, not decoration — it just snaps. */
  .chr__gate--down { animation: none; opacity: 1; transform: translateY(0); }
}

/* ── Panel ─────────────────────────────────────────── */
.chr__panel { display: flex; flex-direction: column; gap: 16px; width: 100%;
  max-width: 700px; min-width: 0; flex: 0 0 auto; padding: 24px; box-sizing: border-box;
  background: #121c24; border: 1px solid #1e293b; border-radius: 16px;
  box-shadow: 0 20px 25px -5px rgba(0,0,0,.5); }
@media (min-width: 1024px) { .chr__panel { width: 320px; } }

.chr__label { display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 8px; font-size: 11px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: #64748b; }
.chr__label b { font-size: 13px; color: var(--fg-gold); letter-spacing: 0; }

.chr__inputs { display: flex; gap: 6px; }
.chr__input { flex: 1 1 auto; min-width: 0; width: 100%; box-sizing: border-box;
  padding: 12px 13px; font-family: inherit; font-size: 15px; font-weight: 700;
  font-variant-numeric: tabular-nums; color: #f1f5f9; background: #0b141b;
  border: 1px solid #1e293b; border-radius: 10px; outline: none;
  transition: border-color .2s ease, box-shadow .2s ease; }
.chr__input:focus-visible { border-color: var(--fg-accent); box-shadow: 0 0 0 3px rgba(34,197,94,.22); }
.chr__input:disabled { opacity: .5; cursor: not-allowed; }
.chr__mod { flex: 0 0 auto; min-width: 42px; padding: 0 9px; font-family: inherit;
  font-size: 12px; font-weight: 800; color: #cbd5e1; background: #0b141b;
  border: 1px solid #1e293b; border-radius: 10px; cursor: pointer;
  transition: background .2s ease, color .2s ease, transform .12s ease; }
.chr__mod:hover:not(:disabled) { color: #fff; background: #1e293b; }
.chr__mod:active:not(:disabled) { transform: translateY(1px); }
.chr__mod:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.3); }
.chr__mod:disabled { opacity: .45; cursor: not-allowed; }

/* ── Traffic density selector ──────────────────────── */
.chr__modes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.chr__mode { padding: 10px 4px; font-family: inherit; font-size: 13px; font-weight: 800;
  font-variant-numeric: tabular-nums; color: #cbd5e1; background: #0b141b;
  border: 1px solid #1e293b; border-radius: 10px; cursor: pointer;
  transition: background .2s ease, border-color .2s ease, color .2s ease; }
.chr__mode:hover:not(:disabled) { color: #fff; background: #1e293b; }
.chr__mode:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.3); }
.chr__mode:disabled { opacity: .45; cursor: not-allowed; }
.chr__mode--on { color: #0b0e14; background: var(--fg-accent); border-color: var(--fg-accent); }
.chr__mode--on:hover:not(:disabled) { color: #0b0e14; background: var(--fg-pos); }

.chr__banner { padding: 11px; text-align: center; font-size: 13px; font-weight: 700;
  border-radius: 12px; }
.chr__banner--lost { color: #d69199; background: rgba(239,68,68,.14);
  border: 1px solid rgba(239,68,68,.4); }
.chr__banner--won { color: var(--fg-pos-soft); background: rgba(34,197,94,.14);
  border: 1px solid rgba(34,197,94,.4); }
.chr__error { margin: 0; font-size: 12px; font-weight: 600; color: #c25560;
  text-align: center; }

.chr__action { width: 100%; padding: 16px; font-family: inherit; font-size: 17px;
  font-weight: 900; color: #0b0e14;
  background: linear-gradient(90deg, var(--fg-accent), var(--fg-accent-deep)); border: none;
  border-radius: 12px; cursor: pointer; box-shadow: 0 10px 20px -5px rgba(34,197,94,.4);
  transition: background .2s ease, box-shadow .2s ease, transform .12s ease; }
.chr__action:hover:not(:disabled) { background: linear-gradient(90deg, var(--fg-pos), var(--fg-accent));
  box-shadow: 0 14px 28px -6px rgba(34,197,94,.6); }
.chr__action:active:not(:disabled) { transform: translateY(1px); }
.chr__action:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.45); }
.chr__action:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
.chr__action--cash { color: #422006;
  background: linear-gradient(90deg, var(--fg-gold), var(--fg-gold-deep));
  box-shadow: 0 10px 20px -5px rgba(250,204,21,.4); }
.chr__action--cash:hover:not(:disabled) { background: linear-gradient(90deg, var(--fg-gold-soft), var(--fg-gold)); }
.chr__hint { margin: 0; font-size: 11px; text-align: center; color: #475569; }
`;

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function ChickenRoad() {
  useInjectedStyles(STYLE_ID, CSS);

  const [phase, setPhase] = useState<Phase>('IDLE');
  const [lane, setLane] = useState(0);
  const [bet, setBet] = useState(10);
  const [mode, setMode] = useState<TrafficMode>(DEFAULT_MODE);
  const [hopping, setHopping] = useState(false);
  const [lastWin, setLastWin] = useState<number | null>(null);

  // The render loop reads these rather than state, so it never restarts and
  // never closes over a stale value.
  const phaseRef = useRef<Phase>('IDLE');
  const laneRef = useRef(0);
  const modeRef = useRef<TrafficMode>(DEFAULT_MODE);
  const lanesRef = useRef<Map<number, LaneTraffic>>(new Map());
  /** Sprite sizes in lane fractions, refreshed from the drawn scale each frame. */
  const geomRef = useRef<Geometry>({ ...SEED_GEOMETRY });
  const stageRef = useRef<HTMLDivElement>(null);
  /**
   * The player's chicken. Held in a ref rather than state: the render loop is
   * the only reader, and re-rendering the tree when it arrives would restart
   * nothing useful. Null until the image has loaded and been keyed, and if that
   * ever fails it simply stays null and the vector fallback keeps drawing.
   */
  const chickenSpriteRef = useRef<KeyedSprite | null>(null);
  /** Where the road pass decided the bird goes; read by the foreground pass. */
  const chickenScreenRef = useRef({ x: 0, y: 0, boxH: 0, seconds: 0 });
  const chickenShadowRef = useRef({ y: 0, drawW: 0, drawH: 0, lift: 0 });
  const cameraRef = useRef(0);
  /** Lane the sprite occupies, as a float while a hop is in flight. */
  const visualLaneRef = useRef(0);
  const hopRef = useRef<{ from: number; to: number; startedAt: number } | null>(null);
  /** Set when the crossing roll failed: the lane, and when the car should land. */
  const doomedRef = useRef<{ lane: number; at: number } | null>(null);
  const crashAtRef = useRef<number | null>(null);
  const landingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isPlaying = phase === 'PLAYING';
  const isOver = phase === 'WON' || phase === 'LOST';
  const multiplier = multiplierAt(lane, mode.difficulty);
  const payout = Number((bet * multiplier).toFixed(2));

  /** Rendered window of lanes — unbounded ahead, trimmed behind. */
  const laneList = useMemo(() => {
    const first = Math.max(1, lane - GAME_CONFIG.lookbehind);
    const last = lane + GAME_CONFIG.lookahead;
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
  }, [lane]);

  // The board shows no balance of any kind, so the stake is only bounded by the
  // table limits — nothing here reads or reports the wallet.
  const betError = useMemo(() => {
    if (!Number.isFinite(bet) || bet < GAME_CONFIG.minBet) {
      return `Minimum bet is ${money(GAME_CONFIG.minBet)}`;
    }
    if (bet > GAME_CONFIG.maxBet) return `Maximum bet is ${money(GAME_CONFIG.maxBet)}`;
    return null;
  }, [bet]);

  const maxBet = GAME_CONFIG.maxBet;

  const setPhaseBoth = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const setLaneBoth = useCallback((next: number) => {
    laneRef.current = next;
    setLane(next);
  }, []);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Load the chicken art once per mount. The keying is a one-off cost of a few
  // tens of milliseconds; the vector chicken covers the frames until it lands.
  useEffect(() => {
    // Nothing to fetch or key when the vector rooster is drawing: the keying
    // pass walks ~450k pixels, which is not a cost to pay for an unused sprite.
    if (CHICKEN_RENDERER !== 'image') return;

    let cancelled = false;
    void loadKeyedSprite(CHICKEN_SPRITE_SRC).then((sprite) => {
      if (!cancelled) chickenSpriteRef.current = sprite;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (landingTimerRef.current) clearTimeout(landingTimerRef.current);
    },
    []
  );

  // ── Traffic ────────────────────────────────────────

  /** Just past the top edge: a car eases in nose first, never popping in. */
  const spawnPoint = useCallback((dir: 1 | -1): number => {
    const clearance = geomRef.current.carHalf + 0.04;
    return dir > 0 ? -clearance : 1 + clearance;
  }, []);

  const makeCar = useCallback(
    (dir: 1 | -1, overrides: Partial<Car> = {}): Car => ({
      t: spawnPoint(dir),
      speed: randomBetween(modeRef.current.speed),
      fleeing: false,
      doomed: false,
      colour: randomCarColour(),
      ...overrides,
    }),
    [spawnPoint]
  );

  const ensureLane = useCallback(
    (l: number, now: number): LaneTraffic => {
      let traffic = lanesRef.current.get(l);
      if (!traffic) {
        const dir = laneDirection(l);
        traffic = {
          dir,
          cars: [],
          // Stagger the first spawn so a freshly revealed lane is not a wall.
          nextSpawnAt: now + randomBetween(modeRef.current.gap) * 1000 * Math.random(),
        };
        // Seed a car mid-lane so a lane never looks empty the moment it appears.
        if (Math.random() < 0.6) {
          traffic.cars.push(makeCar(dir, { t: 0.2 + Math.random() * 0.6 }));
        }
        lanesRef.current.set(l, traffic);
      }
      return traffic;
    },
    [makeCar]
  );

  /**
   * Advances every visible lane. Cars move at a constant speed scaled by dt, so
   * the board runs at the same pace on any refresh rate.
   *
   * Every car is clamped against the one in front of it, not just at gates —
   * speeds are randomised per car, so without that a fast car would drive
   * straight through a slow one. The clamp is monotonic (a car is never pushed
   * back, only held), which is what keeps a queue from oscillating: a follower
   * pinned behind a leader simply inherits its pace until the road clears.
   */
  const stepTraffic = useCallback(
    (now: number, dt: number, camera: number) => {
      const settled = laneRef.current;
      const { carLen, carHalf } = geomRef.current;
      const first = Math.max(1, Math.floor(camera) - 1);
      const last = Math.floor(camera) + GAME_CONFIG.visibleLanes + 2;

      for (const key of Array.from(lanesRef.current.keys())) {
        if (key < first - 2) lanesRef.current.delete(key);
      }

      for (let l = first; l <= last; l += 1) {
        const traffic = ensureLane(l, now);
        const closed = l <= settled;
        const dir = traffic.dir;
        const ahead = (a: number, b: number) => (dir > 0 ? a > b : a < b);
        // The nose stops at the gate, so the bar is never overlapped.
        const stopLine = gateFraction(l) - dir * (carHalf + 0.008);

        // Leading car first, so followers can clamp against the one ahead.
        traffic.cars.sort((a, b) => (dir > 0 ? b.t - a.t : a.t - b.t));

        if (closed) {
          // Nothing new enters a lane the chicken has claimed.
          traffic.nextSpawnAt = now + randomBetween(modeRef.current.gap) * 1000;
        } else if (now >= traffic.nextSpawnAt) {
          // Hold the spawn if the entry is still occupied, rather than dropping
          // a car on top of the last one.
          const entry = spawnPoint(dir);
          const last_ = traffic.cars[traffic.cars.length - 1];
          if (!last_ || ahead(last_.t, entry + dir * (carLen + FOLLOW_GAP))) {
            traffic.cars.push(makeCar(dir));
            traffic.nextSpawnAt = now + randomBetween(modeRef.current.gap) * 1000;
          } else {
            traffic.nextSpawnAt = now + 120;
          }
        }

        /** Furthest a follower may travel: the tail of the car ahead. */
        let limit: number | null = null;
        for (const car of traffic.cars) {
          const speed = car.speed * (car.fleeing ? 3.2 : 1);
          let next = car.t + dir * speed * dt;

          const holdAtGate =
            closed && !car.doomed && !car.fleeing && !ahead(car.t, stopLine);
          const bound = holdAtGate
            ? limit === null
              ? stopLine
              : ahead(stopLine, limit)
                ? limit
                : stopLine
            : limit;

          if (bound !== null && ahead(next, bound)) {
            // Hold, never shove backwards — a car that spawned tight behind
            // another would otherwise jump back a frame and jitter.
            next = ahead(bound, car.t) ? bound : car.t;
          }

          car.t = next;
          limit = car.t - dir * (carLen + FOLLOW_GAP);
        }

        // Despawn a full car-length clear of the edge it drives off.
        const exit = 1 + carHalf + 0.05;
        const entry = -(carHalf + 0.05);
        traffic.cars = traffic.cars.filter((car) => car.t > entry - 0.1 && car.t < exit);
      }
    },
    [ensureLane, makeCar, spawnPoint]
  );

  const resetTraffic = useCallback(() => {
    lanesRef.current.clear();
    cameraRef.current = 0;
  }, []);

  // ── Round flow ─────────────────────────────────────

  const crash = useCallback(() => {
    if (phaseRef.current !== 'PLAYING') return;
    if (landingTimerRef.current) clearTimeout(landingTimerRef.current);
    landingTimerRef.current = null;
    doomedRef.current = null;
    hopRef.current = null;
    crashAtRef.current = performance.now();
    setHopping(false);
    setPhaseBoth('LOST');
    // The chicken returns to the verge when the round ends.
    visualLaneRef.current = 0;
    setLaneBoth(0);
  }, [setPhaseBoth, setLaneBoth]);

  const startRound = useCallback(() => {
    if (betError) return;
    if (landingTimerRef.current) clearTimeout(landingTimerRef.current);
    landingTimerRef.current = null;
    resetTraffic();
    setLaneBoth(0);
    setLastWin(null);
    setHopping(false);
    visualLaneRef.current = 0;
    hopRef.current = null;
    doomedRef.current = null;
    crashAtRef.current = null;
    setPhaseBoth('PLAYING');
  }, [betError, resetTraffic, setLaneBoth, setPhaseBoth]);

  const cashOut = useCallback(() => {
    if (phaseRef.current !== 'PLAYING') return;
    if (laneRef.current === 0 || hopRef.current || doomedRef.current) return;
    setLastWin(Number((bet * multiplierAt(laneRef.current, modeRef.current.difficulty)).toFixed(2)));
    setPhaseBoth('WON');
  }, [bet, setPhaseBoth]);

  /**
   * One lane right. The roll happens here, before a frame is drawn: on a miss a
   * car is launched into the target lane timed to arrive as the chicken lands,
   * so the collision the player sees is the outcome, not the cause.
   */
  const advance = useCallback(() => {
    if (phaseRef.current !== 'PLAYING') return;
    if (hopRef.current || doomedRef.current) return;

    const from = laneRef.current;
    const to = from + 1;
    const now = performance.now();
    hopRef.current = { from, to, startedAt: now };
    setHopping(true);

    const survived = Math.random() < crossingChanceAt(modeRef.current.difficulty);
    const traffic = ensureLane(to, now);

    if (!survived) {
      const speed = randomBetween(modeRef.current.speed);
      const travel = speed * (HOP_MS / 1000);
      const { carHalf, chickenHalf } = geomRef.current;
      // Placed so the car's *nose* — not its centre — reaches the chicken's box
      // exactly as the hop lands. With the sprites this large the difference is
      // half a car, which is the gap between a hit on landing and one that
      // fires while the bird is still mid-air.
      traffic.cars.push({
        t: LAYOUT.chickenY - traffic.dir * (travel + carHalf + chickenHalf),
        speed,
        fleeing: false,
        doomed: true,
        colour: randomCarColour(),
      });
      doomedRef.current = { lane: to, at: now + HOP_MS };
      return;
    }

    landingTimerRef.current = setTimeout(() => {
      landingTimerRef.current = null;
      if (phaseRef.current !== 'PLAYING') return;
      hopRef.current = null;
      visualLaneRef.current = to;
      setHopping(false);
      // The lane is now the chicken's, so it is cleared of traffic outright.
      //
      // Holding cars at the gate looked wrong in two ways: a queue pressed up
      // against the barrier read as cars driving *through* it, and anything
      // already past the gate was left crawling over the line the chicken is
      // standing on. Emptying the lane is what "closed" should look like, and
      // `closed` already stops the lane respawning, so nothing refills it.
      //
      // Cars past the gate are set fleeing first: they are downstream of the
      // barrier and drive themselves off, which covers the frame where the rest
      // disappear behind the bar slamming down.
      const gate = gateFraction(to);
      const escaping = traffic.cars.filter((car) =>
        traffic.dir > 0 ? car.t >= gate : car.t <= gate
      );
      for (const car of escaping) car.fleeing = true;
      traffic.cars = escaping;
      setLaneBoth(to);
    }, HOP_MS);
  }, [ensureLane, setLaneBoth]);

  // Arrow keys / W, as well as the on-screen control and the canvas itself.
  useEffect(() => {
    if (!isPlaying) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === 'ArrowUp' ||
        event.key === 'ArrowRight' ||
        event.key === 'd' ||
        event.key === 'D' ||
        event.key === 'w' ||
        event.key === 'W'
      ) {
        event.preventDefault();
        advance();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPlaying, advance]);

  // ── Renderer ───────────────────────────────────────
  const draw = useCallback(
    ({ ctx, width, height, delta }: CanvasFrame) => {
      const now = performance.now();
      const dt = Math.min(delta, 50) / 1000;

      const laneW = width / GAME_CONFIG.visibleLanes;

      // ── Sprite scales, and the lane geometry that follows from them ──
      // Published before the traffic steps, so spawning, following distance,
      // gate stops and the collision box all use the sizes actually drawn.
      const carScale = Math.max(4, Math.min(8, height / 58));
      const chickenScale = Math.max(3, Math.min(6, height / 100));
      // The car sprite is authored along its lane, so `len` is the travel axis.
      const carLenPx = CAR_UNITS.len * carScale;
      const carWidthPx = CAR_UNITS.width * carScale;

      // The chicken's drawn size, decided once and used for both the sprite and
      // its hitbox. Height drives the box and the sprite's own aspect ratio
      // gives the width, so the image is never stretched; the lane cap stops a
      // narrow stage letting the bird spill over the dividers.
      const chickenSprite = chickenSpriteRef.current;
      const spriteAspect = chickenSprite
        ? chickenSprite.width / chickenSprite.height
        : CHICKEN_UNITS.w / CHICKEN_UNITS.h;
      // One formula for both renderers: the bird is the same size on the road
      // whichever is drawing, so switching cannot resize the player.
      const chickenDrawH = Math.min(chickenScale * 11, (laneW * 0.82) / spriteAspect);
      const chickenDrawW = chickenDrawH * spriteAspect;
      // A forgiving hitbox — 0.6 of the drawn size — kept tied to what is
      // actually on screen. Leaving it on the old vector dimensions would let a
      // car pass visibly through the larger sprite before anything registered.
      const chickenBoxW = chickenDrawW * 0.6;
      const chickenBoxH = chickenDrawH * 0.6;
      geomRef.current = {
        carLen: carLenPx / height,
        carHalf: carLenPx / height / 2,
        chickenHalf: chickenBoxH / height / 2,
      };

      // ── Camera: keeps the chicken ~1.4 lanes in from the left edge ──
      const hop = hopRef.current;
      if (hop) {
        const t = Math.min(1, (now - hop.startedAt) / HOP_MS);
        const smooth = t * t * (3 - 2 * t);
        visualLaneRef.current = hop.from + (hop.to - hop.from) * smooth;
        if (t >= 1 && !doomedRef.current) hopRef.current = null;
      }
      const target = Math.max(0, visualLaneRef.current - 1.4);
      cameraRef.current += (target - cameraRef.current) * Math.min(1, dt * 7);
      const camera = cameraRef.current;

      /** Left edge of a lane in screen px; lane 0 is the starting verge. */
      const laneLeft = (l: number) => (l - camera) * laneW;
      const laneCentre = (l: number) => (l + 0.5 - camera) * laneW;

      // The overlay reads these, so coins and gates scroll with the asphalt.
      const stage = stageRef.current;
      if (stage) {
        stage.style.setProperty('--chr-lane', `${laneW}px`);
        stage.style.setProperty('--chr-cam', camera.toFixed(4));
      }

      stepTraffic(now, dt, camera);

      // ── Ground ──
      const roadLeft = laneLeft(1);
      ctx.fillStyle = '#6f9e57';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#3f4653';
      ctx.fillRect(roadLeft, 0, width - roadLeft, height);
      ctx.fillStyle = 'rgba(0,0,0,.10)';
      for (let x = Math.max(0, roadLeft); x < width; x += 6) {
        ctx.fillRect(x, 0, 1, height);
      }

      const dash = (x: number, colour: string, on: number, off: number, lw: number) => {
        if (x < -4 || x > width + 4) return;
        ctx.strokeStyle = colour;
        ctx.lineWidth = lw;
        ctx.setLineDash([on, off]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.setLineDash([]);
      };

      const firstLane = Math.max(1, Math.floor(camera));
      const lastLane = Math.floor(camera) + GAME_CONFIG.visibleLanes + 1;
      // Yellow kerb line where the asphalt starts, white dividers between lanes.
      dash(roadLeft + 2, '#e0b055', 26, 18, 4);
      for (let l = Math.max(2, firstLane); l <= lastLane; l += 1) {
        dash(laneLeft(l), 'rgba(255,255,255,.85)', 16, 14, 2);
      }

      // ── Cars ──
      for (let l = firstLane - 1; l <= lastLane + 1; l += 1) {
        const traffic = lanesRef.current.get(l);
        if (!traffic) continue;
        const cx = laneCentre(l);
        if (cx < -laneW || cx > width + laneW) continue;
        for (const car of traffic.cars) {
          // `cx` is the lane centre and never varies with `car.t`: every car
          // travels a strictly vertical line from edge to edge.
          drawCar(ctx, cx, car.t * height, carScale, car.colour, traffic.dir);
        }
      }

      // ── Chicken ──
      const hopAge = hop ? now - hop.startedAt : Infinity;
      const lift = hopAge < HOP_MS ? Math.sin((hopAge / HOP_MS) * Math.PI) * 18 : 0;
      // The coin badges are centred on this same line, so a landed hop puts the
      // sprite dead centre of the lane's coin rather than under or below it.
      const chickenY = height * LAYOUT.chickenY - lift;
      const chickenX = laneCentre(visualLaneRef.current);

      // Shadow and bird are both painted on the foreground canvas so they sit
      // above the hatch covers; only their geometry is settled here.
      const shadowY = height * LAYOUT.chickenY + chickenDrawH * 0.46;
      chickenShadowRef.current = { y: shadowY, drawW: chickenDrawW, drawH: chickenDrawH, lift };

      // The bird itself is painted by the foreground canvas, above the hatch
      // overlay. Only its position is settled here, where the camera lives.
      chickenScreenRef.current = {
        x: chickenX,
        y: chickenY,
        boxH: chickenDrawH,
        seconds: now / 1000,
      };

      // The sprite is the step control, so its hit target rides along with it.
      if (stage) {
        stage.style.setProperty('--chr-chick-x', `${chickenX.toFixed(1)}px`);
        stage.style.setProperty('--chr-chick-y', `${chickenY.toFixed(1)}px`);
      }

      // ── Collision ──
      // Only the doomed car can land a hit; every other lane the chicken stands
      // in is gated shut, so nothing else is in reach.
      const doomed = doomedRef.current;
      if (phaseRef.current === 'PLAYING' && doomed) {
        const traffic = lanesRef.current.get(doomed.lane);
        const car = traffic?.cars.find((c) => c.doomed);
        if (car && traffic) {
          // Boxes are the drawn sprites: carWidthPx across the lane by
          // carLenPx along it, both taken from the same scale the car was
          // rendered at, so a bigger car has a bigger hitbox.
          const overlaps =
            Math.abs(laneCentre(doomed.lane) - chickenX) < (carWidthPx + chickenBoxW) / 2 &&
            Math.abs(car.t * height - height * LAYOUT.chickenY) <
              (carLenPx + chickenBoxH) / 2;
          if (overlaps) crash();
        } else if (now > doomed.at + 500) {
          // The car left the board without connecting; the roll still stands.
          crash();
        }
      }

      // ── Crash burst ──
      if (crashAtRef.current !== null) {
        const age = now - crashAtRef.current;
        if (age < 700) {
          const t = age / 700;
          ctx.fillStyle = `rgba(239,68,68,${0.35 * (1 - t)})`;
          ctx.fillRect(0, 0, width, height);
          ctx.beginPath();
          ctx.arc(laneCentre(0), height * LAYOUT.chickenY, 12 + t * 70, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,220,180,${0.9 * (1 - t)})`;
          ctx.lineWidth = 5 * (1 - t) + 1;
          ctx.stroke();
        } else {
          crashAtRef.current = null;
        }
      }
    },
    [crash, stepTraffic]
  );

  // Every sprite on this board is a vector path, so it costs nothing to render
  // it at the display's full pixel ratio — that is what keeps the cars, lane
  // markings and the chicken from looking stepped on a retina screen.
  const canvasRef = useCanvasRenderer(draw, { maxPixelRatio: 3 });

  /**
   * Foreground pass: the bird and its shadow, over the hatch covers.
   *
   * Reads only what the road pass published, so the two layers can never
   * disagree about where the chicken is — there is one camera, and it lives in
   * the pass above.
   */
  const drawForeground = useCallback(
    ({ ctx, width, height }: CanvasFrame) => {
      ctx.clearRect(0, 0, width, height);

      const { y: shadowY, drawW, drawH, lift } = chickenShadowRef.current;
      if (drawH <= 0) return;
      const { x, y, boxH, seconds } = chickenScreenRef.current;

      const liftRatio = Math.min(1, lift / 18);
      const shadowRx = drawW * 0.34 * (1 - liftRatio * 0.3);
      const shadowRy = drawH * 0.085 * (1 - liftRatio * 0.3);
      const shade = ctx.createRadialGradient(x, shadowY, 0, x, shadowY, shadowRx);
      shade.addColorStop(0, `rgba(8,12,20,${0.34 * (1 - liftRatio * 0.45)})`);
      shade.addColorStop(0.6, `rgba(8,12,20,${0.2 * (1 - liftRatio * 0.45)})`);
      shade.addColorStop(1, 'rgba(8,12,20,0)');
      ctx.save();
      ctx.translate(x, shadowY);
      ctx.scale(1, shadowRy / shadowRx);
      ctx.translate(-x, -shadowY);
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.arc(x, shadowY, shadowRx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const sprite = chickenSpriteRef.current;
      if (sprite) drawChickenSprite(ctx, sprite, x, y, boxH);
      else drawChicken(ctx, x, y, boxH, seconds);
    },
    []
  );

  const foregroundRef = useCanvasRenderer(drawForeground, { maxPixelRatio: 3 });

  const canStep = isPlaying && !hopping;
  const canCash = isPlaying && lane > 0 && !hopping;

  return (
    <div className="chr">
      {/* ---------- Stage ---------- */}
      <div className="chr__stage" ref={stageRef}>
        <canvas ref={canvasRef} className="chr__canvas" />

        {/* Coins and gates sit above the canvas but take no pointer events, so
            they can never swallow a tap meant for the chicken. Their positions
            come from the same camera the canvas draws with. */}
        <div className="chr__overlay" aria-hidden="true">
          {laneList.map((l) => (
            <div
              key={`coin-${l}`}
              className="chr__coin-slot"
              style={{ left: `calc((${l + 0.5} - var(--chr-cam)) * var(--chr-lane))` }}
            >
              <div
                className={[
                  'chr__coin',
                  l < lane ? 'chr__coin--cleared' : '',
                  l === lane ? 'chr__coin--stand' : '',
                  isPlaying && l === lane + 1 ? 'chr__coin--next' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {/* The grating gets its own layer: the element and its two
                    pseudo-elements are already spent on the rim, the rivets
                    and the inner ring. */}
                <span className="chr__coin-grate" aria-hidden="true" />
                {/* The payout leads; under it, the odds of ever reaching this
                    lane — which shrink as the ladder climbs, unlike the
                    per-hop rate that used to be printed here. */}
                <span className="chr__coin-mult">
                  {formatMultiplier(multiplierAt(l, mode.difficulty))}x
                </span>
                <span className="chr__coin-pct">
                  {formatChance(cumulativeChanceAt(l, mode.difficulty))}
                </span>
              </div>
            </div>
          ))}

          {laneList.map((l) => (
            <div
              key={`gate-${l}`}
              className="chr__gate-slot"
              style={{
                left: `calc((${l} - var(--chr-cam)) * var(--chr-lane))`,
                top: `${(gateFraction(l) * 100).toFixed(2)}%`,
              }}
            >
              {/* Swings up across the lane once the chicken has claimed it,
                  which is what holds that lane's traffic. */}
              <div className={`chr__gate${l <= lane ? ' chr__gate--down' : ''}`} />
            </div>
          ))}
        </div>

        {/* Painted after the overlay, so the bird is over the hatches. */}
        <canvas ref={foregroundRef} className="chr__canvas chr__canvas--fg" aria-hidden="true" />

        <div className="chr__hud">
          <span className="chr__chip">Lane {lane}</span>
          <span className="chr__chip">{lane === 0 ? money(0) : money(payout)}</span>
        </div>

        {/* Tap the chicken to send it across. The render loop keeps this pinned
            to the sprite, so the hit target is always where the bird is. */}
        <button
          type="button"
          className="chr__chick"
          onClick={advance}
          disabled={!canStep}
          aria-label="Tap the chicken to cross to the next lane"
        />
      </div>

      {/* ---------- Controls ---------- */}
      <div className="chr__panel">
        <div>
          <div className="chr__label">
            <span>Traffic density</span>
            <b>{mode.label}</b>
          </div>
          <div className="chr__modes">
            {TRAFFIC_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`chr__mode${m.id === mode.id ? ' chr__mode--on' : ''}`}
                disabled={isPlaying}
                aria-pressed={m.id === mode.id}
                onClick={() => setMode(m)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="chr__label" htmlFor="chr-bet">
            <span>Bet amount</span>
            <b>{formatMultiplier(multiplier)}x</b>
          </label>
          <div className="chr__inputs">
            <input
              id="chr-bet"
              className="chr__input"
              type="number"
              inputMode="decimal"
              min={GAME_CONFIG.minBet}
              max={GAME_CONFIG.maxBet}
              step={1}
              value={Number.isFinite(bet) ? bet : ''}
              disabled={isPlaying}
              aria-invalid={betError !== null}
              onChange={(e) => setBet(Number(e.target.value))}
            />
            <button
              type="button"
              className="chr__mod"
              disabled={isPlaying}
              aria-label="Halve bet amount"
              onClick={() =>
                setBet((b) => Math.max(GAME_CONFIG.minBet, Number((b / 2).toFixed(2))))
              }
            >
              ½
            </button>
            <button
              type="button"
              className="chr__mod"
              disabled={isPlaying}
              aria-label="Double bet amount"
              onClick={() => setBet((b) => Math.min(maxBet, Number((b * 2).toFixed(2))))}
            >
              2x
            </button>
            <button
              type="button"
              className="chr__mod"
              disabled={isPlaying}
              aria-label="Bet maximum"
              onClick={() => setBet(maxBet)}
            >
              Max
            </button>
          </div>
        </div>

        {!isPlaying && betError && <p className="chr__error">{betError}</p>}

        {phase === 'LOST' && (
          <div className="chr__banner chr__banner--lost" role="status">
            Hit by a car — the round ends here
          </div>
        )}
        {phase === 'WON' && (
          <div className="chr__banner chr__banner--won" role="status">
            Cashed out {money(lastWin ?? 0)}
          </div>
        )}

        {isPlaying ? (
          <button
            type="button"
            className="chr__action chr__action--cash"
            onClick={cashOut}
            disabled={!canCash}
          >
            Cash Out ({money(payout)})
          </button>
        ) : (
          <button
            type="button"
            className="chr__action"
            onClick={startRound}
            disabled={betError !== null}
          >
            {isOver ? 'Play Again' : 'Start Round'}
          </button>
        )}

        <p className="chr__hint">
          {isPlaying
            ? 'Tap the chicken, or press Arrow Right / D — the road never ends'
            : 'Cross a lane to unlock cash out'}
        </p>
      </div>
    </div>
  );
}
