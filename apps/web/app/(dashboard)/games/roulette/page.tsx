'use client';

import { useEffect, useRef, useState } from 'react';

import {
  RouletteCanvas,
  pocketColor,
  type RoulettePhase,
} from '@/components/canvas/RouletteCanvas';
import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';

const POSITIONS: Array<{ id: string; label: string; pays: string }> = [
  { id: 'red', label: 'Red', pays: '2×' },
  { id: 'black', label: 'Black', pays: '2×' },
  { id: 'odd', label: 'Odd', pays: '2×' },
  { id: 'even', label: 'Even', pays: '2×' },
  { id: 'low', label: '1–18', pays: '2×' },
  { id: 'high', label: '19–36', pays: '2×' },
  { id: 'dozen:1', label: '1st 12', pays: '3×' },
  { id: 'dozen:2', label: '2nd 12', pays: '3×' },
  { id: 'dozen:3', label: '3rd 12', pays: '3×' },
  { id: 'column:1', label: 'Col 1', pays: '3×' },
  { id: 'column:2', label: 'Col 2', pays: '3×' },
  { id: 'column:3', label: 'Col 3', pays: '3×' },
];

export default function RoulettePage() {
  const { socket, balance, send } = useGameSocket();
  const { t } = useLanguage();
  const { subscribe } = socket;

  const [amount, setAmount] = useState('1.00');
  const [position, setPosition] = useState('red');
  const [straight, setStraight] = useState('');
  const [phase, setPhase] = useState<RoulettePhase>('IDLE');
  const [pocket, setPocket] = useState<number | null>(null);
  const [lastWin, setLastWin] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * The settled round, held back until the wheel finishes. The server answers
   * an instant game in milliseconds; applying it on arrival announced the
   * outcome while the ball was still in the air.
   */
  const pendingRef = useRef<{ pocket: number; win: boolean } | null>(null);
  /**
   * Balance as it stood when the spin began. The wallet is server-pushed and
   * updates the moment the round settles, so the panel would otherwise show
   * the payout before the wheel revealed it.
   */
  const [heldBalance, setHeldBalance] = useState<string | null>(null);

  useEffect(() => {
    const off = [
      subscribe('GAME_RESULT', (data) => {
        if (data.gameType !== 'ROULETTE') return;
        const result = data.resultData as { pocket?: number } | undefined;
        if (typeof result?.pocket !== 'number') return;

        // The pocket goes to the canvas so it can aim the ball, but the phase
        // stays SPINNING and the win/loss stays hidden until it lands.
        pendingRef.current = { pocket: result.pocket, win: Boolean(data.win) };
        setPocket(result.pocket);
      }),
      subscribe('ERROR', () => {
        // A rejected bet never spins, so nothing is pending and the held
        // balance must be released or the panel would freeze on a stale value.
        pendingRef.current = null;
        setHeldBalance(null);
        setBusy(false);
        setPhase('IDLE');
      }),
    ];
    return () => off.forEach((fn) => fn());
  }, [subscribe]);

  const activePosition = straight.trim() !== '' ? `straight:${straight.trim()}` : position;

  /** Runs when the ball settles: only now does the round become a result. */
  const revealResult = () => {
    const settled = pendingRef.current;
    pendingRef.current = null;
    if (settled) {
      setLastWin(settled.win);
      setPhase('RESULT');
    }
    setHeldBalance(null);
    setBusy(false);
  };

  const spin = () => {
    setBusy(true);
    setPhase('SPINNING');
    setPocket(null);
    setLastWin(null);
    pendingRef.current = null;
    setHeldBalance(balance.balance);
    send('SPIN', 'ROULETTE', {
      amount,
      currency: balance.currency,
      params: { bets: [{ position: activePosition, amount }] },
    });
  };

  return (
    <GameShell
      gameType="ROULETTE"
      title={t('games.roulette.name')}
      subtitle={t('games.roulette.subtitle')}
      stage={
        <>
          <RouletteCanvas
            phase={phase}
            pocket={pocket}
            onSpinComplete={revealResult}
            size={380}
          />
          {phase === 'RESULT' && pocket !== null && !busy && (
            <p
              className={`readout__note${lastWin ? '' : ''}`}
              role="status"
              style={{
                textAlign: 'center',
                marginTop: 10,
                color: lastWin ? 'var(--fg-accent)' : 'var(--fg-red)',
                fontWeight: 600,
              }}
            >
              {pocket} {pocketColor(pocket).toLowerCase()} —{' '}
              {lastWin ? 'you win' : 'no win'}
            </p>
          )}
        </>
      }
      panel={
        <>
          <div className="opt">
            <span className="opt__label">{t('game.outsideBets')}</span>
            <div className="opt__row">
              {POSITIONS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="opt__chip"
                  style={{ flexBasis: '30%' }}
                  aria-pressed={straight === '' && position === p.id}
                  disabled={busy}
                  onClick={() => {
                    setPosition(p.id);
                    setStraight('');
                  }}
                  title={`Pays ${p.pays}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="opt">
            <span className="opt__label">Straight up (36×)</span>
            <input
              className="dash__input"
              inputMode="numeric"
              placeholder={t('game.pocketPlaceholder')}
              value={straight}
              disabled={busy}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, '').slice(0, 2);
                if (digits === '' || Number(digits) <= 36) setStraight(digits);
              }}
              aria-label={t('game.pocketNumber')}
            />
          </div>

          <div className="opt__stat">
            <span>{t('game.bettingOn')}</span>
            <b>{activePosition}</b>
          </div>

          <BetControls
            amount={amount}
            onAmountChange={setAmount}
            balance={heldBalance ?? balance.balance}
            currency={balance.currency}
            onBet={spin}
            busy={busy}
            disabled={busy}
            betLabel={t('game.spin')}
          />
        </>
      }
    />
  );
}
