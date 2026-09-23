'use client';

import { useMemo, useRef, useState } from 'react';

import { DiceCanvas } from '@/components/canvas/DiceCanvas';
import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useGameRound } from '@/hooks/useGameRound';

type Direction = 'OVER' | 'UNDER';

interface DiceRound {
  id: string;
  roll: number;
  win: boolean;
  payout: string | null;
  /** The line and side the roll was settled against, not the current controls. */
  target: number;
  direction: Direction;
}

const DICE_EDGE = 0.01;

export default function DicePage() {
  const { balance } = useGameSocket();
  const { t } = useLanguage();

  const [amount, setAmount] = useState('1.00');
  const [target, setTarget] = useState(50);
  const [direction, setDirection] = useState<Direction>('UNDER');
  const [round, setRound] = useState<DiceRound | null>(null);
  const [complete, setComplete] = useState(false);

  /** Ids the board can compare: re-rolling the same number still has to slide. */
  const roundSeq = useRef(0);

  // autoSettle is off: the needle slides to the roll, so the controls stay
  // locked for the whole slide rather than just until the server answers.
  const { busy, bet, settle } = useGameRound<{ roll?: number }>('DICE', {
    autoSettle: false,
    onResult: ({ result, win, payout: paid }) => {
      roundSeq.current += 1;
      setComplete(false);
      setRound({
        id: `dice-${roundSeq.current}`,
        roll: typeof result?.roll === 'number' ? result.roll : 0,
        win,
        payout: paid,
        target,
        direction,
      });
    },
  });

  const { winChance, quote } = useMemo(() => {
    const chance = direction === 'UNDER' ? target : 100 - target;
    const raw = (100 / chance) * (1 - DICE_EDGE);
    return { winChance: chance, quote: Math.floor(raw * 100) / 100 };
  }, [target, direction]);

  return (
    <GameShell
      gameType="DICE"
      title={t('games.dice.name')}
      subtitle={t('games.dice.subtitle')}
      stage={
        <div className="stage__center">
          <div style={{ width: '100%', maxWidth: 560 }}>
            <DiceCanvas
              target={target}
              direction={direction}
              roll={round?.roll ?? null}
              rollId={round?.id ?? null}
              won={complete && round ? round.win : null}
              onRollComplete={() => {
                setComplete(true);
                settle();
              }}
            />
          </div>

          {complete && round ? (
            <p className="readout__note" role="status">
              {round.win ? `Win · +${round.payout ?? '0'}` : 'No win'} · rolled{' '}
              {round.direction === 'UNDER' ? 'under' : 'over'} {round.target}
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
            <span className="opt__label">{t('game.direction')}</span>
            <div className="opt__row">
              {(['UNDER', 'OVER'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className="opt__chip"
                  aria-pressed={direction === option}
                  disabled={busy}
                  onClick={() => setDirection(option)}
                >
                  Roll {option.toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="opt">
            <label className="opt__label" htmlFor="dice-target">
              Target · {target}
            </label>
            <input
              id="dice-target"
              className="opt__range"
              type="range"
              min={1}
              max={99}
              step={1}
              value={target}
              disabled={busy}
              onChange={(event) => setTarget(Number(event.target.value))}
            />
          </div>

          <div className="opt">
            <div className="opt__stat">
              <span>{t('game.winChance')}</span>
              <b>{winChance.toFixed(2)}%</b>
            </div>
            <div className="opt__stat">
              <span>{t('game.payout')}</span>
              <b>{quote.toFixed(2)}×</b>
            </div>
          </div>

          <BetControls
            amount={amount}
            onAmountChange={setAmount}
            balance={balance.balance}
            currency={balance.currency}
            onBet={() => {
              setRound(null);
              setComplete(false);
              bet('BET', {
                amount,
                currency: balance.currency,
                params: { target, direction },
              });
            }}
            busy={busy}
            betLabel={t('game.roll')}
          />
        </>
      }
    />
  );
}
