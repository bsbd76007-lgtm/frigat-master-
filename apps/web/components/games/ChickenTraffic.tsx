'use client';

/**
 * FRIGAT — Chicken Road traffic
 *
 * Cars sliding across the six lanes on a requestAnimationFrame loop, each with
 * its own speed and direction.
 *
 * ── What the traffic does and does not decide ──────────────────────────────
 * Nothing here detects a collision, because a collision here would not mean
 * anything. The road is fixed at bet time from the server seed — `isBlocked`
 * has already decided every lane before the first frame renders — so a car's
 * on-screen position cannot make a lane safe or fatal. If pixel overlap
 * decided the outcome, anyone with devtools could pause the loop and walk
 * across untouched.
 *
 * So the arrow points the other way: the server says which lane ends the
 * round, and this module makes the car in that lane *arrive* at the chicken.
 * `impactLane` is set from GAME_RESULT, and the car in that lane snaps to a
 * timeline that puts it at the crossing point. The player sees a car hit the
 * chicken; the car was never the reason.
 *
 * Motion is time-based (`delta` in seconds), not per-frame, so a 144Hz screen
 * and a 60Hz screen show the same speeds.
 */

import { useEffect, useRef } from 'react';
import { redCarDataUri } from '@/components/games/RedCarSVG';

/** Lanes drawn. Matches VISIBLE_LANES in ChickenLanes. */
const LANES = 6;

/** Car height in px; must match `.traffic__car` height in globals.css. */
const CAR_H = 60;

/**
 * Built once at module scope rather than per render.
 *
 * The markup is a pure function of nothing, so rebuilding the string on each
 * render was pure waste — and every rebuild produced a new `url(...)` value,
 * which asks the browser to re-resolve the same image six times. It was never
 * in the rAF loop, so this is tidiness rather than a fix for measured jank.
 */
const CAR_URI = redCarDataUri();

/**
 * Per-lane traffic. Alternating directions and coprime-ish speeds so the lanes
 * never fall into a visible marching lockstep.
 */
interface Lane {
  speed: number;
  dir: 1 | -1;
  offset: number;
}

const TRAFFIC: Lane[] = [
  { speed: 0.42, dir: 1, offset: 0.0 },
  { speed: 0.61, dir: -1, offset: 0.35 },
  { speed: 0.33, dir: 1, offset: 0.7 },
  { speed: 0.54, dir: -1, offset: 0.15 },
  { speed: 0.47, dir: 1, offset: 0.55 },
  { speed: 0.68, dir: -1, offset: 0.85 },
];

export interface ChickenTrafficProps {
  crossed: number;
  active: boolean;
  /**
   * Lane the server ended the round in, or null. The car in this lane is
   * driven to the impact point; it does not cause the loss.
   */
  impactLane: number | null;
  windowStart: number;
}

export function ChickenTraffic({
  crossed,
  active,
  impactLane,
  windowStart,
}: ChickenTrafficProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const carsRef = useRef<HTMLDivElement[]>([]);
  const rafRef = useRef<number | null>(null);

  // Live values read by the loop, so changing them does not restart it — a
  // restart would jump every car back to its start position mid-slide.
  const stateRef = useRef({ crossed, active, impactLane, windowStart });
  stateRef.current = { crossed, active, impactLane, windowStart };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let last = performance.now();
    const progress = TRAFFIC.map((t) => t.offset);

    const frame = (now: number) => {
      // Seconds, and clamped: a backgrounded tab resumes with a huge delta,
      // which would teleport every car across the board in one step.
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;

      const { crossed: at, active: live, impactLane: impact, windowStart: start } =
        stateRef.current;

      for (let i = 0; i < LANES; i += 1) {
        const car = carsRef.current[i];
        if (!car) continue;

        const lane = start + i;

        // The lane the chicken is standing in stays clear, so the sprite is
        // never drawn through it — that reads as a collision the server did
        // not call.
        const standingHere = live && lane === at;

        if (impact !== null && lane === impact) {
          progress[i] = 0.5;
        } else if (standingHere) {
          car.style.opacity = '0';
          continue;
        } else {
          progress[i] = (progress[i] + TRAFFIC[i].speed * delta) % 1;
        }

        // Travel is measured against the LANE, not the car: a percentage
        // transform resolves against the element's own height, which would
        // make a 60px car sweep 60px instead of the column.
        const laneH = car.parentElement?.clientHeight ?? 0;
        const travel = laneH + CAR_H;
        const t = progress[i];
        const y = (TRAFFIC[i].dir === 1 ? t : 1 - t) * travel - CAR_H;
        car.style.opacity = '1';
        car.style.transform =
          `translate3d(0, ${y.toFixed(1)}px, 0) rotate(${TRAFFIC[i].dir === 1 ? 0 : 180}deg)`;
      }

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="traffic" ref={hostRef} aria-hidden="true">
      {Array.from({ length: LANES }, (_, i) => (
        <div className="traffic__lane" key={i}>
          <div
            className="traffic__car"
            ref={(el) => {
              if (el) carsRef.current[i] = el;
            }}
            style={{ backgroundImage: `url("${CAR_URI}")` }}
          />
        </div>
      ))}
    </div>
  );
}

export default ChickenTraffic;
