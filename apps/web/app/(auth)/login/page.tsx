'use client';

import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import {
  ADMIN_DESTINATION,
  AuthError,
  safeDestination,
  submitPassword,
  verifyLoginCode,
  type AuthedUser,
  type CodeChallenge,
} from '@/app/(auth)/authClient';
import {
  emptyDigits,
  focusFirstOtpBox,
  OtpDigits,
  OTP_DIGITS,
} from '@/app/(auth)/OtpDigits';
import {

  isTurnstileConfigured,
  Turnstile,
  type TurnstileHandle,
} from '@/components/auth/Turnstile';

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

  // Set once the password has been accepted and a code is on its way. Its
  // presence *is* the second step — there is no separate step enum to keep in
  // sync with it.
  const [challenge, setChallenge] = useState<CodeChallenge | null>(null);
  const [digits, setDigits] = useState<string[]>(emptyDigits);
  const [cooldown, setCooldown] = useState(0);

  // A Turnstile token is single-use: every rejected submit has to reset the
  // widget, or the retry replays a token Cloudflare has already redeemed.
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef<TurnstileHandle>(null);
  const resetTurnstile = () => turnstileRef.current?.reset();

  /**
   * Where a signed-in user lands. Shared by both methods so they cannot drift:
   * an admin goes to the dashboard, a player to the tables — unless a `?next=`
   * from the middleware already says otherwise.
   *
   * A non-admin is never sent to a `next` pointing into /admin, however stale
   * or hand-edited the link: that page bounces them back here, and the two
   * would trade redirects indefinitely.
   */
  const destinationFor = (user: AuthedUser): string => {
    const wantsAdmin = next?.startsWith('/admin') ?? false;
    const useNext = next !== null && (!wantsAdmin || user.role === 'ADMIN');
    return useNext
      ? safeDestination(next)
      : user.role === 'ADMIN'
        ? ADMIN_DESTINATION
        : safeDestination(null);
  };

  // Resend countdown, anchored to a deadline rather than decremented blindly so
  // a backgrounded tab does not drift out of step with the server's cooldown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const deadline = Date.now() + cooldown * 1000;
    const timer = setInterval(() => {
      const left = Math.ceil((deadline - Date.now()) / 1000);
      setCooldown(left > 0 ? left : 0);
      if (left <= 0) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
    // Restarted only when a new cooldown is issued.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cooldown === 0]);

  /**
   * Step one. A correct password no longer signs anyone in — it earns a code,
   * and the form moves to the second step to collect it.
   */
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      const result = await submitPassword({
        email: email.trim(),
        password,
        turnstileToken,
      });

      // Admins and designated accounts skip the code entirely — the session is
      // already open by the time this resolves, so go straight to the
      // destination their role implies.
      if (!result.requiresOtp) {
        window.location.replace(destinationFor(result.user));
        return;
      }

      // Step one's widget unmounts with the form; the code step mounts its own
      // for the resend control. Clearing the token here means a stale, spent
      // value can never be sent while that fresh widget is still solving.
      setTurnstileToken('');
      setChallenge(result.challenge);
      setDigits(emptyDigits());
      setCooldown(result.challenge.resendAfterSeconds);
      focusFirstOtpBox();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Something went wrong. Try again.');
    } finally {
      // Reset on every outcome, not just failures. A Turnstile token is
      // single-use: once submitted it is spent, so a second click with the same
      // token is rejected as "Human verification failed" even when the password
      // is right. Resetting here means the next click always has a fresh one.
      resetTurnstile();
      setBusy(false);
    }
  };

  /** Step two: the code completes the sign-in the password started. */
  const submitCode = useCallback(
    async (code: string) => {
      if (busy || !challenge || code.length !== OTP_DIGITS) return;

      setBusy(true);
      setError(null);
      try {
        const user = await verifyLoginCode(challenge.email, code);
        window.location.replace(destinationFor(user));
      } catch (err) {
        setError(err instanceof AuthError ? err.message : 'Could not verify that code.');
        setDigits(emptyDigits());
        focusFirstOtpBox();
        setBusy(false);
      } finally {
        // Keeps the resend control armed with a fresh token after any attempt.
        // Not in the success branch alone: that path navigates away, and on
        // failure the player's next move is usually exactly that resend.
        resetTurnstile();
      }
    },
    // `destinationFor` reads only render-stable values from the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, challenge]
  );

  /** Re-submits the password, which mints a fresh code and restarts the wait. */
  const resendCode = async () => {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await submitPassword({
        email: email.trim(),
        password,
        turnstileToken,
      });

      // Not reachable in practice — a bypassed account never sees this step —
      // but the branch exists so a role changed mid-session lands somewhere
      // sensible instead of leaving the form stuck on a code that is not coming.
      if (!result.requiresOtp) {
        window.location.replace(destinationFor(result.user));
        return;
      }

      setChallenge(result.challenge);
      setDigits(emptyDigits());
      setCooldown(result.challenge.resendAfterSeconds);
      focusFirstOtpBox();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not send another code.');
    } finally {
      // Spent either way — resending goes back through the guarded login route.
      resetTurnstile();
      setBusy(false);
    }
  };

  /** Back to step one. The password is cleared — it is re-entered, not reused. */
  const restart = () => {
    setChallenge(null);
    setDigits(emptyDigits());
    setPassword('');
    setError(null);
    setCooldown(0);
  };

  const banner = error ?? (redirectReason ? REDIRECT_COPY[redirectReason] : null);

  // ── Step two: the emailed code ──
  // Rendered instead of the whole method chooser, not beside it: switching to
  // the passwordless tab mid-challenge would abandon a code already in flight.
  if (challenge) {
    return (
      <div className="auth__card">
        <span className="auth__brand">FRIGAT</span>
        <h1 className="auth__title">Check your email</h1>
        <p className="auth__sub">
          Your password was accepted. We sent a {OTP_DIGITS}-digit code to{' '}
          <strong>{challenge.email}</strong> to finish signing in.
        </p>

        {error && (
          <p className="auth__error" role="alert">
            {error}
          </p>
        )}
        {!error && challenge.devCode && (
          <p className="auth__notice" role="status">
            Development mode — no email was sent. Your code is {challenge.devCode}.
          </p>
        )}

        <OtpDigits
          idPrefix="login-2fa"
          digits={digits}
          onDigitsChange={setDigits}
          onComplete={(code) => void submitCode(code)}
          disabled={busy}
        />

        <button
          type="button"
          className="auth__submit"
          disabled={busy || digits.join('').length !== OTP_DIGITS}
          onClick={() => void submitCode(digits.join(''))}
        >
          {busy ? 'Verifying…' : 'Verify and sign in'}
        </button>

        {/* Mounted for the resend control, which goes back through the guarded
            login route and therefore needs a token of its own. */}
        <Turnstile ref={turnstileRef} onToken={setTurnstileToken} action="login-resend" />

        <div className="auth__otp-foot">
          <button
            type="button"
            className="auth__link-btn"
            disabled={
              busy || cooldown > 0 || (isTurnstileConfigured() && !turnstileToken)
            }
            onClick={() => void resendCode()}
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
          </button>
          <button
            type="button"
            className="auth__link-btn"
            disabled={busy}
            onClick={restart}
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

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
          <div className="auth__label-row">
            <label className="auth__label" htmlFor="login-password">
              Password
            </label>
            <Link className="auth__label-link" href="/forgot-password">
              Forgot password?
            </Link>
          </div>
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

        <Turnstile ref={turnstileRef} onToken={setTurnstileToken} action="login" />

        <button
          type="submit"
          className="auth__submit"
          disabled={busy || (isTurnstileConfigured() && !turnstileToken)}
        >
          {busy ? 'Checking…' : 'Continue'}
        </button>
        <p className="auth__hint">
          We will email you a {OTP_DIGITS}-digit code to confirm it is you.
        </p>
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
