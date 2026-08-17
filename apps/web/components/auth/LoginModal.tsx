'use client';

/**
 * FRIGAT — Email OTP sign-in
 *
 * Two steps: ask for an email, then verify the six digits sent to it. On
 * success the JWT is written through `writeStoredToken`, which is this app's
 * global auth state — `subscribeToToken` wakes GameSocketProvider, the socket
 * reconnects authenticated, and the dashboard drops its sign-in gate. The
 * token is also mirrored into the httpOnly cookie that middleware.ts reads,
 * because the Edge runtime cannot see localStorage.
 *
 * ── Why the transport is a prop ────────────────────────────────────────────
 * The two network calls are injected rather than hardcoded. This project has
 * no Supabase (no dependency, no project, no keys) and its own Fastify API has
 * no OTP endpoint yet, so binding either one in here would ship a modal that
 * cannot work. `defaultOtpTransport` targets the endpoint shape this app
 * already uses for sign-in; swap it for any other by passing `transport`.
 *
 * A Supabase binding, once @supabase/supabase-js is installed and configured,
 * is the same shape:
 *
 *   const supabaseTransport: OtpTransport = {
 *     requestCode: async (email) => {
 *       const { error } = await supabase.auth.signInWithOtp({ email });
 *       if (error) throw new OtpError(error.message);
 *     },
 *     verifyCode: async (email, token) => {
 *       const { data, error } = await supabase.auth.verifyOtp({
 *         email, token, type: 'email',
 *       });
 *       if (error) throw new OtpError(error.message);
 *       // NOTE: data.session is a Supabase session, not a FRIGAT JWT. The
 *       // socket and the ledger validate the latter, so this still needs a
 *       // server route that trades one for the other.
 *       return { token: data.session!.access_token, user: … };
 *     },
 *   };
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { API_URL, writeStoredToken } from '@/lib/token';
import { useInjectedStyles } from '@/lib/useInjectedStyles';

export const CODE_LENGTH = 6;
/** Seconds before a new code may be requested. */
export const RESEND_COOLDOWN = 30;

export interface OtpUser {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
}

export interface OtpSession {
  token: string;
  user: OtpUser;
}

/** Display-ready failure. Anything else is reported as a generic message. */
export class OtpError extends Error {}

export interface OtpTransport {
  requestCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<OtpSession>;
}

interface ApiError {
  error?: string;
  message?: string;
}

const FALLBACK_COPY: Record<string, string> = {
  invalid_email: 'Enter a valid email address.',
  invalid_code: 'That code is not right. Check the digits and try again.',
  code_expired: 'That code has expired. Request a new one.',
  too_many_requests: 'Too many attempts. Wait a few minutes and try again.',
  unknown_email: 'We could not find an account for that address.',
};

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new OtpError('Could not reach the FRIGAT server. Is it running?');
  }

  let payload: (T & ApiError) | ApiError = {};
  try {
    payload = (await response.json()) as T & ApiError;
  } catch {
    /* a body is optional on success */
  }

  if (!response.ok) {
    const code = (payload as ApiError).error;
    throw new OtpError(
      (payload as ApiError).message ??
        (code && FALLBACK_COPY[code]) ??
        `Request failed (${response.status}).`
    );
  }
  return payload as T;
}

/**
 * Targets this app's own API. Both routes still need building server-side:
 * `request` should mint a short-lived code and email it, `verify` should
 * check it and return the same `{ token, user }` shape /api/auth/login does.
 */
export const defaultOtpTransport: OtpTransport = {
  requestCode: (email) => post<void>('/api/auth/otp/request', { email }),
  verifyCode: (email, code) =>
    post<OtpSession>('/api/auth/otp/verify', { email, code }),
};

export interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (user: OtpUser) => void;
  transport?: OtpTransport;
}

const STYLE_ID = 'fg-login-modal-styles';

