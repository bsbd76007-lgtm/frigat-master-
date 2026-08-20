/**
 * FRIGAT — Audit logs
 *
 * Read-only view of AdminAuditLog: every balance adjustment, role change,
 * freeze, withdrawal decision and risk-config change, with the acting admin
 * and the reason given. Entries are written inside the same transaction as the
 * action itself, so this trail cannot fall out of step with what happened.
 */

import { cookies } from 'next/headers';

import { AuditTable, type AuditEntry } from '@/app/admin/audit-logs/AuditTable';

import { SESSION_COOKIE } from '@/lib/adminAuth';
import { API_URL } from '@/lib/endpoints';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface AuditResponse {
  total: number;
  take: number;
  skip: number;
  actions: string[];
  entries: AuditEntry[];
}

async function loadAudit(params: { action?: string; q?: string; skip: number }) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const base = API_URL;
  const search = new URLSearchParams({ take: '50', skip: String(params.skip) });
  if (params.action) search.set('action', params.action);
  if (params.q) search.set('q', params.q);

  try {
    const response = await fetch(`${base}/api/admin/audit-logs?${search}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!response.ok) return { error: `Audit API returned ${response.status}.` };
    return { data: (await response.json()) as AuditResponse };
  } catch {
    return { error: `Could not reach the game server at ${base}.` };
  }
}

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: { action?: string; q?: string; skip?: string };
}) {
  const result = await loadAudit({
    action: searchParams.action,
    q: searchParams.q?.trim(),
    skip: Math.max(0, Number(searchParams.skip) || 0),
  });

  return (
    <>
      <header className="admin__head">
        <h1 className="admin__title">Audit Logs</h1>
        <p className="admin__sub">
          Every privileged action, recorded atomically with the change it
          describes. This view is read-only — entries cannot be edited or
          removed from the console.
        </p>
      </header>

      {result.error ? (
        <div className="admin__error" role="alert">
          <strong>Audit log unavailable.</strong> {result.error}
        </div>
      ) : (
        <AuditTable
          entries={result.data!.entries}
          actions={result.data!.actions}
          total={result.data!.total}
          skip={result.data!.skip}
          take={result.data!.take}
        />
      )}
    </>
  );
}
