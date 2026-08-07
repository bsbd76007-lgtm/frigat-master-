'use client';

/**
 * FRIGAT — Road surface decor
 *
 * Drain grates and manhole covers scattered down each lane, so the asphalt has
 * texture instead of reading as six empty gutters.
 *
 * ── Why the placement is hashed, not random ────────────────────────────────
 * `Math.random()` here would re-roll on every render — and this component
 * re-renders on every step, every difficulty change and every balance tick.
 * The road would visibly reshuffle underneath the player mid-round, which
 * looks broken and, worse, implies the road itself is being regenerated.
 *
 * So positions come from a hash of the lane index: stable for the life of the
 * board, different between lanes, and free of any React state. Lane 3 always
 * has its grate in the same place.
 *
 * This is decoration only. It carries no game meaning — a hatch never marks a
 * safe or blocked lane, because the road is decided server-side and this layer
 * has no access to it.
 */

import { drainGrateDataUri } from '@/components/games/DrainGrateSVG';

/** Lanes drawn. Matches VISIBLE_LANES in ChickenLanes. */
const LANES = 6;

/**
 * Built once at module scope: the markup is constant, so rebuilding it per
 * render would hand the browser a new `url(...)` each time and defeat its
 * image cache.
 */
const GRATE_URI = drainGrateDataUri(false);

/**
 * Deterministic 0..1 from an integer, via a cheap integer hash (xorshift-ish).
 * Only needs to look unpatterned across six lanes, so a full PRNG is overkill.
 */
function hash01(n: number): number {
  let x = (n + 1) * 2654435761;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519);
  x ^= x >>> 13;
  return ((x >>> 0) % 10000) / 10000;
}

interface Hatch {
  top: number;
  left: number;
  kind: 'grate' | 'manhole';
  scale: number;
  rotate: number;
}

/**
 * One or two hatches per lane, placed from the lane's own hash.
 *
 * Kept clear of the vertical centre band where the payout column sits, so the
 * decor never sits behind the figures a player is reading.
 */
function hatchesFor(lane: number): Hatch[] {
  const a = hash01(lane);
  const b = hash01(lane * 31 + 7);
  const c = hash01(lane * 17 + 3);

  const hatches: Hatch[] = [
    {
      top: 6 + a * 22,
      left: 12 + b * 20,
      kind: a > 0.5 ? 'grate' : 'manhole',
      scale: 0.8 + c * 0.3,
      rotate: b > 0.5 ? 0 : 90,
    },
  ];

  // Roughly half the lanes get a second one, so the road is uneven rather
  // than regularly dotted.
  if (c > 0.45) {
    hatches.push({
      top: 68 + b * 24,
      left: 58 + a * 24,
      kind: b > 0.5 ? 'manhole' : 'grate',
      scale: 0.7 + a * 0.3,
      rotate: c > 0.7 ? 90 : 0,
    });
  }

  return hatches;
}

export interface ChickenRoadDecorProps {
  windowStart: number;
}

export function ChickenRoadDecor({ windowStart }: ChickenRoadDecorProps) {
  return (
    <div className="decor" aria-hidden="true">
      {Array.from({ length: LANES }, (_, i) => {
        const lane = windowStart + i;
        return (
          <div className="decor__lane" key={i}>
            {hatchesFor(lane).map((h, j) => (
              <span
                key={j}
                className={`decor__hatch decor__hatch--${h.kind}`}
                style={{
                  top: `${h.top}%`,
                  left: `${h.left}%`,
                  transform: `translate(-50%, -50%) rotate(${h.rotate}deg) scale(${h.scale})`,
                  ...(h.kind === 'grate'
                    ? { backgroundImage: `url("${GRATE_URI}")` }
                    : null),
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default ChickenRoadDecor;