const CSS = `
.lgm__overlay { position: fixed; inset: 0; z-index: 1000; display: flex;
  align-items: center; justify-content: center; padding: 20px;
  background: rgba(7,13,18,.72); backdrop-filter: blur(4px);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.lgm__panel { width: 100%; max-width: 420px; padding: 28px; box-sizing: border-box;
  color: #e2e8f0; background: #121c24; border: 1px solid #1e293b;
  border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0,0,0,.7); }
.lgm__head { display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; }
.lgm__title { margin: 0; font-size: 19px; font-weight: 800; }
.lgm__sub { margin: 7px 0 0; font-size: 13px; line-height: 1.5; color: #94a3b8; }
.lgm__sub b { color: #e2e8f0; font-weight: 700; }
.lgm__close { flex: 0 0 auto; width: 32px; height: 32px; display: flex;
  align-items: center; justify-content: center; color: #94a3b8; background: transparent;
  border: 1px solid #1e293b; border-radius: 8px; cursor: pointer;
  transition: color .2s ease, background .2s ease; }
.lgm__close:hover { color: #fff; background: #1e293b; }
.lgm__close:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.35); }

.lgm__form { margin-top: 22px; display: flex; flex-direction: column; gap: 14px; }
.lgm__label { font-size: 11px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: #64748b; }
.lgm__input { width: 100%; box-sizing: border-box; padding: 13px 14px;
  font-family: inherit; font-size: 15px; color: #f1f5f9; background: #0b141b;
  border: 1px solid #1e293b; border-radius: 10px; outline: none;
  transition: border-color .2s ease, box-shadow .2s ease; }
.lgm__input:focus-visible { border-color: var(--fg-accent); box-shadow: 0 0 0 3px rgba(34,197,94,.22); }
.lgm__input[aria-invalid="true"] { border-color: #ef4444; }
.lgm__input:disabled { opacity: .55; cursor: not-allowed; }

/* Six single-character boxes; the group behaves as one field. */
.lgm__code { display: flex; gap: 8px; justify-content: space-between; }
.lgm__digit { width: 100%; min-width: 0; height: 56px; padding: 0; text-align: center;
  font-family: inherit; font-size: 22px; font-weight: 800;
  font-variant-numeric: tabular-nums; color: #f1f5f9; background: #0b141b;
  border: 1px solid #1e293b; border-radius: 10px; outline: none;
  transition: border-color .15s ease, box-shadow .15s ease; }
.lgm__digit:focus-visible { border-color: var(--fg-accent); box-shadow: 0 0 0 3px rgba(34,197,94,.22); }
.lgm__digit--filled { border-color: #334155; }
.lgm__digit--error { border-color: #ef4444; }
.lgm__digit:disabled { opacity: .55; cursor: not-allowed; }

.lgm__error { margin: 0; padding: 10px 12px; font-size: 12.5px; font-weight: 600;
  color: #d69199; background: rgba(239,68,68,.12);
  border: 1px solid rgba(239,68,68,.35); border-radius: 10px; }
.lgm__note { margin: 0; font-size: 12px; color: #64748b; text-align: center; }

.lgm__submit { width: 100%; padding: 14px; font-family: inherit; font-size: 15px;
  font-weight: 800; color: #0b0e14; background: linear-gradient(90deg, var(--fg-accent), var(--fg-accent-deep));
  border: none; border-radius: 10px; cursor: pointer;
  transition: background .2s ease, box-shadow .2s ease, transform .12s ease; }
.lgm__submit:hover:not(:disabled) { background: linear-gradient(90deg, var(--fg-pos), var(--fg-accent)); }
.lgm__submit:active:not(:disabled) { transform: translateY(1px); }
.lgm__submit:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.45); }
.lgm__submit:disabled { opacity: .45; cursor: not-allowed; }

.lgm__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.lgm__link { padding: 6px 2px; font-family: inherit; font-size: 12.5px; font-weight: 700;
  color: #94a3b8; background: none; border: none; cursor: pointer;
  transition: color .2s ease; }
.lgm__link:hover:not(:disabled) { color: #e2e8f0; }
.lgm__link:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.35);
  border-radius: 6px; }
.lgm__link:disabled { opacity: .5; cursor: not-allowed; }
`;

