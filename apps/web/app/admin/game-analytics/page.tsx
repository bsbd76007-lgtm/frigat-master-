'use client';

/**
 * FRIGAT — Game analytics
 *
 * Per-game hold and win rate, so an operator can spot a game paying out more
 * than its configured edge should allow.
 *
 * Edge is flagged against the game's *configured* target rather than one
 * global number: Roulette's edge is structural (~2.7% from the single zero)
 * while Crash and Mines are configured at 1%, so a single threshold would
 * either cry wolf on one or stay silent on the other.
 */

import { useCallback, useEffect, useState } from 'react';

import { apiJson } from '@/lib/api';
import { API_URL } from '@/lib/token';
import { formatDecimalString } from '@/lib/decimal';
interface GameRow {
  gameType: string;
  bets: number;
  wagered: string;
  payout: string;
  ggr: string;
  houseEdgePercent: string;
  rtpPercent: string;
  winRatePercent: string;
  wins: number;
}

/** Configured edge per game, from apps/server/src/config/game.config.ts. */
const TARGET_EDGE: Record<string, number> = {
  CRASH: 1,
  MINES: 1,
  ROULETTE: 2.7,
  COINFLIP: 1,
  PLINKO: 1,
  DICE: 1,
  LIMBO: 1,
  KENO: 2,
};

/**
 * Sample size below which realised edge is noise, not signal. Variance on a
 * handful of bets routinely swings hold by tens of percent, so flagging those
 * would bury a genuine anomaly in false positives.
 */
const MIN_BETS_FOR_SIGNAL = 100;

function edgeTone(row: GameRow): 'good' | 'warn' | 'bad' | 'idle' {
  if (row.bets < MIN_BETS_FOR_SIGNAL) return 'idle';
  const actual = Number(row.houseEdgePercent);
  const target = TARGET_EDGE[row.gameType] ?? 1;
  if (actual < 0) return 'bad'; // paying out more than taken in
  if (actual < target * 0.4) return 'warn'; // running well under target
  return 'good';
}

export default function GameAnalyticsPage() {
  const [rows, setRows] = useState<GameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiJson<{ games: GameRow[] }>(
        `${API_URL}/api/admin/game-analytics`
      );
      setRows(data.games);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="adm-page">
      <div className="adm-page__head">
        <div>
          <h1>Game Analytics</h1>
          <p>Win rates and realised house edge per game.</p>
        </div>
        <button type="button" className="adm-btn" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <p className="adm-error">{error}</p>}
      {loading && rows.length === 0 && <p className="adm-muted">Loading…</p>}
      {!loading && rows.length === 0 && !error && (
        <p className="adm-muted">No game sessions recorded yet.</p>
      )}

      {rows.length > 0 && (
        <div className="adm-tablewrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">Game</th>
                <th scope="col">Bets</th>
                <th scope="col">Wagered</th>
                <th scope="col">Paid out</th>
                <th scope="col">GGR</th>
                <th scope="col">Win rate</th>
                <th scope="col">House edge</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const tone = edgeTone(row);
                const target = TARGET_EDGE[row.gameType] ?? 1;
                return (
                  <tr key={row.gameType}>
                    <td><b>{row.gameType}</b></td>
                    <td>{row.bets.toLocaleString()}</td>
                    <td>${formatDecimalString(row.wagered, 2)}</td>
                    <td>${formatDecimalString(row.payout, 2)}</td>
                    <td className={row.ggr.startsWith('-') ? 'adm-neg' : 'adm-pos'}>
                      ${formatDecimalString(row.ggr, 2)}
                    </td>
                    <td>
                      {row.winRatePercent}%
                      <small className="adm-sub"> ({row.wins.toLocaleString()})</small>
                    </td>
                    <td>
                      <span className={`adm-pill adm-pill--${tone}`}>
                        {row.houseEdgePercent}%
                      </span>
                      <small className="adm-sub"> target {target}%</small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="adm-note">
        Edge is only assessed once a game has at least{' '}
        {MIN_BETS_FOR_SIGNAL.toLocaleString()} bets — below that, variance
        dominates and a flag would be noise.
      </p>
    </div>
  );
}
