'use client';

/**
 * FRIGAT — Admin access gate (client side)
 *
 * Replaces the layout's hard `redirect('/login')` with a rendered refusal. The
 * redirect was the loop: a signed-in non-admin was sent to /login, signed in
 * successfully, came back, and was sent away again. Telling them "not an
 * administrator" on the page ends it in one hop — signing in *again* was never
 * going to change the answer.
 *
 * This is UX, not a security boundary. It reads the JWT without verifying the
 * signature, which a user can trivially forge; what actually protects admin
 * data is `requireAdmin` on the Fastify API, which re-authorises every request
 * and never sees this component.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';

import { readStoredToken } from '@/lib/token';

export interface GateUser {
  id: string;
  role: 'USER' | 'ADMIN';
}

type Phase =
  | { state: 'checking' }
  | { state: 'allowed'; user: GateUser }
  | { state: 'denied'; user: GateUser | null };

const AdminSessionContext = createContext<GateUser | null>(null);

export function useAdminSession(): GateUser | null {
  return useContext(AdminSessionContext);
}

function decodeToken(token: string | null): GateUser | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;

    const json = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    ) as Record<string, unknown>;

    const id =
      typeof json.userId === 'string'
        ? json.userId
        : typeof json.sub === 'string'
          ? json.sub
          : null;
    if (!id) return null;

    if (typeof json.exp === 'number' && json.exp * 1000 <= Date.now()) return null;

    return { id, role: json.role === 'ADMIN' ? 'ADMIN' : 'USER' };
  } catch {
    return null;
  }
}

export function AdminGate({
  serverUser,
  children,
}: {
  serverUser: GateUser | null;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>(() =>
    serverUser?.role === 'ADMIN'
      ? { state: 'allowed', user: serverUser }
      : { state: 'checking' }
  );

  useEffect(() => {
    if (phase.state !== 'checking') return;
    let cancelled = false;

    (async () => {
      // The cookie is httpOnly, so only the server can read it for us. It
      // answers 200 with a null user when there is no session — never a 401.
      let user: GateUser | null = null;
      try {
        const response = await fetch('/api/session', { cache: 'no-store' });
        if (response.ok) {
          const body = (await response.json()) as { user?: GateUser | null };
          user = body.user ?? null;
        }
      } catch {
        /* offline or dev server restarting — fall through to the token */
      }

      // Fallback for the local-dev case where the cookie was never set (or was
      // dropped by a restart) but the sign-in token is still in localStorage.
      if (!user) user = decodeToken(readStoredToken());

      if (cancelled) return;
      setPhase(
        user?.role === 'ADMIN' ? { state: 'allowed', user } : { state: 'denied', user }
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [phase.state]);

  if (phase.state === 'checking') {
    return (
      <div className="admin-gate" role="status">
        <p className="admin-gate__msg">Checking your access…</p>
      </div>
    );
  }

  if (phase.state === 'denied') {
    const signedIn = phase.user !== null;

    return (
      <div className="admin-gate" role="alert">
        <span className="admin-gate__brand">FRIGAT</span>
        <h1 className="admin-gate__title">Access denied</h1>
        <p className="admin-gate__msg">
          {signedIn
            ? 'This account is not an administrator. Signing in again will not change that — ask an existing administrator to grant the role.'
            : 'You are not signed in. Sign in with an administrator account to reach this area.'}
        </p>
        <div className="admin-gate__actions">
          {!signedIn && (
            <Link className="admin-gate__btn" href="/login">
              Sign in
            </Link>
          )}
          <Link className="admin-gate__btn admin-gate__btn--quiet" href="/games/crash">
            Back to the games
          </Link>
        </div>
      </div>
    );
  }

  return (
    <AdminSessionContext.Provider value={phase.user}>
      {children}
    </AdminSessionContext.Provider>
  );
}

/**
 * The signed-in admin's id, for the sidebar footer.
 *
 * Client-side on purpose: in development the id may come from the stored
 * token rather than a cookie the server component could read, so the server's
 * value is only a head start and this is the authoritative display.
 */
export function AdminWhoId() {
  const user = useAdminSession();
  return <code className="adm-side__who-id">{user?.id ?? '—'}</code>;
}
