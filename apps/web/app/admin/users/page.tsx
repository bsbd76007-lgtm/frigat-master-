import { Suspense } from 'react';
import { cookies } from 'next/headers';

import { UsersTable } from '@/app/admin/users/UsersTable';
import type { AdminUserRow } from '@/app/admin/users/UserDrawer';

import { SESSION_COOKIE } from '@/lib/adminAuth';
export const dynamic = 'force-dynamic';

interface UsersResponse {
  total: number;
  take: number;
  skip: number;
  users: AdminUserRow[];
}

async function loadUsers(q: string, skip: number) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const base = process.env.API_URL ?? 'http://localhost:4000';
  const search = new URLSearchParams({ take: '25', skip: String(skip) });
  if (q) search.set('q', q);

  try {
    const response = await fetch(`${base}/api/admin/users?${search}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!response.ok) return { error: `Users API returned ${response.status}.` };
    return { data: (await response.json()) as UsersResponse };
  } catch {
    return { error: `Could not reach the game server at ${base}.` };
  }
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: { q?: string; skip?: string };
}) {
  const q = (searchParams.q ?? '').trim();
  const skip = Math.max(0, Number(searchParams.skip) || 0);
  const result = await loadUsers(q, skip);

  return (
    <>
      <header className="admin__head">
        <h1 className="admin__title">Users</h1>
        <p className="admin__sub">
          Search accounts, adjust balances, change roles and freeze players.
          Every change is written to the audit log.
        </p>
      </header>

      {result.error ? (
        <div className="admin__error" role="alert">
          <strong>Users unavailable.</strong> {result.error}
        </div>
      ) : (
        <Suspense fallback={<div className="tbl__empty">Loading…</div>}>
          <UsersTable
            users={result.data!.users}
            total={result.data!.total}
            skip={result.data!.skip}
            take={result.data!.take}
          />
        </Suspense>
      )}
    </>
  );
}
