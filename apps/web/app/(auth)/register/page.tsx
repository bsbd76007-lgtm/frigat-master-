'use client';

/**
 * FRIGAT — Create account
 *
 * Registration creates the user and their wallet server-side and returns a
 * session token, so a new player goes straight to the tables — no separate
 * sign-in step.
 */

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { AuthError, authenticate, DEFAULT_DESTINATION } from '@/app/(auth)/authClient';
const MIN_PASSWORD = 8;

function RegisterForm() {
  const router = useRouter();
  // Affiliate attribution rides in on the URL. An unknown code is ignored by
  // the API rather than blocking the sign-up, so nothing is validated here.
  const ref = useSearchParams().get('ref');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    if (password.length < MIN_PASSWORD) {
      setError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await authenticate('register', { email: email.trim(), password }, ref);
      router.replace(DEFAULT_DESTINATION);
      router.refresh();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="auth__card">
      <span className="auth__brand">FRIGAT</span>
      <h1 className="auth__title">Create account</h1>
      <p className="auth__sub">
        Your wallet is created with your account. Provably fair from the first bet.
      </p>

      {ref && (
        <p className="auth__sub" style={{ color: 'var(--fg-accent)' }}>
          You were invited — your account will be linked to your referrer.
        </p>
      )}

      {error && (
        <p className="auth__error" role="alert">
          {error}
        </p>
      )}

      <form onSubmit={submit} noValidate>
        <div className="auth__field">
          <label className="auth__label" htmlFor="register-email">
            Email
          </label>
          <input
            id="register-email"
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
          <label className="auth__label" htmlFor="register-password">
            Password
          </label>
          <input
            id="register-password"
            className="auth__input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            required
            disabled={busy}
            aria-describedby="register-password-hint"
          />
          <span className="auth__hint" id="register-password-hint">
            At least {MIN_PASSWORD} characters.
          </span>
        </div>

        <div className="auth__field">
          <label className="auth__label" htmlFor="register-confirm">
            Confirm password
          </label>
          <input
            id="register-confirm"
            className="auth__input"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
            disabled={busy}
          />
        </div>

        <button type="submit" className="auth__submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="auth__alt">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="auth__card" />}>
      <RegisterForm />
    </Suspense>
  );
}
