'use client';

/**
 * FRIGAT — Admin header bar
 *
 * Search, theme toggle, notification dropdown and profile badge.
 *
 * The notification list is not decorative: it is derived from live operational
 * state (pending payouts, frozen accounts, maintenance mode), so the badge
 * count means "things are waiting for you" rather than "you have unread
 * marketing". A dot that never corresponds to work trains operators to ignore
 * it, which is worse than having no dot.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { apiJson } from '@/lib/api';
import { API_URL } from '@/lib/token';

const THEME_KEY = 'frigat.admin.theme';

export interface AdminAlert {
  id: string;
  severity: 'info' | 'warn' | 'urgent';
  text: string;
  href?: string;
}

interface MetricsShape {
  pendingWithdrawalCount: number;
  pendingWithdrawalAmount: string;
  activeConnections: number;
}

export function AdminHeader({
  adminId,
  onSearch,
}: {
  adminId?: string | null;
  onSearch?: (query: string) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [isMenuOpen, setMenuOpen] = useState(false);
  const [light, setLight] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(THEME_KEY);
    } catch {
      /* no-op */
    }
    const isLight = stored === 'light';
    setLight(isLight);
    document.documentElement.setAttribute('data-admin-theme', isLight ? 'light' : 'dark');
  }, []);

  const toggleTheme = useCallback(() => {
    setLight((previous) => {
      const next = !previous;
      document.documentElement.setAttribute(
        'data-admin-theme',
        next ? 'light' : 'dark'
      );
      try {
        window.localStorage.setItem(THEME_KEY, next ? 'light' : 'dark');
      } catch {
        /* no-op */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const metrics = await apiJson<MetricsShape>(`${API_URL}/api/admin/metrics`);
        if (cancelled) return;

        const next: AdminAlert[] = [];
        if (metrics.pendingWithdrawalCount > 0) {
          next.push({
            id: 'payouts',
            severity: metrics.pendingWithdrawalCount > 5 ? 'urgent' : 'warn',
            text: `${metrics.pendingWithdrawalCount} withdrawal${
              metrics.pendingWithdrawalCount === 1 ? '' : 's'
            } awaiting approval`,
            href: '/admin/withdrawals',
          });
        }
        next.push({
          id: 'sockets',
          severity: 'info',
          text: `${metrics.activeConnections} live player connection${
            metrics.activeConnections === 1 ? '' : 's'
          }`,
          href: '/admin/security',
        });
        setAlerts(next);
      } catch {
        /* no-op */
      }
    };

    void load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [isMenuOpen]);

  const actionable = useMemo(
    () => alerts.filter((alert) => alert.severity !== 'info').length,
    [alerts]
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    if (onSearch) onSearch(trimmed);
    else router.push(`/admin/users?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <header className="adm-head">
      <form className="adm-head__search" onSubmit={submit} role="search">
        <span className="adm-head__search-icon" aria-hidden="true">
          ⌕
        </span>
        <input
          type="search"
          placeholder="Search users by email or ID…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search users"
        />
      </form>

      <div className="adm-head__right">
        <button
          type="button"
          className="adm-head__icon-btn"
          onClick={toggleTheme}
          aria-label={light ? 'Switch to dark theme' : 'Switch to light theme'}
          title={light ? 'Dark mode' : 'Light mode'}
        >
          {light ? '☾' : '☀'}
        </button>

        <div className="adm-head__notif" ref={panelRef}>
          <button
            type="button"
            className="adm-head__icon-btn"
            onClick={() => setMenuOpen((previous) => !previous)}
            aria-expanded={isMenuOpen}
            aria-haspopup="true"
            aria-label={`Notifications${actionable ? `, ${actionable} needing attention` : ''}`}
          >
            ⌁
            {actionable > 0 && <span className="adm-head__dot">{actionable}</span>}
          </button>

          {isMenuOpen && (
            <div className="adm-head__dropdown" role="menu">
              <div className="adm-head__dropdown-head">Notifications</div>
              {alerts.length === 0 ? (
                <p className="adm-head__empty">Nothing needs attention.</p>
              ) : (
                alerts.map((alert) => (
                  <a
                    key={alert.id}
                    className={`adm-head__alert adm-head__alert--${alert.severity}`}
                    href={alert.href ?? '#'}
                    role="menuitem"
                  >
                    <span className="adm-head__alert-dot" aria-hidden="true" />
                    {alert.text}
                  </a>
                ))
              )}
            </div>
          )}
        </div>

        <div className="adm-head__profile">
          <span className="adm-head__avatar" aria-hidden="true">
            A
          </span>
          <span className="adm-head__profile-text">
            <b>Administrator</b>
            {adminId && <small>{adminId.slice(0, 12)}…</small>}
          </span>
        </div>
      </div>
    </header>
  );
}

export default AdminHeader;