/** Trimmed, lower-cased, and shaped like an address. */
function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export default function LoginModal({
  open,
  onClose,
  onSuccess,
  transport = defaultOtpTransport,
}: LoginModalProps) {
  useInjectedStyles(STYLE_ID, CSS);

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState<string[]>(() => Array(CODE_LENGTH).fill(''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [mounted, setMounted] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const digitRefs = useRef<Array<HTMLInputElement | null>>([]);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const code = digits.join('');
  const codeComplete = code.length === CODE_LENGTH;
  const emailValid = useMemo(() => isEmail(normaliseEmail(email)), [email]);

  useEffect(() => setMounted(true), []);

  // Reset on close, so a reopened dialog never shows a stale code or error.
  useEffect(() => {
    if (open) return;
    setStep('email');
    setDigits(Array(CODE_LENGTH).fill(''));
    setError(null);
    setBusy(false);
    setCooldown(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const focus = window.setTimeout(() => {
      if (step === 'email') emailRef.current?.focus();
      else digitRefs.current[0]?.focus();
    }, 20);
    return () => window.clearTimeout(focus);
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
      returnFocusRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  const describe = (err: unknown): string =>
    err instanceof OtpError ? err.message : 'Something went wrong. Try again.';

  const requestCode = useCallback(
    async (resend = false) => {
      const address = normaliseEmail(email);
      if (!isEmail(address)) {
        setError(FALLBACK_COPY.invalid_email);
        emailRef.current?.focus();
        return;
      }

      setBusy(true);
      setError(null);
      try {
        await transport.requestCode(address);
        setDigits(Array(CODE_LENGTH).fill(''));
        setStep('code');
        setCooldown(RESEND_COOLDOWN);
        if (resend) digitRefs.current[0]?.focus();
      } catch (err) {
        setError(describe(err));
      } finally {
        setBusy(false);
      }
    },
    [email, transport]
  );

  const verifyCode = useCallback(async () => {
    if (!codeComplete) return;
    setBusy(true);
    setError(null);
    try {
      const session = await transport.verifyCode(normaliseEmail(email), code);

      // This is the app's global auth: subscribeToToken notifies
      // GameSocketProvider, which reconnects the socket as this user.
      writeStoredToken(session.token);

      // Mirror into the httpOnly cookie middleware.ts reads. A failure here
      // must not undo an otherwise successful sign-in.
      try {
        await fetch('/api/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: session.token }),
        });
      } catch {
        /* no-op */
      }

      onSuccess?.(session.user);
      onClose();
    } catch (err) {
      setError(describe(err));
      setDigits(Array(CODE_LENGTH).fill(''));
      digitRefs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }, [code, codeComplete, email, transport, onSuccess, onClose]);

  /** Keeps the boxes in step with typing, pasting and deletion. */
  const setDigitAt = useCallback(
    (index: number, raw: string) => {
      const value = raw.replace(/\D/g, '');
      setError(null);

      if (value.length > 1) {
        // A pasted code fills from this box onward.
        setDigits((prev) => {
          const next = [...prev];
          for (let i = 0; i < value.length && index + i < CODE_LENGTH; i += 1) {
            next[index + i] = value[i];
          }
          return next;
        });
        const landed = Math.min(index + value.length, CODE_LENGTH - 1);
        digitRefs.current[landed]?.focus();
        return;
      }

      setDigits((prev) => {
        const next = [...prev];
        next[index] = value;
        return next;
      });
      if (value && index < CODE_LENGTH - 1) digitRefs.current[index + 1]?.focus();
    },
    []
  );

  const onDigitKeyDown = useCallback(
    (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Backspace' && !digits[index] && index > 0) {
        event.preventDefault();
        digitRefs.current[index - 1]?.focus();
        setDigits((prev) => {
          const next = [...prev];
          next[index - 1] = '';
          return next;
        });
        return;
      }
      if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault();
        digitRefs.current[index - 1]?.focus();
      }
      if (event.key === 'ArrowRight' && index < CODE_LENGTH - 1) {
        event.preventDefault();
        digitRefs.current[index + 1]?.focus();
      }
    },
    [digits]
  );

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="lgm__overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="lgm__panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="lgm__head">
          <div>
            <h2 className="lgm__title" id={titleId}>
              {step === 'email' ? 'Sign in' : 'Enter your code'}
            </h2>
            <p className="lgm__sub">
              {step === 'email' ? (
                'We will email you a six-digit code. No password needed.'
              ) : (
                <>
                  Sent to <b>{normaliseEmail(email)}</b>. It expires shortly.
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            className="lgm__close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close sign in"
          >
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {step === 'email' ? (
          <form
            className="lgm__form"
            onSubmit={(event) => {
              event.preventDefault();
              void requestCode();
            }}
            noValidate
          >
            <label className="lgm__label" htmlFor="lgm-email">
              Email address
            </label>
            <input
              id="lgm-email"
              ref={emailRef}
              className="lgm__input"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              disabled={busy}
              aria-invalid={error !== null && !emailValid}
              onChange={(event) => {
                setEmail(event.target.value);
                setError(null);
              }}
            />

            {error && (
              <p className="lgm__error" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="lgm__submit"
              disabled={busy || !emailValid}
            >
              {busy ? 'Sending…' : 'Send Verification Code'}
            </button>
          </form>
        ) : (
          <form
            className="lgm__form"
            onSubmit={(event) => {
              event.preventDefault();
              void verifyCode();
            }}
            noValidate
          >
            <span className="lgm__label" id="lgm-code-label">
              Six-digit code
            </span>
            <div
              className="lgm__code"
              role="group"
              aria-labelledby="lgm-code-label"
            >
              {digits.map((digit, index) => (
                <input
                  // Fixed-length field; the index is the identity.
                  key={index}
                  ref={(node) => {
                    digitRefs.current[index] = node;
                  }}
                  className={[
                    'lgm__digit',
                    digit ? 'lgm__digit--filled' : '',
                    error ? 'lgm__digit--error' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  type="text"
                  inputMode="numeric"
                  autoComplete={index === 0 ? 'one-time-code' : 'off'}
                  maxLength={CODE_LENGTH}
                  value={digit}
                  disabled={busy}
                  aria-label={`Digit ${index + 1} of ${CODE_LENGTH}`}
                  onChange={(event) => setDigitAt(index, event.target.value)}
                  onKeyDown={(event) => onDigitKeyDown(index, event)}
                  onFocus={(event) => event.target.select()}
                />
              ))}
            </div>

            {error && (
              <p className="lgm__error" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="lgm__submit"
              disabled={busy || !codeComplete}
            >
              {busy ? 'Verifying…' : 'Verify Code'}
            </button>

            <div className="lgm__row">
              <button
                type="button"
                className="lgm__link"
                onClick={() => {
                  setStep('email');
                  setError(null);
                }}
                disabled={busy}
              >
                ← Change email
              </button>
              <button
                type="button"
                className="lgm__link"
                onClick={() => void requestCode(true)}
                disabled={busy || cooldown > 0}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
