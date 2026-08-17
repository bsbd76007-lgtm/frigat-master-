'use client';

/**
 * FRIGAT — Sign in with an emailed code
 *
 * Two steps: ask for a code, then type it. This is the passwordless path — an
 * address alone opens (or creates) an account, no password involved.
 *
 * The six-box input itself lives in `OtpDigits`, shared with the password
 * second factor and with registration.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AuthError, sendLoginCode, verifyLoginCode, type AuthedUser } from '@/app/(auth)/authClient';
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

const DIGITS = OTP_DIGITS;

export interface OtpFormProps {
  onAuthenticated: (user: AuthedUser) => void;
  referral?: string | null;
}

export function OtpForm({ onAuthenticated, referral }: OtpFormProps) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState<string[]>(emptyDigits);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // /api/auth/otp/send is Turnstile-guarded: it mails an address the caller
  // chooses, so it is the endpoint most worth protecting.
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef<TurnstileHandle>(null);

  const code = digits.join('');
  const emailValid = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()), [email]);

  // Resend countdown. Anchored to a deadline rather than decremented blindly so
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

  const requestCode = useCallback(async () => {
    if (busy || !emailValid || cooldown > 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await sendLoginCode(email.trim().toLowerCase(), turnstileToken);
      setStep('code');
      setCooldown(result.resendAfterSeconds);
      setDigits(emptyDigits());
      setNotice(
        result.devCode
          ? `Development mode — no email was sent. Your code is ${result.devCode}.`
          : `We sent a ${DIGITS}-digit code to ${email.trim()}. It expires in ${Math.round(result.expiresInSeconds / 60)} minutes.`
      );
      focusFirstOtpBox();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not send a code. Try again.');
    } finally {
      // Single-use, so the widget is reset whether the send succeeded (resend
      // needs a new one) or failed (retry needs a new one).
      turnstileRef.current?.reset();
      setBusy(false);
    }
  }, [busy, email, emailValid, cooldown, turnstileToken]);

  const submitCode = useCallback(
    async (value: string) => {
      if (busy || value.length !== DIGITS) return;
      setBusy(true);
      setError(null);

      try {
        const user = await verifyLoginCode(email.trim().toLowerCase(), value, referral);
        onAuthenticated(user);
      } catch (err) {
        setError(err instanceof AuthError ? err.message : 'Could not verify that code.');
        setDigits(emptyDigits());
        focusFirstOtpBox();
        setBusy(false);
      }
    },
    [busy, email, referral, onAuthenticated]
  );

  if (step === 'email') {
    return (
      <div>
        {error && (
          <p className="auth__error" role="alert">
            {error}
          </p>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void requestCode();
          }}
          noValidate
        >
          <div className="auth__field">
            <label className="auth__label" htmlFor="otp-email">
              Email
            </label>
            <input
              id="otp-email"
              className="auth__input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              disabled={busy}
            />
            <span className="auth__hint">
              We will email you a {DIGITS}-digit code. No password needed — if you
              have not played before, this creates your account.
            </span>
          </div>

          <Turnstile
            ref={turnstileRef}
            onToken={setTurnstileToken}
            action="otp-send"
          />

          <button
            type="submit"
            className="auth__submit"
            disabled={
              busy || !emailValid || (isTurnstileConfigured() && !turnstileToken)
            }
          >
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <p className="auth__error" role="alert">
          {error}
        </p>
      )}
      {!error && notice && (
        <p className="auth__notice" role="status">
          {notice}
        </p>
      )}

      <OtpDigits
        idPrefix="otp-login"
        digits={digits}
        onDigitsChange={setDigits}
        onComplete={(value) => void submitCode(value)}
        disabled={busy}
      />

      <button
        type="button"
        className="auth__submit"
        disabled={busy || code.length !== DIGITS}
        onClick={() => void submitCode(code)}
      >
        {busy ? 'Verifying…' : 'Verify and sign in'}
      </button>

      {/* Resending goes back through the guarded send endpoint, so this step
          mounts its own widget — the email step's unmounted with it. */}
      <Turnstile ref={turnstileRef} onToken={setTurnstileToken} action="otp-resend" />

      <div className="auth__otp-foot">
        <button
          type="button"
          className="auth__link-btn"
          disabled={
            busy || cooldown > 0 || (isTurnstileConfigured() && !turnstileToken)
          }
          onClick={() => void requestCode()}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
        </button>
        <button
          type="button"
          className="auth__link-btn"
          disabled={busy}
          onClick={() => {
            setStep('email');
            setDigits(emptyDigits());
            setError(null);
            setNotice(null);
          }}
        >
          Use a different email
        </button>
      </div>
    </div>
  );
}

export default OtpForm;
