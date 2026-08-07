'use client';

import { useEffect, useState } from 'react';

import { PLINKO_ROWS, PLINKO_TABLES, type PlinkoRisk } from '@frigat/shared/constants';

import { PlinkoCanvas, type PlinkoDrop } from '@/components/canvas/PlinkoCanvas';
import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
const RISKS: PlinkoRisk[] = ['LOW', 'MEDIUM', 'HIGH'];

export default function PlinkoPage() {
  const { socket, balance, send } = useGameSocket();
  const { subscribe } = socket;

  const [amount, setAmount] = useState('1.00');
  const [rows, setRows] = useState<number>(12);
  const [risk, setRisk] = useState<PlinkoRisk>('MEDIUM');
  const [drops, setDrops] = useState<PlinkoDrop[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const off = [
      subscribe('GAME_RESULT', (data) => {
        if (data.gameType !== 'PLINKO') return;
        const result = data.resultData as
          | { path?: Array<'L' | 'R'>; bucket?: number; rows?: number }
          | undefined;
        if (!Array.isArray(result?.path)) {
          setBusy(false);
          return;
        }
        const id =
          typeof data.sessionId === 'string'
            ? data.sessionId
            : `drop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setDrops((prev) => [
          ...prev.slice(-5),
          {
            id,
            path: result!.path!,
            bucket: result!.bucket,
            multiplier: typeof data.multiplier === 'number' ? data.multiplier : undefined,
          },
        ]);
      }),
      subscribe('ERROR', () => setBusy(false)),
    ];
    return () => off.forEach((fn) => fn());
  }, [subscribe]);

  const multipliers = PLINKO_TABLES[risk][rows] ?? [];

  return (
    <GameShell
      gameType="PLINKO"
      title="Plinko"
      subtitle={`${rows} rows · ${risk.toLowerCase()} risk`}
      stage={
        <PlinkoCanvas
          rows={rows}
          multipliers={multipliers}
          drops={drops}
          height={440}
          onDropComplete={() => setBusy(false)}
        />
      }
      panel={
        <>
          <div className="opt">
            <span className="opt__label">Rows</span>
            <div className="opt__row">
              {PLINKO_ROWS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="opt__chip"
                  aria-pressed={rows === option}
                  disabled={busy}
                  onClick={() => {
                    setRows(option);
                    setDrops([]);
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="opt">
            <span className="opt__label">Risk</span>
            <div className="opt__row">
              {RISKS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="opt__chip"
                  aria-pressed={risk === option}
                  disabled={busy}
                  onClick={() => {
                    setRisk(option);
                    setDrops([]);
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="opt__stat">
            <span>Top multiplier</span>
            <b>{multipliers.length ? `${Math.max(...multipliers)}×` : '—'}</b>
          </div>

          <BetControls
            amount={amount}
            onAmountChange={setAmount}
            balance={balance.balance}
            currency={balance.currency}
            onBet={() => {
              setBusy(true);
              send('BET', 'PLINKO', {
                amount,
                currency: balance.currency,
                params: { rows, risk },
              });
            }}
            busy={busy}
            betLabel="Drop ball"
          />
        </>
      }
    />
  );
}
