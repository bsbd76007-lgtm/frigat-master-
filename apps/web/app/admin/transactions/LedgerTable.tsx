'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { formatDecimalString } from '@/lib/decimal';

export interface LedgerRow {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'BET' | 'WIN';
  amount: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  txHash: string | null;
  createdAt: string;
  currency: string;
  userId: string;
  userEmail: string;
}

const TYPES = ['DEPOSIT', 'WITHDRAWAL', 'BET', 'WIN'] as const;
const STATUSES = ['COMPLETED', 'PENDING', 'FAILED'] as const;
const POLL_MS = 5000;

function signOf(type: LedgerRow['type']) {
  return type === 'DEPOSIT' || type === 'WIN' ? '+' : '−';
}

export function LedgerTable({
  rows,
  total,
  skip,
  take,
}: {
  rows: LedgerRow[];
  total: number;
  skip: number;
  take: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [live, setLive] = useState(true);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [live, router]);

  const setParam = (key: string, value: string | null, resetPage = true) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (resetPage) next.delete('skip');
    router.push(`/admin/transactions?${next.toString()}`);
  };

  const activeType = params.get('type');
  const activeStatus = params.get('status');

  return (
    <>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setParam('q', query.trim() || null); }}>
        <div className="filters__search">
          <input
            className="ainput"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by player email or exact user ID"
            aria-label="Search transactions by user"
          />
        </div>
        <button type="submit" className="abtn">Search</button>
      </form>

      <div className="filters">
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--admin-muted)' }}>
          Type
        </span>
        <button type="button" className="abtn" aria-pressed={!activeType} onClick={() => setParam('type', null)}>All</button>
        {TYPES.map((type) => (
          <button key={type} type="button" className="abtn" aria-pressed={activeType === type}
            onClick={() => setParam('type', activeType === type ? null : type)}>
            {type.charAt(0) + type.slice(1).toLowerCase()}
          </button>
        ))}

        <span style={{ marginLeft: 12, fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--admin-muted)' }}>
          Status
        </span>
        <button type="button" className="abtn" aria-pressed={!activeStatus} onClick={() => setParam('status', null)}>Any</button>
        {STATUSES.map((status) => (
          <button key={status} type="button" className="abtn" aria-pressed={activeStatus === status}
            onClick={() => setParam('status', activeStatus === status ? null : status)}>
            {status.charAt(0) + status.slice(1).toLowerCase()}
          </button>
        ))}

        <button type="button" className="abtn" aria-pressed={live} style={{ marginLeft: 'auto' }}
          onClick={() => setLive((v) => !v)}
          title={`Auto-refresh every ${POLL_MS / 1000}s`}>
          {live ? '● Live' : '❚❚ Paused'}
        </button>
      </div>

      <div className="tbl__wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Time</th><th>Type</th><th>Player</th>
              <th className="tbl__num">Amount</th><th>Status</th><th>Reference</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="tbl__empty" colSpan={6}>No transactions match these filters.</td></tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="tbl__mono">{new Date(row.createdAt).toLocaleString()}</td>
                  <td><span className={`tag tag--${row.type.toLowerCase()}`}>{row.type}</span></td>
                  <td>
                    {row.userEmail}
                    <div className="tbl__mono">{row.userId}</div>
                  </td>
                  <td className="tbl__num">
                    {signOf(row.type)}{formatDecimalString(row.amount, 2)} {row.currency}
                  </td>
                  <td><span className={`tag tag--${row.status.toLowerCase()}`}>{row.status}</span></td>
                  <td className="tbl__mono">{row.txHash ?? '—'}</td>
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
