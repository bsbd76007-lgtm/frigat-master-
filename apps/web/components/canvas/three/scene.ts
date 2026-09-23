/**
 * The shared 3D camera for the game boards.
 *
 * This is Chicken Road's road camera (components/games/chickenRoad/view.ts)
 * with the road taken out of it. That board proved the approach — a flat
 * simulation drawn through a pinhole projection reads as depth without a WebGL
 * context, a mesh or a depth buffer — and every other board now wants the same
 * look, so the maths lives here once.
 *
 * World coordinates:
 *
 *   x  across the board, in CSS pixels **as they measure at the focus row**,
 *      sharing the canvas's origin — so x = 0 is the left edge and x = width
 *      the right edge of that one row, and rows nearer the camera overhang it;
 *   y  into the board, 0 at the far edge to 1 at the near edge. One unit of y
 *      is `depthPx` world pixels, deliberately longer than the stage is tall:
 *      that is what foreshortens a board into a three-quarter view instead of
 *      flattening it into a map;
 *   z  height above the board floor, in pixels at the focus row.
 *
 * Distance to a row grows linearly toward the far edge, so screen y and the
 * scale factor are both proportional to 1 / distance. That is what keeps every
 * straight edge in the world straight on screen and converging on a single
 * vanishing point — the property that makes the extruded boxes in `solids.ts`
 * line up with each other for free.
 *
 * Nothing here decides anything. Outcomes are resolved server-side; a scene
 * only says where on the canvas a point of world space appears.
 */

/** A point on the canvas, in CSS pixels. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** A point of world space. */
export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

export interface Scene {
  width: number;
  height: number;
  /** World pixels in one unit of y. */
  depthPx: number;
  /** Screen x that every depth edge converges on. */
  vanishX: number;
  /** The row where one world pixel is one CSS pixel. */
  focus: number;
  /** Size of one pixel of (x, z) at depth y, relative to the focus row. */
  scale(y: number): number;
  /** Screen position of the world point (x, y, z). */
  project(x: number, y: number, z?: number): ScreenPoint;
  /** Where (x, y, z) casts its shadow on the floor, in world (x, y). */
  shadowOf(x: number, y: number, z: number): { x: number; y: number };
  /** Screen y of the horizon — above every row, so nothing should be drawn there. */
  horizon: number;
}

export interface SceneOptions {
  /** Camera distance to the far (y = 0) edge. Larger is a flatter board. */
  far?: number;
  /** Camera distance to the near (y = 1) edge. */
  near?: number;
  /** Fraction of stage height the far edge sits at. */
  top?: number;
  /** Fraction of stage height the near edge sits at. */
  bottom?: number;
  /** Row that renders at 1:1 scale. */
  focus?: number;
  /** Screen x the board converges on, as a fraction of width. */
  vanish?: number;
  /**
   * World pixels in one unit of y, per pixel of stage height. At 2.2 a square
   * on the floor at the focus row draws a little under half as deep as it is
   * wide — roughly a 27° look down the board.
   */
  depthStretch?: number;
  /**
   * The light every shadow is cast from: `x` as a fraction of width, `y` in
   * depth units, `z` as a fraction of height. A point source rather than a
   * direction, so a shadow swings and stretches as the thing casting it moves.
   * The default sits high up, out to the left and a little beyond the far edge,
   * which is what makes the left flank of every box the lit one.
   */
  light?: WorldPoint;
}

const DEFAULTS: Required<SceneOptions> = {
  far: 2,
  near: 1,
  top: 0.06,
  bottom: 0.98,
  focus: 0.5,
  vanish: 0.5,
  depthStretch: 2.2,
  light: { x: -1.4, y: -0.6, z: 4.5 },
};

export function makeScene(
  width: number,
  height: number,
  options: SceneOptions = {}
): Scene {
  const { far, near, top, bottom, focus, vanish, depthStretch, light } = {
    ...DEFAULTS,
    ...options,
  };

  const distance = (y: number) => far - (far - near) * y;
  const focusDistance = distance(focus);

  // screenY = horizon + k / distance, pinned so y = 0 and y = 1 land on the
  // `top` and `bottom` fractions of the stage.
  const k = ((bottom - top) * height) / (1 / near - 1 / far);
  const horizon = top * height - k / far;
  const vanishX = width * vanish;

  const scale = (y: number) => focusDistance / distance(y);

  const project = (x: number, y: number, z = 0): ScreenPoint => {
    const s = scale(y);
    return {
      x: vanishX + (x - vanishX) * s,
      y: horizon + k / distance(y) - z * s,
    };
  };

  const lightX = light.x * width;
  const lightY = light.y;
  const lightZ = light.z * height;

  const shadowOf = (x: number, y: number, z: number) => {
    if (z <= 0) return { x, y };
    // Similar triangles, from the light through the point down to the floor.
    // One unit of y is one stage height of world pixels, so y and z share
    // units once the ratio is taken and the offset is the same fraction of
    // both axes.
    const f = z / (lightZ - z);
    return { x: x + (x - lightX) * f, y: y + (y - lightY) * f };
  };

  return {
    width,
    height,
    depthPx: height * depthStretch,
    vanishX,
    focus,
    horizon,
    scale,
    project,
    shadowOf,
  };
}
