'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import { LimboCanvas, type LimboRound } from '@/components/canvas/LimboCanvas';
import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useGameRound } from '@/hooks/useGameRound';

const MIN_TARGET = 1.01;
const MAX_TARGET = 1_000_000;
const LIMBO_EDGE = 0.01;

const QUICK_TARGETS = [1.5, 2, 5, 10, 100];

interface Round extends LimboRound {
  payout: string | null;
  /** The target the server settled against, not whatever the input says now. */
  settledTarget: number;
}

function formatMultiplier(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toFixed(2);
}

export default function LimboPage() {
  const { balance } = useGameSocket();
  const { t } = useLanguage();

  const [amount, setAmount] = useState('1.00');
  const [targetInput, setTargetInput] = useState('2.00');
  const [round, setRound] = useState<Round | null>(null);
  const [complete, setComplete] = useState(false);

  /** Ids the board can compare: rolling the same multiplier twice must animate. */
  const roundSeq = useRef(0);

  const target = useMemo(() => {
    const n = Number(targetInput);
    if (!Number.isFinite(n)) return MIN_TARGET;
    return Math.min(MAX_TARGET, Math.max(MIN_TARGET, n));
  }, [targetInput]);

  const winChance = useMemo(() => ((1 - LIMBO_EDGE) / target) * 100, [target]);

  // autoSettle is off: the controls stay locked for the whole count-up, not just
  // until the server answers, so a second bet cannot land mid-rollout. The
  // count-up itself belongs to the board — running it as React state meant a
  // re-render of the page on every one of its frames.
  const { busy, bet, settle } = useGameRound<{
    achievedMultiplier?: number;
    targetMultiplier?: number;
  }>('LIMBO', {
    autoSettle: false,
    onResult: ({ result, win, payout: paid }) => {
      roundSeq.current += 1;
      setComplete(false);
      setRound({
        id: `limbo-${roundSeq.current}`,
        achievedMultiplier:
          typeof result?.achievedMultiplier === 'number' ? result.achievedMultiplier : 1,
        win,
        payout: paid,
        settledTarget:
          typeof result?.targetMultiplier === 'number' ? result.targetMultiplier : target,
      });
    },
  });

  const placeBet = useCallback(() => {
    setRound(null);
    setComplete(false);
    bet('BET', {
      amount,
      currency: balance.currency,
      params: { targetMultiplier: target },
    });
  }, [amount, balance.currency, bet, target]);

  return (
    <GameShell
      gameType="LIMBO"
      title={t('games.limbo.name')}
      subtitle={t('games.limbo.subtitle')}
      stage={
        <div className="stage__center">
          <div style={{ width: '100%', maxWidth: 520 }}>
            <LimboCanvas
              target={round?.settledTarget ?? target}
              round={round}
              onRollComplete={() => {
                setComplete(true);
                settle();
              }}
            />
          </div>

          {complete && round ? (
            <p className="readout__note" role="status">
              {round.win ? `Win · +${round.payout ?? '0'}` : 'No win'} · target was{' '}
              {formatMultiplier(round.settledTarget)}x
            </p>
          ) : (
            <p className="readout__note">
              {busy ? 'Rolling…' : 'Set your target and roll'}
            </p>
          )}
        </div>
      }
      panel={
        <>
          <div className="opt">
            <span className="opt__label">{t('game.quickTarget')}</span>
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
              {t('game.targetMultiplier')}
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
              <span>{t('game.winChance')}</span>
              <b>{winChance.toFixed(4)}%</b>
            </div>
            <div className="opt__stat">
              <span>{t('game.payoutOnWin')}</span>
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
            betLabel={t('game.roll')}
          />
        </>
      }
    />
  );
}
