'use client';


import { useEffect, useState } from 'react';

import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
type CoinSide = 'HEADS' | 'TAILS';

export default function CoinflipPage() {
  const { socket, balance, send } = useGameSocket();
  const { subscribe } = socket;

  const [amount, setAmount] = useState('1.00');
  const [side, setSide] = useState<CoinSide>('HEADS');
  const [landed, setLanded] = useState<CoinSide | null>(null);
  const [won, setWon] = useState<boolean | null>(null);
  const [payout, setPayout] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const off = [
      subscribe('GAME_RESULT', (data) => {
        if (data.gameType !== 'COINFLIP') return;
        const result = data.resultData as { landed?: CoinSide } | undefined;
        if (result?.landed) setLanded(result.landed);
        setWon(Boolean(data.win));
        setPayout(typeof data.payout === 'string' ? data.payout : null);
        setBusy(false);
      }),
      subscribe('ERROR', () => setBusy(false)),
    ];
    return () => off.forEach((fn) => fn());
  }, [subscribe]);

  const flip = () => {
    setBusy(true);
    setLanded(null);
    setWon(null);
    send('SPIN', 'COINFLIP', {
      amount,
      currency: balance.currency,
      params: { side },
    });
  };

  return (
    <GameShell
      gameType="COINFLIP"
      title="Coinflip"
      subtitle="Heads or tails · pays 1.98×"
      stage={
        <div className="stage__center">
          <div
            className={`coin${busy ? ' coin--flipping' : ''}`}
            role="img"
            aria-label={
              busy
                ? 'Coin flipping'
                : landed
                  ? `Coin landed ${landed}`
                  : 'Coin ready'
            }
          >
            {busy ? '?' : landed ? (landed === 'HEADS' ? 'H' : 'T') : side === 'HEADS' ? 'H' : 'T'}
          </div>

          {won !== null && !busy && (
            <>
              <div className={`readout ${won ? 'readout--win' : 'readout--lose'}`}>
                {won ? `+${payout ?? '0'}` : 'No win'}
              </div>
              <p className="readout__note" role="status">
                Landed {landed} · you picked {side}
              </p>
            </>
          )}
        </div>
      }
      panel={
        <>
          <div className="opt">
            <span className="opt__label">Your side</span>
            <div className="opt__row">
              {(['HEADS', 'TAILS'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className="opt__chip"
                  aria-pressed={side === option}
                  disabled={busy}
                  onClick={() => setSide(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="opt__stat">
            <span>Payout on win</span>
            <b>1.98×</b>
          </div>

          <BetControls
            amount={amount}
            onAmountChange={setAmount}
            balance={balance.balance}
            currency={balance.currency}
            onBet={flip}
            busy={busy}
            disabled={busy}
            betLabel="Flip"
          />
        </>
      }
    />
  );
}
