import { Suspense } from 'react';
import { cookies } from 'next/headers';

import { LedgerTable, type LedgerRow } from '@/app/admin/transactions/LedgerTable';

import { SESSION_COOKIE } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface LedgerResponse {
  total: number;
  take: number;
  skip: number;
  transactions: LedgerRow[];
}

async function loadLedger(params: { q?: string; type?: string; status?: string; skip: number }) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const base = process.env.API_URL ?? 'http://localhost:4000';
  const search = new URLSearchParams({ take: '25', skip: String(params.skip) });
  if (params.q) search.set('q', params.q);
  if (params.type) search.set('type', params.type);
  if (params.status) search.set('status', params.status);

  try {
    const response = await fetch(`${base}/api/admin/transactions?${search}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!response.ok) return { error: `Ledger API returned ${response.status}.` };
    return { data: (await response.json()) as LedgerResponse };
  } catch {
    return { error: `Could not reach the game server at ${base}.` };
  }
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: { q?: string; type?: string; status?: string; skip?: string };
}) {
  const result = await loadLedger({
    q: searchParams.q?.trim(),
    type: searchParams.type,
    status: searchParams.status,
    skip: Math.max(0, Number(searchParams.skip) || 0),
  });

  return (
    <>
      <header className="admin__head">
        <h1 className="admin__title">Transactions</h1>
        <p className="admin__sub">
          Full ledger of deposits, withdrawals, bets and wins. Manual admin
          adjustments appear as deposits and withdrawals.
        </p>
      </header>

      {result.error ? (
        <div className="admin__error" role="alert">
          <strong>Ledger unavailable.</strong> {result.error}
        </div>
      ) : (
        <Suspense fallback={<div className="tbl__empty">Loading…</div>}>
          <LedgerTable
            rows={result.data!.transactions}
            total={result.data!.total}
            skip={result.data!.skip}
            take={result.data!.take}
          />
        </Suspense>
      )}
    </>
  );
}
