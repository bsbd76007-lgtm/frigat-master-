'use client';


import { useRef, useState } from 'react';

import { CoinflipCanvas, type CoinFlight } from '@/components/canvas/CoinflipCanvas';
import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useGameRound } from '@/hooks/useGameRound';

type CoinSide = 'HEADS' | 'TAILS';

interface Flip extends CoinFlight {
  payout: string | null;
  /** The side that was picked when the bet went out, not the current control. */
  pick: CoinSide;
}

const other = (side: CoinSide): CoinSide => (side === 'HEADS' ? 'TAILS' : 'HEADS');

export default function CoinflipPage() {
  const { balance } = useGameSocket();
  const { t } = useLanguage();

  const [amount, setAmount] = useState('1.00');
  const [side, setSide] = useState<CoinSide>('HEADS');
  const [flip, setFlip] = useState<Flip | null>(null);
  const [complete, setComplete] = useState(false);

  /** Ids the board can compare: two heads in a row still have to be two flips. */
  const roundSeq = useRef(0);

  // autoSettle is off: the coin is still in the air when the server answers, and
  // a second bet must not land on top of a flip that is still playing out.
  const { busy, bet, settle } = useGameRound<{ landed?: CoinSide }>('COINFLIP', {
    autoSettle: false,
    onResult: ({ result, win, payout: paid }) => {
      roundSeq.current += 1;
      setComplete(false);
      setFlip({
        id: `coin-${roundSeq.current}`,
        // Two outcomes, so the face is recoverable from the result even if the
        // frame omits it: a win landed on the pick, a loss on the other side.
        landed: result?.landed ?? (win ? side : other(side)),
        win,
        payout: paid,
        pick: side,
      });
    },
  });

  const placeBet = () => {
    setFlip(null);
    setComplete(false);
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
          <div style={{ width: '100%', maxWidth: 480 }}>
            <CoinflipCanvas
              pick={side}
              spinning={busy && flip === null}
              flight={flip}
              onLanded={() => {
                setComplete(true);
                settle();
              }}
            />
          </div>

          {complete && flip && (
            <>
              <div className={`readout ${flip.win ? 'readout--win' : 'readout--lose'}`}>
                {flip.win ? `+${flip.payout ?? '0'}` : 'No win'}
              </div>
              <p className="readout__note" role="status">
                Landed {flip.landed} · you picked {flip.pick}
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
            onBet={placeBet}
            busy={busy}
            disabled={busy}
            betLabel={t('game.flip')}
          />
        </>
      }
    />
  );
}
