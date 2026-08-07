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

import { formatDecimalString } from '@/lib/decimal';
interface Winner {
  id: string;
  username: string;
  gameType: string;
  payout: string;
  multiplier: number;
}

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

const MAX_WINNERS = 8;

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
  const { socket } = useGameSocket();
  const jackpots = useJackpots();
  const [winners, setWinners] = useState<Winner[]>([]);

  const { subscribe } = socket;

  useEffect(() => {
    return subscribe('LIVE_BET', (data) => {
      const payout = String(data.payout ?? '0');
      const multiplier =
        typeof data.multiplier === 'number' ? data.multiplier : 0;
      if (Number(payout) <= 0 || multiplier <= 1) return;

      setWinners((prev) =>
        [
          {
            id:
              typeof data.betId === 'string'
                ? data.betId
                : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            username: String(data.username ?? 'player'),
            gameType: String(data.gameType ?? 'GAME'),
            payout,
            multiplier,
          },
          ...prev,
        ].slice(0, MAX_WINNERS)
      );
    });
  }, [subscribe]);

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

      <section className="dock__panel">
        <h2 className="dock__title">
          <span className="dock__pulse" aria-hidden="true" />
          Live wins
        </h2>
        {winners.length === 0 ? (
          <p className="dock__empty">
            Waiting for the next win to come through…
          </p>
        ) : (
          <ul className="dock__winners">
            {winners.map((winner) => (
              <li key={winner.id} className="dock__winner">
                <span className="dock__winner-who">
                  <b>{winner.username}</b>
                  <small>{winner.gameType}</small>
                </span>
                <span className="dock__winner-amt">
                  <b>${formatDecimalString(winner.payout, 2)}</b>
                  <small>{winner.multiplier.toFixed(2)}×</small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="dock__note">
        Jackpot figures are illustrative — FRIGAT does not currently run a
        progressive pool. Live wins are real, streamed from the game socket.
      </p>
    </aside>
  );
}

export default JackpotDock;
