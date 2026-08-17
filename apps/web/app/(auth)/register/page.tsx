'use client';

/**
 * FRIGAT — Create account
 *
 * Two steps, because an account is no longer created from a form submission
 * alone: step one validates the address and password and asks the server for a
 * code, step two spends that code to create the User and Wallet and open the
 * session.
 *
 * Nothing exists in the database between the two — an abandoned sign-up leaves
 * a code row that expires in five minutes, not a half-made account.
 */

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { PASSWORD_POLICY, passwordProblems } from '@frigat/shared';

import {
  AuthError,
  confirmRegistration,
  DEFAULT_DESTINATION,
  requestRegistrationCode,
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
import { evaluatePassword } from '@/app/(auth)/passwordRules';
import { PasswordChecklist } from '@/app/(auth)/PasswordChecklist';

const MIN_PASSWORD = PASSWORD_POLICY.minLength;

function RegisterForm() {
  const router = useRouter();
  const ref = useSearchParams().get('ref');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Set once the server has accepted the details and emailed a code. Its
  // presence is the second step.
  const [challenge, setChallenge] = useState<CodeChallenge | null>(null);
  const [digits, setDigits] = useState<string[]>(emptyDigits);
  const [cooldown, setCooldown] = useState(0);

  // Single-use token: reset the widget after every attempt, or the retry
  // replays one Cloudflare has already redeemed.
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef<TurnstileHandle>(null);

  // Mirrors the server's policy from @frigat/shared, so the form cannot promise
  // something the API will refuse.
  const { failing, ready: passwordReady } = evaluatePassword(password);

  // Resend countdown, anchored to a deadline so a backgrounded tab does not
  // drift out of step with the server's cooldown.
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

  /** Step one: hand the details to the server, which emails a code. */
  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    const weaknesses = passwordProblems(password);
    if (weaknesses.length > 0) {
      setError(
        `Password needs: ${weaknesses.map((w) => w.message.toLowerCase()).join(', ')}.`
      );
      return;
    }
    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await requestRegistrationCode(
        { email: email.trim(), password, turnstileToken },
        ref
      );
      // Step one's widget unmounts with the form; clearing the token stops a
      // spent value being sent while step two's fresh widget is still solving.
      setTurnstileToken('');
      setChallenge(result);
      setDigits(emptyDigits());
      setCooldown(result.resendAfterSeconds);
      focusFirstOtpBox();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Something went wrong. Try again.');
    } finally {
      // Single-use token: spent by the attempt whatever the outcome, so the
      // next click needs a fresh one.
      turnstileRef.current?.reset();
      setBusy(false);
    }
  };

  /** Step two: the code creates the account. Fires on the sixth digit. */
  const submitCode = useCallback(
    async (code: string) => {
      if (busy || !challenge || code.length !== OTP_DIGITS) return;

      setBusy(true);
      setError(null);
      try {
        await confirmRegistration(challenge.email, code, ref);
        router.replace(DEFAULT_DESTINATION);
        router.refresh();
      } catch (err) {
        setError(err instanceof AuthError ? err.message : 'Could not verify that code.');
        setDigits(emptyDigits());
        focusFirstOtpBox();
        setBusy(false);
      } finally {
        // Keeps the resend control armed with a fresh token after any attempt.
        turnstileRef.current?.reset();
      }
    },
    [busy, challenge, ref, router]
  );

  /** Re-submits step one, minting a fresh code and restarting the wait. */
  const resendCode = async () => {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestRegistrationCode(
        { email: email.trim(), password, turnstileToken },
        ref
      );
      setChallenge(result);
      setDigits(emptyDigits());
      setCooldown(result.resendAfterSeconds);
      focusFirstOtpBox();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not send another code.');
    } finally {
      // Spent either way — resending goes back through the guarded route.
      turnstileRef.current?.reset();
      setBusy(false);
    }
  };

  // ── Step two ──
  if (challenge) {
    return (
      <div className="auth__card">
        <span className="auth__brand">FRIGAT</span>
        <h1 className="auth__title">Verify your email</h1>
        <p className="auth__sub">
          We sent a {OTP_DIGITS}-digit code to <strong>{challenge.email}</strong>. Enter
          it to finish creating your account — nothing is saved until you do.
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
          idPrefix="register"
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
          {busy ? 'Creating account…' : 'Verify and create account'}
        </button>

        {/* Mounted for the resend control, which goes back through the guarded
            request-code route and needs a token of its own. */}
        <Turnstile
          ref={turnstileRef}
          onToken={setTurnstileToken}
          action="register-resend"
        />

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
            onClick={() => {
              setChallenge(null);
              setDigits(emptyDigits());
              setError(null);
              setCooldown(0);
            }}
          >
            Change details
          </button>
        </div>
      </div>
    );
  }

  // ── Step one ──
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

      <form onSubmit={requestCode} noValidate>
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
          <span className="auth__hint">
            We will email a {OTP_DIGITS}-digit code here to confirm the address.
          </span>
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
            aria-invalid={password.length > 0 && !passwordReady ? true : undefined}
          />
          <PasswordChecklist
            password={password}
            failing={failing}
            id="register-password-hint"
          />
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

        <Turnstile ref={turnstileRef} onToken={setTurnstileToken} action="register" />

        <button
          type="submit"
          className="auth__submit"
          disabled={busy || (isTurnstileConfigured() && !turnstileToken)}
        >
          {busy ? 'Sending code…' : 'Verify email'}
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
