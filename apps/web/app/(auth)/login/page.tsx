'use client';

/**
 * FRIGAT — Sign in
 *
 * Exchanges email + password at the API for a session JWT, stores it, and
 * sends the player to the tables. This is also where the admin middleware
 * lands unauthenticated visitors, so it honours its `?error=` and `?next=`.
 */

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { ADMIN_DESTINATION, AuthError, authenticate, safeDestination } from '@/app/(auth)/authClient';
const REDIRECT_COPY: Record<string, string> = {
  required: 'Sign in to continue.',
  invalid: 'That session has expired. Sign in again.',
  forbidden: 'That account is not an administrator.',
  misconfigured:
    'The server is missing JWT_SECRET, so sessions cannot be verified. Admin access is disabled until it is set.',
};

function LoginForm() {
  const params = useSearchParams();
  const redirectReason = params.get('error');
  const next = params.get('next');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      const user = await authenticate('login', { email: email.trim(), password });

      // An admin lands on the dashboard, a player on the tables — unless a
      // `?next=` from the middleware already says where they were headed.
      //
      // A non-admin is never sent to `next` when it points into /admin, however
      // stale or hand-edited the link: that page would bounce them straight back
      // here, and the two would trade redirects indefinitely.
      const wantsAdmin = next?.startsWith('/admin') ?? false;
      const useNext = next !== null && (!wantsAdmin || user.role === 'ADMIN');

      const destination = useNext
        ? safeDestination(next)
        : user.role === 'ADMIN'
          ? ADMIN_DESTINATION
          : safeDestination(null);

      // A full page load, not router.replace: the client router would carry the
      // anonymous RSC cache and the signed-out component state into the next
      // page, and the middleware would not re-run against the cookie that was
      // just set. `replace` keeps the back button off this now-stale form.
      window.location.replace(destination);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Something went wrong. Try again.');
      setBusy(false); // stays disabled on success while the route changes
    }
  };

  const banner = error ?? (redirectReason ? REDIRECT_COPY[redirectReason] : null);

  return (
    <div className="auth__card">
      <span className="auth__brand">FRIGAT</span>
      <h1 className="auth__title">Sign in</h1>
      <p className="auth__sub">Welcome back. Enter your details to reach the tables.</p>

      {banner && (
        <p className="auth__error" role="alert">
          {banner}
        </p>
      )}

      <form onSubmit={submit} noValidate>
        <div className="auth__field">
          <label className="auth__label" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            className="auth__input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
            disabled={busy}
            aria-invalid={error ? true : undefined}
          />
        </div>

        <div className="auth__field">
          <label className="auth__label" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            className="auth__input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
            disabled={busy}
            aria-invalid={error ? true : undefined}
          />
        </div>

        <button type="submit" className="auth__submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="auth__alt">
        New to FRIGAT? <Link href="/register">Create an account</Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="auth__card" />}>
      <LoginForm />
    </Suspense>
  );
}
