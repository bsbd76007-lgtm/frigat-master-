'use client';

/**
 * Chicken Road — cross the lanes, bank before the traffic.
 *
 * Multi-step game in the same shape as Mines: BET opens a round (the server
 * debits the stake and fixes the whole road from the seed), STEP advances one
 * lane, CASHOUT settles at the running multiplier.
 *
 * Every outcome comes from the server. The lane board never decides whether a
 * crossing failed — it renders the verdict a STEP_RESULT or GAME_RESULT already
 * carried, and every payout on it comes from the server's own multiplier table.
 * Local collision detection would be trivially editable by anyone with devtools
 * open, and a locally-computed payout would be a number the server never
 * agreed to pay.
 */

import { useEffect, useState } from 'react';

import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { ChickenLanes } from '@/components/games/ChickenLanes';
import { ChickenCashout } from '@/components/games/ChickenCashout';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
const DIFFICULTIES = [
  { id: 'EASY', label: 'Easy', hint: '15% traffic' },
  { id: 'MEDIUM', label: 'Medium', hint: '25% traffic' },
  { id: 'HARD', label: 'Hard', hint: '35% traffic' },
] as const;

type Difficulty = (typeof DIFFICULTIES)[number]['id'];

export default function ChickenPage() {
  const { socket, balance, send } = useGameSocket();
  const { subscribe } = socket;

  const [amount, setAmount] = useState('1.00');
  const [difficulty, setDifficulty] = useState<Difficulty>('MEDIUM');
  const [active, setActive] = useState(false);
  const [crossed, setCrossed] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [multipliers, setMultipliers] = useState<number[]>([]);
  const [laneCount, setLaneCount] = useState(24);
  const [hitLane, setHitLane] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<'bust' | 'cashout' | null>(null);
  const [busy, setBusy] = useState(false);
  /** Server-rejected action, shown to the player instead of failing silently. */
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const off = [
      subscribe('BET_ACCEPTED', (data) => {
        if (data.gameType !== 'CHICKEN') return;
        setActive(true);
        setCrossed(0);
        setMultiplier(1);
        setHitLane(null);
        setOutcome(null);
        setBusy(false);
        setError(null);
        if (Array.isArray(data.multipliers)) {
          setMultipliers(data.multipliers as number[]);
        }
        if (typeof data.laneCount === 'number') setLaneCount(data.laneCount);
      }),

      // A reload wipes the page's copy of a round the server still holds open.
      // Without this the player sees the idle screen, can only send BET, and
      // every BET is rejected with GAME_IN_PROGRESS — locked out with the stake
      // already taken. Asking on every connect costs one frame.
      subscribe('RESUME_NONE', () => {
      }),

      subscribe('ERROR', (data) => {
        setBusy(false);
        const message = typeof data.message === 'string' ? data.message : null;
        if (message) setError(message);
      }),

      subscribe('STEP_RESULT', (data) => {
        if (data.gameType !== 'CHICKEN') return;
        setBusy(false);
        if (typeof data.crossed === 'number') setCrossed(data.crossed);
        if (typeof data.multiplier === 'number') setMultiplier(data.multiplier);
      }),

      subscribe('GAME_RESULT', (data) => {
        if (data.gameType !== 'CHICKEN') return;
        setActive(false);
        setBusy(false);
        if (typeof data.crossed === 'number') setCrossed(data.crossed);

        if (data.win) {
          setOutcome('cashout');
          if (typeof data.multiplier === 'number') setMultiplier(data.multiplier);
        } else {
          setOutcome('bust');
          setHitLane(typeof data.hitLane === 'number' ? data.hitLane : null);
          setMultiplier(0);
        }
      }),
    ];
    return () => off.forEach((fn) => fn());
  }, [subscribe]);

  // Ask the server whether this player already has a round open. Runs on every
  // (re)connect, because that is exactly when the client's copy of the round
  // may be missing or stale.
  useEffect(() => {
    if (!socket.isOpen) return;
    send('RESUME', 'CHICKEN');
  }, [socket.isOpen, send]);

  // Keyboard: forward advances, and is the same action as the on-screen
  // button. Ignored while a step is in flight so a held key cannot queue up
  // several lanes against one server round-trip.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowRight' && event.key !== 'w') {
        return;
      }
      event.preventDefault();
      if (!busy) step();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const start = () => {
    setBusy(true);
    setError(null);
    send('BET', 'CHICKEN', { amount, currency: 'USD', params: { difficulty } });
  };

  const step = () => {
    setBusy(true);
    send('STEP', 'CHICKEN');
  };

  const cashout = () => {
    setBusy(true);
    send('CASHOUT', 'CHICKEN');
  };

  const potentialPayout = active && crossed > 0
    ? (Number(amount) * multiplier).toFixed(2)
    : null;
  const nextMultiplier = multipliers[crossed] ?? null;

  return (
    <GameShell
      gameType="CHICKEN"
      title="Chicken Road"
      subtitle="Cross the lanes. Bank before the traffic finds you."
      stage={
        <div className="chick__stage">
          <ChickenLanes
            crossed={crossed}
            multipliers={multipliers}
            amount={amount}
            active={active}
            hitLane={hitLane}
            outcome={outcome}
          />

          {/* The canvas is aria-hidden, so round state is announced here. */}
          <p className="chick__status" role="status" aria-live="polite">
            {outcome === 'bust'
              ? `Knocked out in lane ${(hitLane ?? 0) + 1}. Stake lost.`
              : outcome === 'cashout'
                ? `Cashed out at ${multiplier.toFixed(2)}× after ${crossed} lanes.`
                : active
                  ? `Lane ${crossed} of ${laneCount} · ${multiplier.toFixed(2)}×`
                  : 'Set your stake and start the crossing.'}
          </p>

          {error && (
            <p className="chick__error" role="alert">
              {error}
            </p>
          )}

          {active && (
            <div className="chick__controls">
              <button
                type="button"
                className="chick__step"
                onClick={step}
                disabled={busy}
              >
                Cross
                {nextMultiplier !== null && (
                  <small>{nextMultiplier.toFixed(2)}×</small>
                )}
              </button>
              <ChickenCashout
                amount={amount}
                multiplier={multiplier}
                crossed={crossed}
                disabled={busy}
                onCashout={cashout}
              />
            </div>
          )}
        </div>
      }
      panel={
        <>
          <div className="chick__opts">
            <span className="chick__opts-label">Difficulty</span>
            <div className="chick__diffs" role="group" aria-label="Difficulty">
              {DIFFICULTIES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={
                    option.id === difficulty
                      ? 'chick__diff chick__diff--on'
                      : 'chick__diff'
                  }
                  disabled={active}
                  onClick={() => setDifficulty(option.id)}
                >
                  {option.label}
                  <small>{option.hint}</small>
                </button>
              ))}
            </div>
          </div>

          {/* The multiplier ladder that used to sit here is gone: the lane
              board on the stage now shows the same progression in the same
              order, and two copies of one table invite the reader to look for
              a difference between them that does not exist. */}

          <BetControls
            amount={amount}
            onAmountChange={setAmount}
            balance={balance.balance}
            currency={balance.currency}
            onBet={start}
            onCashout={cashout}
            // Cashing out needs at least one lane behind you — the server
            // rejects it otherwise, so the button should not offer it.
            canCashout={active && crossed > 0}
            cashoutAmount={potentialPayout}
            cashoutMultiplier={active && crossed > 0 ? multiplier : null}
            disabled={!socket.isOpen}
            busy={busy}
          />
        </>
      }
    />
  );
}
