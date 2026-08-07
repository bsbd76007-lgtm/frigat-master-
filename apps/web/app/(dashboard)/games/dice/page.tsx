'use client';

import { useEffect, useMemo, useState } from 'react';

import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
type Direction = 'OVER' | 'UNDER';

const DICE_EDGE = 0.01;

export default function DicePage() {
  const { socket, balance, send } = useGameSocket();
  const { subscribe } = socket;

  const [amount, setAmount] = useState('1.00');
  const [target, setTarget] = useState(50);
  const [direction, setDirection] = useState<Direction>('UNDER');
  const [roll, setRoll] = useState<number | null>(null);
  const [won, setWon] = useState<boolean | null>(null);
  const [payout, setPayout] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const off = [
      subscribe('GAME_RESULT', (data) => {
        if (data.gameType !== 'DICE') return;
        const result = data.resultData as { roll?: number } | undefined;
        if (typeof result?.roll === 'number') setRoll(result.roll);
        setWon(Boolean(data.win));
        setPayout(typeof data.payout === 'string' ? data.payout : null);
        setBusy(false);
      }),
      subscribe('ERROR', () => setBusy(false)),
    ];
    return () => off.forEach((fn) => fn());
  }, [subscribe]);

  const { winChance, quote } = useMemo(() => {
    const chance = direction === 'UNDER' ? target : 100 - target;
    const raw = (100 / chance) * (1 - DICE_EDGE);
    return { winChance: chance, quote: Math.floor(raw * 100) / 100 };
  }, [target, direction]);

  return (
    <GameShell
      gameType="DICE"
      title="Dice"
      subtitle="Roll under or over your target"
      stage={
        <div className="stage__center">
          <div style={{ width: '100%', maxWidth: 460 }}>
            <div className="dicebar">
              <div
                className="dicebar__win"
                style={
                  direction === 'UNDER'
                    ? { left: 0, width: `${target}%` }
                    : { left: `${target}%`, right: 0 }
                }
              />
              {roll !== null && (
                <div className="dicebar__marker" style={{ left: `calc(${roll}% - 1.5px)` }} />
              )}
            </div>
            <div className="dicebar__scale">
              <span>0</span>
              <span>50</span>
              <span>100</span>
            </div>
          </div>

          {roll !== null && !busy ? (
            <>
              <div className={`readout ${won ? 'readout--win' : 'readout--lose'}`}>
                {roll.toFixed(2)}
              </div>
              <p className="readout__note" role="status">
                {won ? `Win · +${payout ?? '0'}` : 'No win'} · rolled{' '}
                {direction === 'UNDER' ? 'under' : 'over'} {target}
              </p>
            </>
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
            <span className="opt__label">Direction</span>
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
              <span>Win chance</span>
              <b>{winChance.toFixed(2)}%</b>
            </div>
            <div className="opt__stat">
              <span>Payout</span>
              <b>{quote.toFixed(2)}×</b>
            </div>
          </div>

          <BetControls
            amount={amount}
            onAmountChange={setAmount}
            balance={balance.balance}
            currency={balance.currency}
            onBet={() => {
              setBusy(true);
              setRoll(null);
              setWon(null);
              send('BET', 'DICE', {
                amount,
                currency: balance.currency,
                params: { target, direction },
              });
            }}
            busy={busy}
            betLabel="Roll"
          />
        </>
      }
    />
  );
}
