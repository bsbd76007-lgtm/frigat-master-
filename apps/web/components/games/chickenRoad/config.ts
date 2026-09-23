/**
 * Chicken Road — configuration, board geometry and the odds.
 *
 * Split out of the component so the paytable can be read without loading a
 * canvas. Everything here is pure: no DOM, no React, no drawing.
 *
 * The odds are not decided here. The server engine
 * (apps/server/src/engines/chicken.engine.ts) rolls every hop from the round's
 * seed; the hazards come from `CHICKEN` in @frigat/shared and the ladder from
 * lib/verify.ts, which the fairness parity test pins to the engine. This file
 * only turns them into what the board displays.
 */

import { CHICKEN, chickenHazardAt, type ChickenMode } from '@frigat/shared/constants';

import { chickenMaxLanes, chickenMinCashoutLane, chickenMultiplierAt } from '@/lib/verify';

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────

export const GAME_CONFIG = {
  minBet: 1,
  maxBet: 1000,
  currency: '$',
  /** Lanes across the stage; the camera scrolls, the lane count does not cap. */
  visibleLanes: 5,
  /** Lanes kept rendered ahead of the chicken — perspective shows more of them. */
  lookahead: 8,
  /** Lanes kept rendered behind the chicken. */
  lookbehind: 2,
  /** Cash out only unlocks once this lane is reached. */
  minCashoutLane: 5,
} as const;

export type Phase = 'IDLE' | 'PLAYING' | 'WON' | 'LOST';

export interface TrafficMode {
  id: ChickenMode;
  label: string;
  /**
   * Peak chance a crossing fails — the rate the hazard ramps up to after the
   * first few lanes (see `chickenHazardAt`). Drives the traffic's look.
   */
  difficulty: number;
  /** Seconds between spawns in an open lane. */
  gap: readonly [number, number];
  /** Lane lengths per second. */
  speed: readonly [number, number];
}

/**
 * Difficulty is the hazard rate, so the selector reads as "how much traffic".
 * Spawn gap and speed rise with it, which is what keeps the board looking like
 * the odds it is paying. Speeds are lane lengths per second: the far end to the
 * near end in about a second and a half on medium, and a little under a second
 * on extreme — a third quicker than the board first shipped with, which read as
 * sedate for a game whose whole tension is the gap between two cars.
 */
export const TRAFFIC_MODES: readonly TrafficMode[] = [
  mode('low', [2.2, 3.4], [0.47, 0.68]),
  mode('medium', [1.5, 2.5], [0.57, 0.81]),
  mode('high', [0.9, 1.6], [0.73, 1.04]),
  mode('extreme', [0.5, 1.0], [0.91, 1.3]),
] as const;

/** The hazard is the server's; only the traffic's look is chosen here. */
function mode(
  id: ChickenMode,
  gap: readonly [number, number],
  speed: readonly [number, number]
): TrafficMode {
  const difficulty = CHICKEN.modes[id].hazard;
  return { id, label: `${Math.round(difficulty * 100)}%`, difficulty, gap, speed };
}

export const DEFAULT_MODE = TRAFFIC_MODES[1];

/**
 * The board's art resolution: one art pixel is a PIXEL_SIZE-square block of
 * screen pixels. The world is rendered into a buffer this many times smaller
 * and blitted back with smoothing off (see `useCanvasRenderer`).
 *
 * 4 is the size where the road markings, the cars and the chicken all survive:
 * at 6 the chicken loses its beak and the lane covers turn into discs, and at 2
 * the picture reads as "slightly crunchy" rather than as pixel art.
 */
export const PIXEL_SIZE = 4;

/**
 * Steps per colour channel after pixelation — now off.
 *
 * Quantising was doing the job a palette does, and doing it blindly. Every
 * fill on this board comes from the fixed set in `pixel.ts`, so the colour
 * count is already decided by hand; running the posteriser over that snapped
 * those chosen colours to the nearest tenth and reintroduced the banding it
 * was there to prevent — worst on the sky and the road, where a deliberate
 * four-step ramp beat against the quantiser's ten and came out as mud.
 *
 * It also cost a full readback of the buffer every frame, which is why the
 * buffer context no longer asks for `willReadFrequently`.
 */
