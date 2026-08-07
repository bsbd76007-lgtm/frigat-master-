'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { CRASH } from '@frigat/shared/constants';

import { CrashCanvas, type CrashPhase } from '@/components/canvas/CrashCanvas';
import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
export default function CrashPage() {
  const { socket, balance, send, crashRounds } = useGameSocket();
  const { subscribe } = socket;

  const [amount, setAmount] = useState('1.00');
  const [phase, setPhase] = useState<CrashPhase>('IDLE');
  const [multiplier, setMultiplier] = useState(1);
  const [crashPoint, setCrashPoint] = useState<number | null>(null);
  const [cashedOutAt, setCashedOutAt] = useState<number | null>(null);
  const [hasBet, setHasBet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msRemaining, setMsRemaining] = useState<number | null>(null);
  const deadlineRef = useRef<number | null>(null);

  useEffect(() => {
    const off = [
      subscribe('CRASH_ROUND_START', (data) => {
        setPhase('BETTING');
        setMultiplier(1);
        setCrashPoint(null);
        setCashedOutAt(null);
        setHasBet(false);
        setBusy(false);
        const window = typeof data.bettingWindowMs === 'number'
          ? data.bettingWindowMs
          : CRASH.bettingWindowMs;
        deadlineRef.current = Date.now() + window;
        setMsRemaining(window);
      }),
      subscribe('STATE_UPDATE', (data) => {
        if (data.phase === 'RUNNING') {
          setPhase('RUNNING');
          deadlineRef.current = null;
          setMsRemaining(null);
        }
      }),
      subscribe('CRASH_TICK', (data) => {
        if (typeof data.multiplier === 'number') setMultiplier(data.multiplier);
      }),
      subscribe('CRASH_ROUND_END', (data) => {
        setPhase('CRASHED');
        if (typeof data.crashPoint === 'number') {
          setCrashPoint(data.crashPoint);
          setMultiplier(data.crashPoint);
        }
        setBusy(false);
      }),
      subscribe('BET_ACCEPTED', (data) => {
        if (data.gameType === 'CRASH') {
          setHasBet(true);
          setBusy(false);
        }
      }),
      subscribe('GAME_RESULT', (data) => {
        if (data.gameType !== 'CRASH') return;
        if (typeof data.multiplier === 'number') setCashedOutAt(data.multiplier);
        setBusy(false);
      }),
      subscribe('ERROR', () => setBusy(false)),
    ];
    return () => off.forEach((fn) => fn());
  }, [subscribe]);

  useEffect(() => {
    if (phase !== 'BETTING') return;
    const id = setInterval(() => {
      if (deadlineRef.current === null) return;
      setMsRemaining(Math.max(0, deadlineRef.current - Date.now()));
    }, 100);
    return () => clearInterval(id);
  }, [phase]);

  const history = useMemo(
    () =>
      crashRounds.map((round) => ({
        id: round.id,
        multiplier: round.crashPoint,
        gameType: 'CRASH' as const,
      })),
    [crashRounds]
  );

  const canCashout = hasBet && cashedOutAt === null && phase === 'RUNNING';
  const canBet = phase === 'BETTING' && !hasBet;

  return (
    <GameShell
      gameType="CRASH"
      title="Crash"
      subtitle="Cash out before the curve busts"
      history={history}
      stage={
        <CrashCanvas
          phase={phase}
          multiplier={multiplier}
          crashPoint={crashPoint}
          bettingMsRemaining={msRemaining}
          cashedOutAt={cashedOutAt}
          height={360}
        />
      }
      panel={
        <>
          <div className="opt">
            <span className="opt__label">Round</span>
            <div className="opt__stat">
              <span>Phase</span>
              <b>{phase}</b>
            </div>
            <div className="opt__stat">
              <span>Your bet</span>
              <b>{hasBet ? `${amount} in play` : '—'}</b>
            </div>
            {cashedOutAt !== null && (
              <div className="opt__stat">
                <span>Cashed out</span>
                <b style={{ color: 'var(--fg-gold)' }}>{cashedOutAt.toFixed(2)}×</b>
              </div>
            )}
          </div>

          <BetControls
            amount={amount}
            onAmountChange={setAmount}
            balance={balance.balance}
            currency={balance.currency}
            canCashout={canCashout}
            cashoutMultiplier={canCashout ? multiplier : null}
            onBet={() => {
              setBusy(true);
              send('BET', 'CRASH', { amount, currency: balance.currency });
            }}
            onCashout={() => {
              setBusy(true);
              send('CASHOUT', 'CRASH');
            }}
            disabled={!canBet && !canCashout}
            busy={busy}
            betLabel={
              phase === 'BETTING'
                ? 'Place bet'
                : hasBet
                  ? 'Bet placed'
                  : 'Waiting for next round'
            }
          />
        </>
      }
    />
  );
}
