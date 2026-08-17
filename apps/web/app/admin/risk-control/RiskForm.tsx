'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { apiFetch } from '@/lib/api';

const GAMES = ['CRASH', 'MINES', 'ROULETTE', 'COINFLIP', 'PLINKO', 'DICE', 'LIMBO', 'KENO'] as const;
const DECIMAL = /^\d+(\.\d{1,8})?$/;

export interface GameLimit {
  gameType: string;
  minBet: string;
  maxBet: string;
  maxWin: string;
}

export interface RiskConfig {
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  updatedAt: string | null;
  limits: GameLimit[];
  defaults: { minBet: string; maxBet: string };
}

function tidy(value: string) {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

export function RiskForm({ config }: { config: RiskConfig }) {
  const router = useRouter();

  const [maintenance, setMaintenance] = useState(config.maintenanceMode);
  const [notice, setNotice] = useState(config.maintenanceMessage ?? '');
  const [limits, setLimits] = useState<Record<string, GameLimit>>(() => {
    const byGame: Record<string, GameLimit> = {};
    for (const game of GAMES) {
      const existing = config.limits.find((l) => l.gameType === game);
      byGame[game] = existing
        ? {
            gameType: game,
            minBet: tidy(existing.minBet),
            maxBet: tidy(existing.maxBet),
            maxWin: tidy(existing.maxWin),
          }
        : { gameType: game, minBet: config.defaults.minBet, maxBet: config.defaults.maxBet, maxWin: '0' };
    }
    return byGame;
  });
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const setField = (game: string, field: keyof GameLimit, value: string) =>
    setLimits((prev) => ({ ...prev, [game]: { ...prev[game], [field]: value } }));

  const invalid = GAMES.flatMap((game) => {
    const l = limits[game];
    const errors: string[] = [];
    for (const field of ['minBet', 'maxBet', 'maxWin'] as const) {
      if (!DECIMAL.test(l[field])) errors.push(`${game} ${field}`);
    }
    if (DECIMAL.test(l.minBet) && DECIMAL.test(l.maxBet) && Number(l.minBet) > Number(l.maxBet)) {
      errors.push(`${game} min > max`);
    }
    return errors;
  });

  const save = async () => {
    setIsBusy(true);
    setMessage(null);
    try {
      const response = await apiFetch('/api/admin/risk', {
        method: 'PUT',
        body: JSON.stringify({
          maintenanceMode: maintenance,
          maintenanceMessage: notice.trim() || null,
          limits: GAMES.map((game) => limits[game]),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setMessage({ tone: 'err', text: String(body.detail ?? body.error ?? 'Save failed') });
        return;
      }
      setMessage({ tone: 'ok', text: 'Risk configuration saved and now enforced.' });
      router.refresh();
    } catch {
      setMessage({ tone: 'err', text: 'Could not reach the admin API.' });
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <>
      <section className="metric" style={{ marginBottom: 16 }}>
        <h2 className="metric__label">Emergency maintenance mode</h2>
        <p className="metric__note">
          While enabled, every wager is refused platform-wide with the message
          below. Cashouts and admin actions are unaffected, so players can still
          be settled and refunded.
        </p>
        <div className="drawer__row" style={{ marginTop: 8 }}>
          <button
            type="button"
            className={maintenance ? 'abtn abtn--danger' : 'abtn'}
            aria-pressed={maintenance}
            onClick={() => setMaintenance((v) => !v)}
          >
            {maintenance ? '● Maintenance ON — betting halted' : '○ Maintenance OFF'}
          </button>
          <input
            className="ainput"
            value={notice}
            onChange={(event) => setNotice(event.target.value.slice(0, 200))}
            placeholder="Message shown to players (optional)"
            aria-label="Maintenance message"
          />
        </div>
      </section>

      <div className="tbl__wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Game</th>
              <th className="tbl__num">Min bet</th>
              <th className="tbl__num">Max bet</th>
              <th className="tbl__num">Max win (0 = uncapped)</th>
            </tr>
          </thead>
          <tbody>
            {GAMES.map((game) => (
              <tr key={game}>
                <td><strong>{game}</strong></td>
                {(['minBet', 'maxBet', 'maxWin'] as const).map((field) => (
                  <td key={field} className="tbl__num">
                    <input
                      className="ainput"
                      inputMode="decimal"
                      value={limits[game][field]}
                      onChange={(event) =>
                        setField(game, field, event.target.value.replace(/[^\d.]/g, '').slice(0, 20))
                      }
                      aria-label={`${game} ${field}`}
                      aria-invalid={!DECIMAL.test(limits[game][field])}
                      style={{ maxWidth: 130, textAlign: 'right' }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {invalid.length > 0 && (
        <p className="drawer__msg drawer__msg--err" style={{ marginTop: 12 }} role="alert">
          Fix before saving: {invalid.join(', ')}
        </p>
      )}
      {message && (
        <p className={`drawer__msg drawer__msg--${message.tone}`} style={{ marginTop: 12 }} role="alert">
          {message.text}
        </p>
      )}

      <div className="pager" style={{ justifyContent: 'space-between' }}>
        <span>
          {config.updatedAt
            ? `Last changed ${new Date(config.updatedAt).toLocaleString()}`
            : 'Never changed — platform defaults in effect'}
        </span>
        <button
          type="button"
          className="abtn abtn--primary"
          disabled={isBusy || invalid.length > 0}
          onClick={save}
        >
          {isBusy ? 'Saving…' : 'Save configuration'}
        </button>
      </div>
    </>
  );
}
