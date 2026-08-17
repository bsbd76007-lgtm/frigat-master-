'use client';

/**
 * FRIGAT — Crash (single-player)
 *
 * A round exists only when this player starts one. The page sends BET, the
 * server opens a round addressed to this user alone, ticks it, and ends it on
 * either the cash-out or the crash point. Nothing runs between rounds, so the
 * player picks their own moment to start the next one.
 */

import { useEffect, useMemo, useState } from 'react';

import { CrashCanvas, type CrashPhase } from '@/components/canvas/CrashCanvas';
import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';

export default function CrashPage() {
  const { socket, balance, send, crashRounds } = useGameSocket();
  const { t } = useLanguage();
  const { subscribe } = socket;

  const [amount, setAmount] = useState('1.00');
  const [phase, setPhase] = useState<CrashPhase>('IDLE');
  const [multiplier, setMultiplier] = useState(1);
  const [crashPoint, setCrashPoint] = useState<number | null>(null);
  const [cashedOutAt, setCashedOutAt] = useState<number | null>(null);
  const [hasBet, setHasBet] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const off = [
      // The round is already running by the time this lands — the server opens
      // it on the player's BET, so there is no betting window to count down.
      subscribe('CRASH_ROUND_START', () => {
        setPhase('RUNNING');
        setMultiplier(1);
        setCrashPoint(null);
        setCashedOutAt(null);
        setBusy(false);
      }),
      subscribe('CRASH_TICK', (data) => {
        if (typeof data.multiplier === 'number') setMultiplier(data.multiplier);
      }),
      subscribe('CRASH_ROUND_END', (data) => {
        // Either ending frees the player to start another round, so the stake
        // is released here rather than waiting on a next-round signal.
        setHasBet(false);
        setBusy(false);

        if (data.cashedOut) {
          setPhase('CASHED_OUT');
          if (typeof data.multiplier === 'number') {
            setCashedOutAt(data.multiplier);
            setMultiplier(data.multiplier);
          }
          return;
        }

        setPhase('CRASHED');
        if (typeof data.crashPoint === 'number') {
          setCrashPoint(data.crashPoint);
          setMultiplier(data.crashPoint);
        }
      }),
      subscribe('BET_ACCEPTED', (data) => {
        if (data.gameType !== 'CRASH') return;
        setHasBet(true);
        setBusy(false);
        // On a resume the live stake is the server's, not whatever is sitting
        // in the input — the cash-out quote is computed from this.
        if (typeof data.amount === 'string') setAmount(data.amount);
      }),
      subscribe('GAME_RESULT', (data) => {
        if (data.gameType !== 'CRASH') return;
        setBusy(false);
        // Only a win carries a cash-out multiplier; a bust reports the crash
        // point here, which must not be shown as the player's exit.
        if (data.win && typeof data.multiplier === 'number') {
          setCashedOutAt(data.multiplier);
        }
      }),
      subscribe('RESUME_NONE', () => {
        /* no live round to restore — the idle screen is already correct */
      }),
      subscribe('ERROR', () => setBusy(false)),
    ];
    return () => off.forEach((fn) => fn());
  }, [subscribe]);

  // A reload mid-round leaves the stake committed server-side; without this the
  // page would sit idle with no way to cash out before the round busts.
  useEffect(() => {
    if (!socket.isOpen) return;
    send('RESUME', 'CRASH');
  }, [socket.isOpen, send]);

  const history = useMemo(
    () =>
      crashRounds.map((round) => ({
        id: round.id,
        multiplier: round.crashPoint,
        gameType: 'CRASH' as const,
      })),
    [crashRounds]
  );

  /* Action-button state machine, in priority order:
     1. no round running        → "Place bet", which starts one
     2. RUNNING + live bet      → green "Cashout" with the live payout
     3. otherwise (a round in flight the player is not in) → disabled

     Every ending returns to state 1 on the same frame that ends the round, so
     the player can immediately start another on their own timing. */
  const hasCashedOut = cashedOutAt !== null;
  const roundOver = phase === 'CRASHED' || phase === 'CASHED_OUT';
  const canBet = !hasBet && (phase === 'IDLE' || roundOver);
  const canCashout = phase === 'RUNNING' && hasBet && !hasCashedOut;

  return (
    <GameShell
      gameType="CRASH"
      title={t('games.crash.name')}
      subtitle={t('games.crash.subtitle')}
      history={history}
      stage={
        <CrashCanvas
          phase={phase}
          multiplier={multiplier}
          crashPoint={crashPoint}
          cashedOutAt={cashedOutAt}
          height={360}
        />
      }
      panel={
        <>
          <div className="opt">
            <span className="opt__label">{t('game.round')}</span>
            <div className="opt__stat">
              <span>{t('game.phase')}</span>
              <b>{phase}</b>
            </div>
            <div className="opt__stat">
              <span>{t('game.yourBet')}</span>
              <b>{hasBet ? `${amount} in play` : '—'}</b>
            </div>
            {cashedOutAt !== null && (
              <div className="opt__stat">
                <span>{t('game.cashedOut')}</span>
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
            cashoutTone="accent"
            cashoutMultiplier={canCashout ? multiplier : null}
            /* The live value of cashing out right now. The button showed only
               the multiplier before, leaving the player to do the arithmetic
               on the one control that is time-critical. */
            cashoutAmount={
              canCashout ? (Number(amount) * multiplier).toFixed(2) : null
            }
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
            /* Reached only when the cashout button is not showing. With
               per-player rounds the fallback is the brief gap while a bet is
               being accepted — there is no next round to wait for. */
            betLabel={canBet ? t('game.placeBet') : t('game.roundInProgress')}
          />
        </>
      }
    />
  );
}
