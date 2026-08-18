'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AdminWhoId } from '@/app/admin/AdminGate';

import { writeStoredToken } from '@/lib/token';

const COLLAPSE_KEY = 'frigat.admin.sidebarCollapsed';

export interface AdminNavItem {
  href: string;
  label: string;
  icon: string;
  hint?: string;
}

export interface AdminNavGroup {
  title: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    title: 'Overview',
    items: [
      {
        href: '/admin/dashboard',
        label: 'Dashboard',
        icon: '▤',
        hint: 'GGR, wagers, players',
      },
    ],
  },
  {
    title: 'Operations',
    items: [
      {
        href: '/admin/users',
        label: 'User Management',
        icon: '◉',
        hint: 'Balances, bans, roles',
      },
      {
        href: '/admin/withdrawals',
        label: 'Payments & Withdrawals',
        icon: '⇅',
        hint: 'Approve or reject payouts',
      },
      {
        href: '/admin/transactions',
        label: 'Transactions',
        icon: '⇄',
        hint: 'Full ledger history',
      },
      {
        href: '/admin/support',
        label: 'Live Support',
        icon: '☎',
        hint: 'Player conversations',
      },
    ],
  },
  {
    title: 'Analysis',
    items: [
      {
        href: '/admin/game-analytics',
        label: 'Game Analytics',
        icon: '◈',
        hint: 'Win rates, house edge',
      },
      {
        href: '/admin/risk-control',
        label: 'Risk Controls',
        icon: '⚑',
        hint: 'Limits, maintenance mode',
      },
    ],
  },
  {
    title: 'System',
    items: [
      {
        href: '/admin/security',
        label: 'Logs & Security',
        icon: '⛨',
        hint: 'Sockets, sessions, access',
      },
      {
        href: '/admin/audit-logs',
        label: 'Audit Logs',
        icon: '☰',
        hint: 'Every admin action',
      },
    ],
  },
];

export function AdminSidebar({ adminId }: { adminId?: string | null }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* no-op */
    }
  }, []);

  const toggle = () => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* no-op */
      }
      return next;
    });
  };

  const signOut = async () => {
    setIsBusy(true);
    try {
      await fetch('/api/session', { method: 'DELETE' });
    } finally {
      writeStoredToken(null);
      window.location.replace('/login');
    }
  };

  return (
    <aside
      className={collapsed ? 'adm-side adm-side--collapsed' : 'adm-side'}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className="adm-side__brand">
        {/* Wordmark only. The frigat-model asset already carries the word
            "FRIGAT" under its monogram, so pairing it with a text label
            printed the brand name twice in a 240px column. */}
        <Link href="/admin/dashboard" className="adm-side__mark">
          <span className="adm-side__word">{collapsed ? 'F' : 'Frigat'}</span>
        </Link>
        {!collapsed && <span className="adm-side__tag">Admin</span>}
        <button
          type="button"
          className="adm-side__toggle"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <nav className="adm-side__nav" aria-label="Admin sections">
        {ADMIN_NAV.map((group) => (
          <div key={group.title} className="adm-side__group">
            {!collapsed && (
              <span className="adm-side__group-title">{group.title}</span>
            )}
            {group.items.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="adm-side__link"
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="adm-side__icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  {!collapsed && (
                    <span className="adm-side__text">
                      <b>{item.label}</b>
                      {item.hint && <small>{item.hint}</small>}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="adm-side__foot">
        {!collapsed && (
          <div className="adm-side__who">
            <span className="adm-side__who-role">Administrator</span>
            {/* Falls back to the client session when the server could not read
                the cookie, which is the common case in development. */}
            {adminId ? <code className="adm-side__who-id">{adminId}</code> : <AdminWhoId />}
          </div>
        )}
        <button
          type="button"
          className="adm-side__signout"
          onClick={signOut}
          disabled={isBusy}
          title={collapsed ? 'Sign out' : undefined}
        >
          {collapsed ? '⏻' : isBusy ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </aside>
  );
}

export default AdminSidebar;
