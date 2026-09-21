'use client';


import { useState } from 'react';

import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useGameRound } from '@/hooks/useGameRound';

type CoinSide = 'HEADS' | 'TAILS';

export default function CoinflipPage() {
  const { balance } = useGameSocket();
  const { t } = useLanguage();

  const [amount, setAmount] = useState('1.00');
  const [side, setSide] = useState<CoinSide>('HEADS');
  const [landed, setLanded] = useState<CoinSide | null>(null);
  const [won, setWon] = useState<boolean | null>(null);
  const [payout, setPayout] = useState<string | null>(null);

  const { busy, bet } = useGameRound<{ landed?: CoinSide }>('COINFLIP', {
    onResult: ({ result, win, payout: paid }) => {
      if (result?.landed) setLanded(result.landed);
      setWon(win);
      setPayout(paid);
    },
  });

  const flip = () => {
    setLanded(null);
    setWon(null);
    bet('SPIN', {
      amount,
      currency: balance.currency,
      params: { side },
    });
  };

  return (
    <GameShell
      gameType="COINFLIP"
      title={t('games.coinflip.name')}
      subtitle={t('games.coinflip.subtitle')}
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
            <span className="opt__label">{t('game.yourSide')}</span>
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
            <span>{t('game.payoutOnWin')}</span>
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
            betLabel={t('game.flip')}
          />
        </>
      }
    />
  );
}
