'use client';


import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export interface AuditEntry {
  id: string;
  action: string;
  details: unknown;
  createdAt: string;
  adminId: string;
  adminEmail: string;
  targetUserId: string | null;
  targetEmail: string | null;
}

const TONE: Record<string, string> = {
  BALANCE_ADJUSTED: 'tag--deposit',
  ROLE_CHANGED: 'tag--win',
  REVSHARE_CHANGED: 'tag--win',
  ACCOUNT_FROZEN: 'tag--frozen',
  ACCOUNT_UNFROZEN: 'tag--active',
  WITHDRAWAL_APPROVED: 'tag--completed',
  WITHDRAWAL_REJECTED: 'tag--failed',
  RISK_CONFIG_UPDATED: 'tag--pending',
};

function Details({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return <span className="tbl__mono">—</span>;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="tbl__mono">—</span>;

  return (
    <div className="tbl__mono" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {entries.map(([key, val]) => (
        <span key={key}>
          <span style={{ color: 'var(--admin-muted)' }}>{key}:</span>{' '}
          {typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val)}
        </span>
      ))}
    </div>
  );
}

export function AuditTable({
  entries,
  actions,
  total,
  skip,
  take,
}: {
  entries: AuditEntry[];
  actions: string[];
  total: number;
  skip: number;
  take: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const activeAction = params.get('action');

  const setParam = (key: string, value: string | null, resetPage = true) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (resetPage) next.delete('skip');
    router.push(`/admin/audit-logs?${next.toString()}`);
  };

  return (
    <>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setParam('q', query.trim() || null); }}>
        <div className="filters__search">
          <input
            className="ainput"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by admin or target email / user ID"
            aria-label="Search audit log"
          />
        </div>
        <button type="submit" className="abtn">Search</button>
        <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--admin-muted)' }}>
          {total.toLocaleString()} entr{total === 1 ? 'y' : 'ies'}
        </span>
      </form>

      {actions.length > 0 && (
        <div className="filters">
          <button type="button" className="abtn" aria-pressed={!activeAction} onClick={() => setParam('action', null)}>
            All actions
          </button>
          {actions.map((action) => (
            <button key={action} type="button" className="abtn" aria-pressed={activeAction === action}
              onClick={() => setParam('action', activeAction === action ? null : action)}>
              {action.replace(/_/g, ' ').toLowerCase()}
            </button>
          ))}
        </div>
      )}

      <div className="tbl__wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>When</th><th>Action</th><th>Admin</th><th>Target</th><th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr><td className="tbl__empty" colSpan={5}>No audit entries match these filters.</td></tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="tbl__mono">{new Date(entry.createdAt).toLocaleString()}</td>
                  <td>
                    <span className={`tag ${TONE[entry.action] ?? 'tag--user'}`}>
                      {entry.action.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td>
                    {entry.adminEmail}
                    <div className="tbl__mono">{entry.adminId}</div>
                  </td>
                  <td>
                    {entry.targetEmail ?? <span className="tbl__mono">—</span>}
                    {entry.targetUserId && <div className="tbl__mono">{entry.targetUserId}</div>}
                  </td>
                  <td><Details value={entry.details} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > take && (
        <div className="pager">
          <button type="button" className="abtn" disabled={skip === 0}
            onClick={() => setParam('skip', String(Math.max(0, skip - take)), false)}>Previous</button>
          <span>{skip + 1}–{Math.min(skip + take, total)} of {total}</span>
          <button type="button" className="abtn" disabled={skip + take >= total}
            onClick={() => setParam('skip', String(skip + take), false)}>Next</button>
        </div>
      )}
    </>
  );
}
