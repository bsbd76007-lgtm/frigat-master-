'use client';

import { useEffect, useState } from 'react';

import {
  RouletteCanvas,
  pocketColor,
  type RoulettePhase,
} from '@/components/canvas/RouletteCanvas';
import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
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
  const { subscribe } = socket;

  const [amount, setAmount] = useState('1.00');
  const [position, setPosition] = useState('red');
  const [straight, setStraight] = useState('');
  const [phase, setPhase] = useState<RoulettePhase>('IDLE');
  const [pocket, setPocket] = useState<number | null>(null);
  const [lastWin, setLastWin] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const off = [
      subscribe('GAME_RESULT', (data) => {
        if (data.gameType !== 'ROULETTE') return;
        const result = data.resultData as { pocket?: number } | undefined;
        if (typeof result?.pocket === 'number') {
          setPocket(result.pocket);
          setPhase('RESULT');
        }
        setLastWin(Boolean(data.win));
      }),
      subscribe('ERROR', () => {
        setBusy(false);
        setPhase('IDLE');
      }),
    ];
    return () => off.forEach((fn) => fn());
  }, [subscribe]);

  const activePosition = straight.trim() !== '' ? `straight:${straight.trim()}` : position;

  const spin = () => {
    setBusy(true);
    setPhase('SPINNING');
    setPocket(null);
    setLastWin(null);
    send('SPIN', 'ROULETTE', {
      amount,
      currency: balance.currency,
      params: { bets: [{ position: activePosition, amount }] },
    });
  };

  return (
    <GameShell
      gameType="ROULETTE"
      title="Roulette"
      subtitle="European wheel · single zero"
      stage={
        <>
          <RouletteCanvas
            phase={phase}
            pocket={pocket}
            onSpinComplete={() => setBusy(false)}
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
            <span className="opt__label">Outside bets</span>
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
              placeholder="0–36"
              value={straight}
              disabled={busy}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, '').slice(0, 2);
                if (digits === '' || Number(digits) <= 36) setStraight(digits);
              }}
              aria-label="Straight-up pocket number"
            />
          </div>

          <div className="opt__stat">
            <span>Betting on</span>
            <b>{activePosition}</b>
          </div>

          <BetControls
            amount={amount}
            onAmountChange={setAmount}
            balance={balance.balance}
            currency={balance.currency}
            onBet={spin}
            busy={busy}
            disabled={busy}
            betLabel="Spin"
          />
        </>
      }
    />
  );
}
