'use client';


import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { UserDrawer, type AdminUserRow } from '@/app/admin/users/UserDrawer';

import { formatDecimalString } from '@/lib/decimal';

export function UsersTable({
  users,
  total,
  skip,
  take,
}: {
  users: AdminUserRow[];
  total: number;
  skip: number;
  take: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [selected, setSelected] = useState<AdminUserRow | null>(null);

  useEffect(() => {
    if (!selected) return;
    const next = users.find((u) => u.id === selected.id);
    if (next && next !== selected) setSelected(next);
  }, [users, selected]);

  const applyQuery = (value: string, nextSkip = 0) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set('q', value);
    else next.delete('q');
    if (nextSkip) next.set('skip', String(nextSkip));
    else next.delete('skip');
    router.push(`/admin/users?${next.toString()}`);
  };

  return (
    <>
      <form
        className="filters"
        onSubmit={(event) => {
          event.preventDefault();
          applyQuery(query.trim());
        }}
      >
        <div className="filters__search">
          <input
            className="ainput"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search email, Telegram ID, or exact user ID"
            aria-label="Search users"
          />
        </div>
        <button type="submit" className="abtn">Search</button>
        {params.get('q') && (
          <button type="button" className="abtn" onClick={() => { setQuery(''); applyQuery(''); }}>
            Clear
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--admin-muted)' }}>
          {total.toLocaleString()} user{total === 1 ? '' : 's'}
        </span>
      </form>

      <div className="tbl__wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>User ID</th><th>Email</th><th>Telegram</th>
              <th className="tbl__num">Balance</th>
              <th className="tbl__num">Referred</th>
              <th className="tbl__num">RevShare</th>
              <th>Role</th><th>Status</th><th>Created</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td className="tbl__empty" colSpan={9}>No users match that search.</td></tr>
            ) : (
              users.map((user) => (
                <tr
                  key={user.id}
                  className="is-clickable"
                  tabIndex={0}
                  onClick={() => setSelected(user)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelected(user);
                    }
                  }}
                  aria-label={`Manage ${user.email}`}
                >
                  <td className="tbl__mono">{user.id}</td>
                  <td>{user.email}</td>
                  <td className="tbl__mono">{user.telegramId ?? '—'}</td>
                  <td className="tbl__num">{formatDecimalString(user.balance, 2)}</td>
                  <td className="tbl__num">
                    {user.referredCount > 0 ? user.referredCount.toLocaleString() : '—'}
                  </td>
                  <td className="tbl__num">{formatDecimalString(user.revSharePercentage, 2)}%</td>
                  <td><span className={`tag tag--${user.role.toLowerCase()}`}>{user.role}</span></td>
                  <td>
                    <span className={`tag ${user.frozen ? 'tag--frozen' : 'tag--active'}`}>
                      {user.frozen ? 'Frozen' : 'Active'}
                    </span>
                  </td>
                  <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > take && (
        <div className="pager">
          <button type="button" className="abtn" disabled={skip === 0}
            onClick={() => applyQuery(params.get('q') ?? '', Math.max(0, skip - take))}>
            Previous
          </button>
          <span>{skip + 1}–{Math.min(skip + take, total)} of {total}</span>
          <button type="button" className="abtn" disabled={skip + take >= total}
            onClick={() => applyQuery(params.get('q') ?? '', skip + take)}>
            Next
          </button>
        </div>
      )}

      {selected && <UserDrawer user={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
