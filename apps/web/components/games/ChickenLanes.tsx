'use client';

import { ChickenSprite } from '@/components/games/ChickenSprite';
import { ChickenTraffic } from '@/components/games/ChickenTraffic';
import { ChickenRoadDecor } from '@/components/games/ChickenRoadDecor';
import { ChickenBarrier } from '@/components/games/ChickenBarrier';
export const VISIBLE_LANES = 6;

export interface ChickenLanesProps {
  crossed: number;
  multipliers: number[];
  amount: string;
  active: boolean;
  hitLane: number | null;
  outcome: 'bust' | 'cashout' | null;
}

type LaneState = 'crossed' | 'next' | 'ahead' | 'hit';

export function ChickenLanes({
  crossed,
  multipliers,
  amount,
  active,
  hitLane,
  outcome,
}: ChickenLanesProps) {
  const stake = Number(amount) || 0;

  const maxStart = Math.max(0, multipliers.length - VISIBLE_LANES);
  const start = Math.min(
    Math.max(0, crossed - Math.floor(VISIBLE_LANES / 2)),
    maxStart
  );

  const lanes = Array.from({ length: VISIBLE_LANES }, (_, i) => {
    const lane = start + i;
    const multiplier = multipliers[lane];

    const payout = multiplier === undefined ? stake : stake * multiplier;

    let state: LaneState = 'ahead';
    if (hitLane !== null && lane === hitLane) state = 'hit';
    else if (lane < crossed) state = 'crossed';
    else if (lane === crossed && active) state = 'next';

    return { lane, payout, state, hasMultiplier: multiplier !== undefined };
  });

  return (
    <div className="lanes" role="group" aria-label="Lane payouts">
      {/* Behind the columns: decorative motion only. The traffic never decides
          an outcome — see ChickenTraffic.tsx. */}
      <div className="lanes__stage">
        {/* Road surface first, then traffic over it, then the barriers that
            mark cleared lanes — painted in that order so a car passes over the
            asphalt and under nothing. */}
        <ChickenRoadDecor windowStart={start} />
        <ChickenTraffic
          crossed={crossed}
          active={active}
          impactLane={hitLane}
          windowStart={start}
        />
        <ChickenBarrier crossed={crossed} windowStart={start} />
      <div className="lanes__track">
        {lanes.map(({ lane, payout, state, hasMultiplier }) => (
          <div key={lane} className={`lanes__col lanes__col--${state}`}>
            <div className="lanes__icon" aria-hidden="true">
              {state === 'hit' ? (
                <svg viewBox="0 0 32 32" width="26" height="26">
                  <path
                    d="M9 9l14 14M23 9L9 23"
                    stroke="#ff3b3b"
                    strokeWidth="4.5"
                    strokeLinecap="round"
                  />
                </svg>
              ) : state === 'next' ? (
                <ChickenSprite size={30} />
              ) : state === 'crossed' ? (
                <svg viewBox="0 0 32 32" width="24" height="24">
                  <path
                    d="M8 17l5.5 5.5L24 11"
                    fill="none"
                    stroke="#00e676"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <span className="lanes__dot" />
              )}
            </div>

            <div className="lanes__value">
              <b>${payout.toFixed(2)}</b>
              {hasMultiplier && (
                <small>{multipliers[lane].toFixed(2)}×</small>
              )}
            </div>

            <span className="lanes__num">{lane + 1}</span>
          </div>
        ))}
      </div>
      </div>

      {/* Announced separately because the board itself is decorative markup;
          the page's own role="status" carries the round narration. */}
      {outcome === 'bust' && hitLane !== null && (
        <p className="lanes__note lanes__note--bust">
          Hit in lane {hitLane + 1}.
        </p>
      )}
    </div>
  );
}

export default ChickenLanes;
