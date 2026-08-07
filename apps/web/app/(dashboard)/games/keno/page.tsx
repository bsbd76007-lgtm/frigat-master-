'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  KENO_DRAW_COUNT,
  KENO_MAX_PICKS,
  KENO_PAYTABLE,
  KENO_TILE_COUNT,
} from '@frigat/shared/constants';

import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
const REVEAL_STEP_MS = 130;

export default function KenoPage() {
  const { socket, balance, send } = useGameSocket();
  const { subscribe } = socket;

  const [amount, setAmount] = useState('1.00');
  const [picks, setPicks] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [drawn, setDrawn] = useState<number[] | null>(null);
  const [revealedCount, setRevealedCount] = useState(0);
  const [hitCount, setHitCount] = useState<number | null>(null);
  const [won, setWon] = useState<boolean | null>(null);
  const [payout, setPayout] = useState<string | null>(null);
  const [settledPickCount, setSettledPickCount] = useState<number | null>(null);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const off = [
      subscribe('GAME_RESULT', (data) => {
        if (data.gameType !== 'KENO') return;
        const result = data.resultData as
          | { drawn?: number[]; hitCount?: number; picks?: number[] }
          | undefined;
        const drawnNumbers = Array.isArray(result?.drawn) ? result!.drawn! : [];
        const resultPickCount = Array.isArray(result?.picks) ? result!.picks!.length : 0;

        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];

        setDrawn(drawnNumbers);
        setRevealedCount(0);
        setHitCount(null);
        setWon(null);
        setSettledPickCount(resultPickCount);

        drawnNumbers.forEach((_, i) => {
          const timer = setTimeout(() => {
            setRevealedCount(i + 1);
            if (i === drawnNumbers.length - 1) {
              setHitCount(typeof result?.hitCount === 'number' ? result.hitCount : 0);
              setWon(Boolean(data.win));
              setPayout(typeof data.payout === 'string' ? data.payout : null);
              setBusy(false);
            }
          }, i * REVEAL_STEP_MS);
          timersRef.current.push(timer);
        });
      }),
      subscribe('ERROR', () => setBusy(false)),
    ];
    return () => {
      off.forEach((fn) => fn());
      timersRef.current.forEach(clearTimeout);
    };
    // `picks` is read only to snapshot the pick count a round was played
    // with; re-subscribing on every pick change would drop mid-flight timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe]);

  const togglePick = (tile: number) => {
    if (busy) return;
    setPicks((prev) => {
      if (prev.includes(tile)) return prev.filter((t) => t !== tile);
      if (prev.length >= KENO_MAX_PICKS) return prev;
      return [...prev, tile];
    });
  };

  const autoPick = () => {
    if (busy) return;
    const target = picks.length > 0 ? picks.length : KENO_MAX_PICKS;
    const pool = Array.from({ length: KENO_TILE_COUNT }, (_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    setPicks(pool.slice(0, target).sort((a, b) => a - b));
  };

  const clearPicks = () => {
    if (busy) return;
    setPicks([]);
  };

  const revealedDrawn = useMemo(
    () => (drawn ? drawn.slice(0, revealedCount) : []),
    [drawn, revealedCount]
  );

  const tileState = (tile: number): 'idle' | 'picked' | 'drawn' | 'hit' => {
    const isPicked = picks.includes(tile);
    const isDrawn = revealedDrawn.includes(tile);
    if (isDrawn && isPicked) return 'hit';
    if (isDrawn) return 'drawn';
    if (isPicked) return 'picked';
    return 'idle';
  };

  const paytable = KENO_PAYTABLE[picks.length] ?? null;
  const settledPaytable =
    settledPickCount !== null ? KENO_PAYTABLE[settledPickCount] : null;

  const placeBet = useCallback(() => {
    if (picks.length === 0) return;
    setBusy(true);
    setDrawn(null);
    setRevealedCount(0);
    setHitCount(null);
    setWon(null);
    setPayout(null);
    send('BET', 'KENO', {
      amount,
      currency: balance.currency,
      params: { picks },
    });
  }, [amount, balance.currency, picks, send]);

  return (
    <GameShell
      gameType="KENO"
      title="Keno"
      subtitle={`${KENO_TILE_COUNT} tiles · pick up to ${KENO_MAX_PICKS} · ${KENO_DRAW_COUNT} drawn`}
      stage={
        <>
          <div className="keno" role="grid" aria-label="Keno board">
            {Array.from({ length: KENO_TILE_COUNT }, (_, tile) => {
              const state = tileState(tile);
              return (
                <button
                  key={tile}
                  type="button"
                  role="gridcell"
                  className={`keno__tile${state === 'idle' ? '' : ` keno__tile--${state}`}`}
                  onClick={() => togglePick(tile)}
                  disabled={busy}
                  aria-pressed={picks.includes(tile)}
                  aria-label={`Tile ${tile + 1}${state === 'idle' ? '' : `, ${state}`}`}
                >
                  {tile + 1}
                </button>
              );
            })}
          </div>

          {won !== null ? (
            <p className="readout__note" role="status" style={{ textAlign: 'center', marginTop: 14 }}>
              {hitCount} of {settledPickCount} hit ·{' '}
              {won ? `Win · +${payout ?? '0'}` : 'No win'}
            </p>
          ) : (
            <p className="readout__note" style={{ textAlign: 'center', marginTop: 14 }}>
              {busy
                ? revealedCount > 0
                  ? `Drawing… ${revealedCount}/${KENO_DRAW_COUNT}`
                  : 'Drawing…'
                : `Pick up to ${KENO_MAX_PICKS} tiles, then draw`}
            </p>
          )}
        </>
      }
      panel={
        <>
          <div className="opt">
            <span className="opt__label">
              Picks · {picks.length}/{KENO_MAX_PICKS}
            </span>
            <div className="opt__row">
              <button
                type="button"
                className="opt__chip"
                onClick={autoPick}
                disabled={busy}
              >
                Auto Pick
              </button>
              <button
                type="button"
                className="opt__chip"
                onClick={clearPicks}
                disabled={busy || picks.length === 0}
              >
                Clear
              </button>
            </div>
          </div>

          <div className="opt">
            <span className="opt__label">Paytable</span>
            <div className="keno__paytable">
              {paytable ? (
                Object.entries(paytable)
                  .map(([hits, mult]) => [Number(hits), mult] as const)
                  .sort((a, b) => a[0] - b[0])
                  .map(([hits, mult]) => (
                    <div
                      key={hits}
                      className={
                        won !== null && hitCount === hits && settledPaytable === paytable
                          ? 'keno__paytable-row keno__paytable-row--active'
                          : 'keno__paytable-row'
                      }
                    >
                      <span>{hits} hit{hits === 1 ? '' : 's'}</span>
                      <b>{mult > 0 ? `${mult}×` : '—'}</b>
                    </div>
                  ))
              ) : (
                <p className="opt__stat" style={{ color: 'var(--fg-dim)' }}>
                  Pick at least one tile to see payouts
                </p>
              )}
            </div>
          </div>

          <BetControls
            amount={amount}
            onAmountChange={setAmount}
            balance={balance.balance}
            currency={balance.currency}
            onBet={placeBet}
            disabled={picks.length === 0}
            busy={busy}
            betLabel="Draw"
          />
        </>
      }
    />
  );
}
