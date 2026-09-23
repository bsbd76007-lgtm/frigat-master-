'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  KENO_DRAW_COUNT,
  KENO_MAX_PICKS,
  KENO_PAYTABLE,
  KENO_TILE_COUNT,
} from '@frigat/shared/constants';

import { KenoCanvas } from '@/components/canvas/KenoCanvas';
import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useGameRound } from '@/hooks/useGameRound';

const REVEAL_STEP_MS = 130;

export default function KenoPage() {
  const { balance } = useGameSocket();
  const { t } = useLanguage();

  const [amount, setAmount] = useState('1.00');
  const [picks, setPicks] = useState<number[]>([]);
  const [drawn, setDrawn] = useState<number[] | null>(null);
  const [revealedCount, setRevealedCount] = useState(0);
  const [hitCount, setHitCount] = useState<number | null>(null);
  const [won, setWon] = useState<boolean | null>(null);
  const [payout, setPayout] = useState<string | null>(null);
  const [settledPickCount, setSettledPickCount] = useState<number | null>(null);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // autoSettle is off: the tiles reveal one at a time, and the round is not
  // over until the last one turns.
  const { busy, bet, settle } = useGameRound<{
    drawn?: number[];
    hitCount?: number;
    picks?: number[];
  }>('KENO', {
    autoSettle: false,
    onResult: ({ result, win, payout: paid }) => {
      const drawnNumbers = Array.isArray(result?.drawn) ? result.drawn : [];
      const resultPickCount = Array.isArray(result?.picks) ? result.picks.length : 0;

      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];

      setDrawn(drawnNumbers);
      setRevealedCount(0);
      setHitCount(null);
      setWon(null);
      setSettledPickCount(resultPickCount);

      // Nothing to reveal means no timer will ever fire, and the last timer is
      // what ends the round — so without this the board stays locked until the
      // player reloads. Plinko already guarded its equivalent empty-path case.
      if (drawnNumbers.length === 0) {
        setHitCount(0);
        setWon(win);
        setPayout(paid);
        settle();
        return;
      }

      drawnNumbers.forEach((_, i) => {
        const timer = setTimeout(() => {
          setRevealedCount(i + 1);
          if (i === drawnNumbers.length - 1) {
            setHitCount(typeof result?.hitCount === 'number' ? result.hitCount : 0);
            setWon(win);
            setPayout(paid);
            settle();
          }
        }, i * REVEAL_STEP_MS);
        timersRef.current.push(timer);
      });
    },
  });

  // The reveal timers are owned by this page, so unmounting mid-reveal has to
  // clear them — useGameRound only owns the subscription.
  useEffect(
    () => () => {
      timersRef.current.forEach(clearTimeout);
    },
    []
  );

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

  const paytable = KENO_PAYTABLE[picks.length] ?? null;
  const settledPaytable =
    settledPickCount !== null ? KENO_PAYTABLE[settledPickCount] : null;

  const placeBet = useCallback(() => {
    if (picks.length === 0) return;
    setDrawn(null);
    setRevealedCount(0);
    setHitCount(null);
    setWon(null);
    setPayout(null);
    bet('BET', {
      amount,
      currency: balance.currency,
      params: { picks },
    });
  }, [amount, balance.currency, picks, bet]);

  return (
    <GameShell
      gameType="KENO"
      title={t('games.keno.name')}
      subtitle={`${KENO_TILE_COUNT} tiles · pick up to ${KENO_MAX_PICKS} · ${KENO_DRAW_COUNT} drawn`}
      stage={
        <>
          <KenoCanvas
            tileCount={KENO_TILE_COUNT}
            picks={picks}
            drawn={revealedDrawn}
            interactive={!busy}
            onToggle={togglePick}
            ariaLabel={t('game.kenoBoard')}
          />

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
                {t('game.autoPick')}
              </button>
              <button
                type="button"
                className="opt__chip"
                onClick={clearPicks}
                disabled={busy || picks.length === 0}
              >
                {t('game.clear')}
              </button>
            </div>
          </div>

          <div className="opt">
            <span className="opt__label">{t('game.paytable')}</span>
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
                  {t('game.pickTile')}
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
            betLabel={t('game.draw')}
          />
        </>
      }
    />
  );
}
