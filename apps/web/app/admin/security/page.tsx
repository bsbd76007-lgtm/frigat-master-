'use client';

/**
 * FRIGAT — Logs & security
 *
 * Live operational state: socket connections, platform availability, frozen
 * accounts, and the most recent privileged actions.
 *
 * Scope note: this shows what the system actually records. IP watchlists and
 * API key management are deliberately absent rather than mocked — neither has
 * a backing model (no request-IP capture, no API key table), and a panel that
 * displays invented security data is worse than one that admits the gap,
 * because an operator may act on it.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { apiJson } from '@/lib/api';
import { API_URL } from '@/lib/token';

interface Metrics {
  activeConnections: number;
  totalPlayers: number;
  generatedAt: string;
}

interface RiskConfig {
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface FrozenUser {
  id: string;
  email: string;
  frozen: boolean;
  frozenReason: string | null;
  createdAt: string;
}

interface AuditEntry {
  id: string;
  action: string;
  adminEmail: string;
  targetEmail: string | null;
  createdAt: string;
}

export default function SecurityPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [risk, setRisk] = useState<RiskConfig | null>(null);
  const [frozen, setFrozen] = useState<FrozenUser[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    // Settled rather than all: one failing panel should not blank the others,
    // and on a security screen a partial view beats an empty one.
    const [m, r, f, a] = await Promise.allSettled([
      apiJson<Metrics>(`${API_URL}/api/admin/metrics`),
      apiJson<RiskConfig>(`${API_URL}/api/admin/risk`),
      apiJson<{ users: FrozenUser[] }>(`${API_URL}/api/admin/users?frozen=true&take=25`),
      apiJson<{ entries: AuditEntry[] }>(`${API_URL}/api/admin/audit-logs?take=15`),
    ]);

    if (m.status === 'fulfilled') setMetrics(m.value);
    if (r.status === 'fulfilled') setRisk(r.value);
    if (f.status === 'fulfilled') setFrozen(f.value.users ?? []);
    if (a.status === 'fulfilled') setAudit(a.value.entries ?? []);

    if ([m, r, f, a].every((result) => result.status === 'rejected')) {
      setError('Could not reach the admin API.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="adm-page">
      <div className="adm-page__head">
        <div>
          <h1>Logs &amp; Security</h1>
          <p>Live connections, platform state, and privileged activity.</p>
        </div>
        <button type="button" className="adm-btn" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <p className="adm-error">{error}</p>}
      {loading && !metrics && <p className="adm-muted">Loading…</p>}

      <div className="adm-cards">
        <div className="adm-card">
          <span className="adm-card__label">Active WebSockets</span>
          <b className="adm-card__value">{metrics?.activeConnections ?? '—'}</b>
          <small className="adm-card__sub">Authenticated player connections</small>
        </div>
        <div className="adm-card">
          <span className="adm-card__label">Registered Players</span>
          <b className="adm-card__value">
            {metrics?.totalPlayers?.toLocaleString() ?? '—'}
          </b>
          <small className="adm-card__sub">Total accounts</small>
        </div>
        <div className="adm-card">
          <span className="adm-card__label">Platform Status</span>
          <b
            className={
              risk?.maintenanceMode
                ? 'adm-card__value adm-card__value--warn'
                : 'adm-card__value adm-card__value--good'
            }
          >
            {risk === null ? '—' : risk.maintenanceMode ? 'Maintenance' : 'Live'}
          </b>
          <small className="adm-card__sub">
            {risk?.maintenanceMode ? 'Betting is halted' : 'Accepting bets'}
          </small>
        </div>
        <div className="adm-card">
          <span className="adm-card__label">Frozen Accounts</span>
          <b
            className={
              frozen.length > 0
                ? 'adm-card__value adm-card__value--warn'
                : 'adm-card__value'
            }
          >
            {frozen.length}
          </b>
          <small className="adm-card__sub">Blocked from wagering</small>
        </div>
      </div>

      <section className="adm-section">
        <h2>Frozen accounts</h2>
        {frozen.length === 0 ? (
          <p className="adm-muted">No accounts are currently frozen.</p>
        ) : (
          <div className="adm-tablewrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Registered</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {frozen.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <Link className="adm-linkcell" href={`/admin/users?q=${encodeURIComponent(user.email)}`}>
                        {user.email}
                      </Link>
                    </td>
                    <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                    <td>{user.frozenReason ?? '—'}</td>
                    <td>
                      <span className="adm-pill adm-pill--bad">Frozen</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="adm-section">
        <h2>Recent admin activity</h2>
        {audit.length === 0 ? (
          <p className="adm-muted">No recorded admin actions.</p>
        ) : (
          <div className="adm-tablewrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Admin</th>
                  <th scope="col">Target</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((entry) => (
                  <tr key={entry.id}>
                    <td><b>{entry.action}</b></td>
                    <td>{entry.adminEmail}</td>
                    <td>{entry.targetEmail ?? '—'}</td>
                    <td>{new Date(entry.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Link className="adm-btn adm-btn--ghost" href="/admin/audit-logs">
          View full audit log
        </Link>
      </section>

      <p className="adm-note">
        IP watchlists and API key controls are not shown: the platform does not
        currently record request IPs or issue API keys, so there is no data
        behind them. Adding either needs a schema change first.
      </p>
    </div>
  );
}