export const COLOR_LEVELS = 0;

/** Milliseconds a hop takes; the crash car is timed against this. */
export const HOP_MS = 320;

/**
 * Board geometry as fractions of the stage. The canvas and the DOM overlay both
 * derive from these, so coins and gates can never drift off the asphalt.
 */
export const LAYOUT = {
  /**
   * The row the chicken walks, along the lane. Past the middle on purpose: in
   * perspective the far half of the road is compressed, and this puts the
   * chicken just below mid-screen with the oncoming traffic filling the rest.
   */
  chickenY: 0.6,
  /** Where a gate stops downward traffic, and (mirrored) upward traffic. */
  gateY: 0.42,
} as const;

/**
 * Sprite dimensions along the travel axis, as fractions of stage height. They
 * fall out of the drawn scale rather than being guessed, so spawn points,
 * despawn points, following distance and the collision box all stay tied to how
 * big the cars actually are. Seeded with the values for a typical stage and
 * refreshed every frame from the live scale.
 */
export interface Geometry {
  /** Full car length along the lane. */
  carLen: number;
  /** Half a car, i.e. nose or tail to centre. */
  carHalf: number;
  /** Half the chicken's collision box along the lane. */
  chickenHalf: number;
}

export const SEED_GEOMETRY: Geometry = { carLen: 0.14, carHalf: 0.07, chickenHalf: 0.02 };

/** Clear air kept between a car's tail and the nose of the one behind it. */
export const FOLLOW_GAP = 0.03;

/**
 * Every lane flows the same way — top to bottom. Kept as a function because the
 * traffic model still carries a signed direction, so one-way is a policy here
 * rather than an assumption baked through the physics.
 */
export function laneDirection(_lane: number): 1 | -1 {
  return 1;
}

/**
 * The stop line a gate imposes on its lane, in travel-axis fractions. It has to
 * sit upstream of the crossing line: traffic arrives from the top, so a gate
 * below the chicken would let cars drive through it before stopping.
 */
export function gateFraction(lane: number): number {
  return laneDirection(lane) > 0 ? LAYOUT.gateY : 1 - LAYOUT.gateY;
}

/** Multiplier once `lane` lanes are behind the chicken — the server's ladder. */
export function multiplierAt(lane: number, trafficMode: TrafficMode): number {
  return chickenMultiplierAt(trafficMode.id, lane);
}

/**
 * The first lane cash out opens on — the first paying CHICKEN.minCashoutMultiplier.
 * The server refuses a CASHOUT below it; the board only mirrors that.
 */
export function unlockLane(trafficMode: TrafficMode): number {
  return chickenMinCashoutLane(trafficMode.id);
}

/** The road's last lane for a mode; reaching it cashes out automatically. */
export function lastLane(trafficMode: TrafficMode): number {
  return chickenMaxLanes(trafficMode.id);
}

/** Chance of clearing the hop into `lane`. Rises to its floor after the ramp. */
export function crossingChanceAt(lane: number, trafficMode: TrafficMode): number {
  return 1 - chickenHazardAt(trafficMode.id, lane);
}

/**
 * Chance of reaching `lane` from the verge — the *cumulative* survival odds,
 * the product of every hop's chance, not the per-hop rate.
 *
 * The per-hop number flattens out after the first few lanes, so printing it on
 * each tile said nothing about how far the player had gone: a row of identical
 * "75%" badges reads as a fixed chance of winning the whole run. The cumulative
 * figure is the one that actually falls away as the ladder climbs, and it is
 * the exact complement of the multiplier beside it (`rtp / Π p`).
 */
export function cumulativeChanceAt(lane: number, trafficMode: TrafficMode): number {
  let chance = 1;
  for (let k = 1; k <= lane; k += 1) chance *= crossingChanceAt(k, trafficMode);
  return chance;
}

export function money(value: number): string {
  return `${GAME_CONFIG.currency}${value.toFixed(2)}`;
}

/** Ladders on the harder modes outgrow a fixed-width badge within a few lanes. */
export function formatMultiplier(value: number): string {
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
export function formatChance(chance: number): string {
  const pct = chance * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

export function randomBetween([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}
