'use client';

/**
 * FRIGAT — Lane completion barrier
 *
 * A red-and-white hazard pole that drops across the entrance of each lane the
 * chicken has cleared, with a green checkpoint glow above it.
 *
 * Purely a read-out of `crossed`, which is server state: a barrier appears
 * because the server confirmed a lane was survived. It locks nothing — the
 * player already cannot re-enter a crossed lane, since STEP only ever advances
 * and the server rejects anything else. The barrier makes that rule visible
 * rather than enforcing it.
 *
 * The drop is a CSS transition on `transform`, so it runs on the compositor
 * and costs the animation loop nothing. Each barrier is keyed by lane, so
 * React animates only the newly-completed one instead of re-running every
 * barrier on each step.
 */

/** Lanes drawn. Matches VISIBLE_LANES in ChickenLanes. */
const LANES = 6;

export interface ChickenBarrierProps {
  crossed: number;
  windowStart: number;
}

export function ChickenBarrier({ crossed, windowStart }: ChickenBarrierProps) {
  return (
    <div className="barrier" aria-hidden="true">
      {Array.from({ length: LANES }, (_, i) => {
        const lane = windowStart + i;
        const down = lane < crossed;
        const latest = lane === crossed - 1;

        return (
          <div className="barrier__lane" key={lane}>
            <div
              className={`barrier__pole${down ? ' barrier__pole--down' : ''}`}
            >
              <span className="barrier__stripes" />
            </div>
            {down && (
              <span
                className={`barrier__check${latest ? ' barrier__check--live' : ''}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ChickenBarrier;
