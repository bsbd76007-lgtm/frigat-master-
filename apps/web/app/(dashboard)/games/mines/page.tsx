'use client';

import { useEffect, useState } from 'react';

import { MINES } from '@frigat/shared/constants';

import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
const MINE_OPTIONS = [1, 3, 5, 10, 24];

export default function MinesPage() {
  const { socket, balance, send } = useGameSocket();
  const { subscribe } = socket;

  const [amount, setAmount] = useState('1.00');
  const [minesCount, setMinesCount] = useState(3);
  const [active, setActive] = useState(false);
  const [revealed, setRevealed] = useState<number[]>([]);
  const [multiplier, setMultiplier] = useState(1);
  const [potentialPayout, setPotentialPayout] = useState<string | null>(null);
  const [minePositions, setMinePositions] = useState<number[]>([]);
  const [hitTile, setHitTile] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<'bust' | 'cashout' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const off = [
      subscribe('BET_ACCEPTED', (data) => {
        if (data.gameType !== 'MINES') return;
        setActive(true);
        setRevealed([]);
        setMultiplier(1);
        setPotentialPayout(null);
        setMinePositions([]);
        setHitTile(null);
        setOutcome(null);
        setBusy(false);
      }),
      subscribe('STATE_UPDATE', (data) => {
        if (data.gameType !== 'MINES') return;
        if (typeof data.revealedTile === 'number') {
          setRevealed((prev) =>
            prev.includes(data.revealedTile as number)
              ? prev
              : [...prev, data.revealedTile as number]
          );
        }
        if (typeof data.multiplier === 'number') setMultiplier(data.multiplier);
        if (typeof data.potentialPayout === 'string') {
          setPotentialPayout(data.potentialPayout);
        }
        setBusy(false);
      }),
      subscribe('GAME_RESULT', (data) => {
        if (data.gameType !== 'MINES') return;
        setActive(false);
        setBusy(false);
        if (Array.isArray(data.minePositions)) {
          setMinePositions(data.minePositions as number[]);
        }
        if (data.bust) {
          setOutcome('bust');
          if (typeof data.hitTile === 'number') setHitTile(data.hitTile);
        } else {
          setOutcome('cashout');
          if (typeof data.multiplier === 'number') setMultiplier(data.multiplier);
          if (Array.isArray(data.revealed)) setRevealed(data.revealed as number[]);
        }
      }),
      subscribe('ERROR', () => setBusy(false)),
    ];
    return () => off.forEach((fn) => fn());
  }, [subscribe]);

  const reveal = (tile: number) => {
    if (!active || revealed.includes(tile) || busy) return;
    setBusy(true);
    send('REVEAL_TILE', 'MINES', { tile });
  };

  const tileState = (tile: number) => {
    if (hitTile === tile) return 'hit';
    if (minePositions.includes(tile)) return 'mine';
    if (revealed.includes(tile)) return 'safe';
    return 'idle';
  };

  return (
    <GameShell
      gameType="MINES"
      title="Mines"
      subtitle={`${MINES.gridSize} tiles · reveal safe tiles and cash out`}
      stage={
        <>
          <div className="mines" role="grid" aria-label="Mines board">
            {Array.from({ length: MINES.gridSize }, (_, tile) => {
              const state = tileState(tile);
              return (
                <button
                  key={tile}
                  type="button"
                  role="gridcell"
                  className={`mines__tile${state === 'idle' ? '' : ` mines__tile--${state}`}`}
                  onClick={() => reveal(tile)}
                  disabled={!active || state !== 'idle' || busy}
                  aria-label={`Tile ${tile + 1}${state === 'idle' ? '' : `, ${state}`}`}
                >
                  {state === 'safe' ? '◆' : state === 'idle' ? '' : '✷'}
                </button>
              );
            })}
          </div>

          {outcome && (
            <p
              className="readout__note"
              role="status"
              style={{ textAlign: 'center', marginTop: 14 }}
            >
              {outcome === 'bust'
                ? 'Hit a mine — round over.'
                : `Cashed out at ${multiplier.toFixed(2)}×.`}
            </p>
          )}
        </>
      }
      panel={
        <>
          <div className="opt">
            <span className="opt__label">Mines</span>
            <div className="opt__row">
              {MINE_OPTIONS.map((count) => (
                <button
                  key={count}
                  type="button"
                  className="opt__chip"
                  aria-pressed={minesCount === count}
                  disabled={active}
                  onClick={() => setMinesCount(count)}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          <div className="opt">
            <div className="opt__stat">
              <span>Revealed</span>
              <b>{revealed.length}</b>
            </div>
            <div className="opt__stat">
              <span>Multiplier</span>
              <b>{multiplier.toFixed(2)}×</b>
            </div>
            <div className="opt__stat">
              <span>Cashout value</span>
              <b>{potentialPayout ?? '—'}</b>
            </div>
          </div>

          <BetControls
            amount={amount}
            onAmountChange={setAmount}
            balance={balance.balance}
            currency={balance.currency}
            canCashout={active && revealed.length > 0}
            cashoutAmount={potentialPayout}
            cashoutMultiplier={multiplier}
            onBet={() => {
              setBusy(true);
              send('BET', 'MINES', {
                amount,
                currency: balance.currency,
                params: { minesCount },
              });
            }}
            onCashout={() => {
              setBusy(true);
              send('CASHOUT', 'MINES');
            }}
            disabled={active && revealed.length === 0}
            busy={busy}
            betLabel={active ? 'Round in progress' : 'Start round'}
          />
        </>
      }
    />
  );
}
