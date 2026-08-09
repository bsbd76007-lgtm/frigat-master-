'use client';

/**
 * FRIGAT — Jackpot ticker & live winners dock
 *
 * The right-hand rail beside the game grid.
 *
 * Honesty note: FRIGAT has no progressive jackpot pool — no schema, no
 * contribution rate, no payout path. The three tiers below are a *display*
 * seeded from a fixed base and drifting upward on a timer, and the dock says
 * so in its footer. They are deliberately not presented as claimable, because
 * a number a player cannot win is the kind of thing that ends up in a
 * regulator's complaint file.
 *
 * The winners feed is the opposite: it is real. LIVE_BET frames already stream
 * over the game socket for the ticker at the bottom of the dashboard, so this
 * subscribes to the same event and keeps the winning ones.
 */

import { useEffect, useMemo, useState } from 'react';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import LiveBetsFeed from '@/components/feed/LiveBetsFeed';

const JACKPOT_SEED = {
  grand: 184_000,
  major: 21_400,
  minor: 2_180,
} as const;

const DRIFT_PER_SECOND = {
  grand: 0.02,
  major: 0.008,
  minor: 0.003,
} as const;

const TIERS = [
  { id: 'grand', label: 'Grand', tone: 'grand' },
  { id: 'major', label: 'Major', tone: 'major' },
  { id: 'minor', label: 'Minor', tone: 'minor' },
] as const;


function useJackpots() {
  // Ticks once a second. Seeded from a constant rather than Math.random() so
  // the server and client agree on the first paint — a random initial value
  // would be a hydration mismatch.
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return useMemo(
    () =>
      TIERS.map((tier) => ({
        ...tier,
        value: JACKPOT_SEED[tier.id] + DRIFT_PER_SECOND[tier.id] * elapsed,
      })),
    [elapsed]
  );
}

export function JackpotDock() {
  const jackpots = useJackpots();



  return (
    <aside className="dock" aria-label="Jackpots and recent winners">
      <section className="dock__panel">
        <h2 className="dock__title">Jackpots</h2>
        <div className="dock__jackpots">
          {jackpots.map((tier) => (
            <div key={tier.id} className={`dock__jp dock__jp--${tier.tone}`}>
              <span className="dock__jp-label">{tier.label}</span>
              {/* tabular-nums in CSS keeps the digits from jittering as the
                  value climbs — a proportional font reflows every tick. */}
              <b className="dock__jp-value">
                ${tier.value.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </b>
            </div>
          ))}
        </div>
      </section>

      {/* The live-bets feed itself, rather than a second winners list: this
          panel used to subscribe to the same LIVE_BET frames the feed already
          consumes, so two components rendered one stream. */}
      <LiveBetsFeed compact />
    </aside>
  );
}

export default JackpotDock;
