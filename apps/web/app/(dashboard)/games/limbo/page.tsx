'use client';

/**
 * Limbo — pick a target multiplier, the server draws an "achieved" one the
 * same way Crash draws a crash point, and the bet wins iff the draw clears
 * the target. See apps/server/src/engines/limbo.engine.ts for the exact
 * formula and why it keeps the house edge constant at every target.
 *
 * The readout animates from 1.00x up to the achieved value in *log* space —
 * targets span five orders of magnitude (1.01x to 1,000,000x), and a linear
 * count-up would either crawl through the small end or blow past it in a
 * single frame. The animation is purely cosmetic: the server has already
 * settled the bet by the time GAME_RESULT arrives, this just paces how the
 * number is revealed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
/** Mirrors LIMBO in @frigat/shared for the client-side quote only. */
const MIN_TARGET = 1.01;
const MAX_TARGET = 1_000_000;
/** Mirrors HOUSE_EDGE.LIMBO. */
const LIMBO_EDGE = 0.01;

const QUICK_TARGETS = [1.5, 2, 5, 10, 100];
const ROLLOUT_MS = 850;

function formatMultiplier(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toFixed(2);
}

function rolloutValue(target: number, t: number): number {
  const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
  const logTarget = Math.log(Math.max(target, 1.0001));
  return Math.exp(logTarget * eased);
}

export default function LimboPage() {
  const { socket, balance, send } = useGameSocket();
  const { subscribe } = socket;

  const [amount, setAmount] = useState('1.00');
  const [targetInput, setTargetInput] = useState('2.00');
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [display, setDisplay] = useState(1);
  const [achieved, setAchieved] = useState<number | null>(null);
  const [won, setWon] = useState<boolean | null>(null);
  const [payout, setPayout] = useState<string | null>(null);
  const [settledTarget, setSettledTarget] = useState<number | null>(null);

  const rafRef = useRef<number | null>(null);

  const target = useMemo(() => {
    const n = Number(targetInput);
    if (!Number.isFinite(n)) return MIN_TARGET;
    return Math.min(MAX_TARGET, Math.max(MIN_TARGET, n));
  }, [targetInput]);

  const winChance = useMemo(() => ((1 - LIMBO_EDGE) / target) * 100, [target]);

  useEffect(() => {
    const off = [
      subscribe('GAME_RESULT', (data) => {
        if (data.gameType !== 'LIMBO') return;
        const result = data.resultData as
          | { achievedMultiplier?: number; targetMultiplier?: number }
          | undefined;
        const finalAchieved =
          typeof result?.achievedMultiplier === 'number' ? result.achievedMultiplier : 1;
        const usedTarget =
          typeof result?.targetMultiplier === 'number' ? result.targetMultiplier : target;

        setSettledTarget(usedTarget);
        setWon(null);
        setAchieved(null);
        setRolling(true);

        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / ROLLOUT_MS);
          setDisplay(rolloutValue(finalAchieved, t));
          if (t < 1) {
            rafRef.current = requestAnimationFrame(tick);
          } else {
            setDisplay(finalAchieved);
            setAchieved(finalAchieved);
            setWon(Boolean(data.win));
            setPayout(typeof data.payout === 'string' ? data.payout : null);
            setRolling(false);
            setBusy(false);
          }
        };
        rafRef.current = requestAnimationFrame(tick);
      }),
      subscribe('ERROR', () => {
        setBusy(false);
        setRolling(false);
      }),
    ];
    return () => {
      off.forEach((fn) => fn());
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [subscribe, target]);

  const placeBet = useCallback(() => {
    setBusy(true);
    setWon(null);
    setAchieved(null);
    setPayout(null);
    setDisplay(1);
    send('BET', 'LIMBO', {
      amount,
      currency: balance.currency,
      params: { targetMultiplier: target },
    });
  }, [amount, balance.currency, send, target]);

  const readoutValue = achieved ?? display;
  const barPercent = Math.min(
    100,
    (Math.log(Math.max(readoutValue, 1)) / Math.log(Math.max(target, 1.0001))) * 100
  );

  return (
    <GameShell
      gameType="LIMBO"
      title="Limbo"
      subtitle="Pick a target multiplier from 1.01x to 1,000,000x"
      stage={
        <div className="stage__center">
          <div style={{ width: '100%', maxWidth: 420 }}>
            <div className="limbobar">
              <div
                className={`limbobar__fill${won === false ? ' limbobar__fill--lose' : ''}`}
                style={{ width: `${barPercent}%` }}
              />
              <div className="limbobar__target" style={{ left: '100%' }} />
            </div>
            <div className="limbobar__scale">
              <span>1.00x</span>
              <span>Target {formatMultiplier(target)}x</span>
            </div>
          </div>

          <div
            className={
              won === null
                ? 'readout'
                : `readout ${won ? 'readout--win' : 'readout--lose'}`
            }
          >
            {formatMultiplier(readoutValue)}x
          </div>

          {won !== null && !rolling ? (
            <p className="readout__note" role="status">
              {won ? `Win · +${payout ?? '0'}` : 'No win'} · target was{' '}
              {formatMultiplier(settledTarget ?? target)}x
            </p>
          ) : (
            <p className="readout__note">
              {rolling ? 'Rolling…' : 'Set your target and roll'}
            </p>
          )}
        </div>
      }
      panel={
        <>
          <div className="opt">
            <span className="opt__label">Quick target</span>
            <div className="opt__row">
              {QUICK_TARGETS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="opt__chip"
                  aria-pressed={target === value}
                  disabled={busy}
                  onClick={() => setTargetInput(value.toFixed(2))}
                >
                  {value}x
                </button>
              ))}
            </div>
          </div>

          <div className="opt">
            <label className="opt__label" htmlFor="limbo-target">
              Target multiplier
            </label>
            <input
              id="limbo-target"
              className="fg-bet__input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              value={targetInput}
              disabled={busy}
              onChange={(event) => setTargetInput(event.target.value.replace(/[^\d.]/g, ''))}
              onBlur={() => setTargetInput(target.toFixed(2))}
            />
          </div>

          <div className="opt">
            <div className="opt__stat">
              <span>Win chance</span>
              <b>{winChance.toFixed(4)}%</b>
            </div>
            <div className="opt__stat">
              <span>Payout on win</span>
              <b>{formatMultiplier(target)}×</b>
            </div>
          </div>

          <BetControls
            amount={amount}
            onAmountChange={setAmount}
            balance={balance.balance}
            currency={balance.currency}
            onBet={placeBet}
            busy={busy}
            betLabel="Roll"
          />
        </>
      }
    />
  );
}
