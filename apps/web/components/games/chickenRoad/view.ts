/**
 * Chicken Road — the camera.
 *
 * The board is simulated flat and drawn in perspective. World coordinates are
 * the ones the round logic has always used:
 *
 *   u   across the road, in pixels as they measure at the chicken's depth —
 *       lane `l` spans (l - camera) · laneW to (l + 1 - camera) · laneW;
 *   t   along a lane, 0 at the far end to 1 at the near end, the axis traffic
 *       drives down and the collision test reads. One unit of t is
 *       `depthPx` world pixels — longer than the stage is tall, which is what
 *       foreshortens the road into a three-quarter view instead of a map;
 *   h   height above the asphalt, in pixels at the chicken's depth.
 *
 * `project` is a pinhole camera looking down the lanes from above the near
 * end. Distance to a row grows linearly toward the far end, so screen y and
 * the scale factor are both proportional to 1 / distance — which is what keeps
 * every straight edge in the world straight on screen and converging on one
 * vanishing point.
 *
 * Nothing here knows about cars or chickens, and nothing here decides anything:
 * the round is resolved server-side and simulated in flat (u, t) space, and
 * this module only says where on the canvas a point of that space appears.
 */

import { LAYOUT } from './config';

/**
 * World pixels in one lane length, per pixel of stage height. At 2.2 a square
 * on the road at the chicken's row is drawn a little under half as deep as it
 * is wide — roughly a 27° look down the lanes.
 */
export const DEPTH_STRETCH = 2.2;

/** Camera distance to the far (t = 0) and near (t = 1) ends of the road. */
const FAR = 2;
const NEAR = 1;
/** Screen rows, as fractions of stage height, where the road starts and ends. */
const TOP = 0.04;
const BOTTOM = 1;

/**
 * The light every shadow is cast from: high up, far out to the left and a
 * little beyond the far end. A point source rather than a direction, so a
 * shadow swings and stretches as its car drives — the only moving light cue
 * the scene has.
 */
const LIGHT = { u: -1.4, t: -0.6, h: 4.5 } as const;

export interface View {
  width: number;
  height: number;
  laneW: number;
  camera: number;
  /** World pixels in one unit of t. */
  depthPx: number;
  /** Screen x the road converges on. */
  vanishX: number;
  /** Size of one pixel of (u, h) at depth t, relative to the chicken's row. */
  scale(t: number): number;
  /** Screen position of the world point (u, t, h). */
  project(u: number, t: number, h?: number): { x: number; y: number };
  /** World u of a lane's left edge. */
  laneLeft(lane: number): number;
  /** Where the point (u, t, h) casts its shadow on the asphalt, in world (u, t). */
  shadowOf(u: number, t: number, h: number): { u: number; t: number };
}

export function makeView(
  width: number,
  height: number,
  laneW: number,
  camera: number
): View {
  const distance = (t: number) => FAR - (FAR - NEAR) * t;
  const chickenDistance = distance(LAYOUT.chickenY);

  // y = horizon + k / distance, pinned so t = 0 and t = 1 land on TOP and BOTTOM.
  const k = ((BOTTOM - TOP) * height) / (1 / NEAR - 1 / FAR);
  const horizon = TOP * height - k / FAR;
  const vanishX = width / 2;

  const scale = (t: number) => chickenDistance / distance(t);

  const project = (u: number, t: number, h = 0) => {
    const s = scale(t);
    return { x: vanishX + (u - vanishX) * s, y: horizon + k / distance(t) - h * s };
  };

  // The light, in world terms: out to the left of the road and above it.
  const lightU = LIGHT.u * width;
  const lightT = LIGHT.t;
  const lightH = LIGHT.h * height;

  const shadowOf = (u: number, t: number, h: number) => {
    if (h <= 0) return { u, t };
    // Similar triangles from the light through the point down to the ground.
    // One lane length is one stage height, so t and h share units once the
    // ratio is taken and the offset is the same fraction on both axes.
    const f = h / (lightH - h);
    return { u: u + (u - lightU) * f, t: t + (t - lightT) * f };
  };

  return {
    width,
    height,
    laneW,
    camera,
    depthPx: height * DEPTH_STRETCH,
    vanishX,
    scale,
    project,
    laneLeft: (lane: number) => (lane - camera) * laneW,
    shadowOf,
  };
}
