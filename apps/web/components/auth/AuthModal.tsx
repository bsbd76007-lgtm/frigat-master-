'use client';

/**
 * FRIGAT — Sign in / register / reset, in a dialog.
 *
 * The header's account control opens this when nobody is signed in, so a player
 * can get in without losing the page they were on.
 *
 * It calls the *same* `authClient` functions the /login and /forgot-password
 * pages do, so the rules those pages enforce hold here too — notably the
 * emailed second factor after a password. Nothing is reimplemented: a shortcut
 * auth path that skipped a step would be a way in that the real pages refuse.
 *
 * The Turnstile widget was removed from this dialog by request. The endpoints
 * behind it still accept a token and, in production with a configured secret,
 * still *require* one — see the note in the summary. Nothing else about the
 * flow changed.
 *
 * Registration deliberately hands off to /register once the code is sent: that
 * page owns the password-rules checklist, and duplicating it in a dialog is how
 * the two drift apart.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';

import {
  AuthError,
  requestPasswordReset,
  resetPassword,
  submitPassword,
  verifyLoginCode,
  type CodeChallenge,
} from '@/app/(auth)/authClient';
import {
  emptyDigits,
  focusFirstOtpBox,
  OtpDigits,
  OTP_DIGITS,
} from '@/app/(auth)/OtpDigits';
import { evaluatePassword } from '@/app/(auth)/passwordRules';
import { PasswordChecklist } from '@/app/(auth)/PasswordChecklist';
import { useInjectedStyles } from '@/lib/useInjectedStyles';
import { useLanguage } from '@/components/providers/LanguageProvider';

type View = 'signin' | 'code' | 'forgot' | 'reset';

const STYLE_ID = 'fg-auth-modal-styles';

const CSS = `
.authm__overlay { position: fixed; inset: 0; z-index: 130; display: flex;
  align-items: center; justify-content: center; padding: 20px;
  background: rgba(5, 10, 16, .74); backdrop-filter: blur(4px); }
.authm__panel { position: relative; width: 100%; max-width: 420px;
  max-height: min(90vh, 780px); overflow-y: auto; padding: 24px;
  box-sizing: border-box; color: var(--fg-text); background: var(--fg-panel);
  border: 1px solid var(--fg-line); border-radius: 16px;
  box-shadow: 0 30px 60px -20px rgba(0,0,0,.75); }
.authm__panel:focus { outline: none; }
.authm__head { display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; margin-bottom: 16px; }
.authm__title { margin: 0; font-size: 19px; font-weight: 800; color: var(--fg-text); }
.authm__sub { margin: 4px 0 0; font-size: 12.5px; color: var(--fg-muted); }
.authm__close { flex: 0 0 auto; display: grid; place-items: center; width: 32px;
  height: 32px; color: var(--fg-muted); background: transparent;
  border: 1px solid var(--fg-line); border-radius: 9px; cursor: pointer; }
.authm__close:hover { color: var(--fg-text); background: var(--fg-hover); }
.authm__field { margin-bottom: 12px; }
.authm__field label { display: block; margin-bottom: 6px; font-size: 11px;
  font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: var(--fg-muted); }
.authm__input { width: 100%; box-sizing: border-box; padding: 11px 12px;
  font: inherit; font-size: 14px; color: var(--fg-text); background: var(--fg-panel-2);
  border: 1px solid var(--fg-line); border-radius: 10px; outline: none; }
.authm__input:focus-visible { border-color: var(--fg-accent);
  box-shadow: 0 0 0 3px rgba(245, 158, 11, .2); }
.authm__submit { width: 100%; padding: 13px; font: inherit; font-size: 14px;
  font-weight: 800; color: var(--fg-bg); background: var(--fg-accent);
  border: 0; border-radius: 11px; cursor: pointer; }
.authm__submit:disabled { opacity: .45; cursor: not-allowed; }
.authm__submit:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(245, 158, 11, .45); }
.authm__row { display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin-top: 12px; }
.authm__link { padding: 0; font: inherit; font-size: 12.5px; font-weight: 600;
  color: var(--fg-accent); background: none; border: 0; cursor: pointer; }
.authm__link:hover { text-decoration: underline; }
.authm__msg { margin: 0 0 12px; padding: 10px 12px; font-size: 12.5px;
  font-weight: 600; border-radius: 10px; }
.authm__msg--err { color: #d69199; background: rgba(240, 97, 109, .12);
  border: 1px solid rgba(240, 97, 109, .35); }
.authm__msg--ok { color: var(--fg-pos-soft); background: rgba(245, 158, 11, .1);
  border: 1px solid rgba(245, 158, 11, .3); }
`;

export interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

export function AuthModal({ open, onClose }: AuthModalProps) {
  useInjectedStyles(STYLE_ID, CSS);
  const { t } = useLanguage();

  const [view, setView] = useState<View>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<CodeChallenge | null>(null);
  const [digits, setDigits] = useState<string[]>(emptyDigits);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);

  const { failing, ready: passwordReady } = evaluatePassword(newPassword);
  const code = digits.join('');

  useEffect(() => setMounted(true), []);

  // A dialog that keeps a half-typed password across openings is a dialog that
  // leaks one; everything resets on close.
  useEffect(() => {
    if (open) return;
    setView('signin');
    setPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setChallenge(null);
    setDigits(emptyDigits());
    setError(null);
    setNotice(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const done = useCallback(() => {
    // A full reload rather than a router push: the socket, the balance and the
    // whole dashboard are built at mount from a token that did not exist a
    // moment ago.
    window.location.reload();
  }, []);

  const signIn = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const result = await submitPassword({ email: email.trim(), password });
        if (!result.requiresOtp) {
          done();
          return;
        }
        setChallenge(result.challenge);
        setDigits(emptyDigits());
        setView('code');
        focusFirstOtpBox();
      } catch (err) {
        setError(err instanceof AuthError ? err.message : 'Could not sign in.');
      } finally {
        setBusy(false);
      }
    },
    [busy, email, password, done]
  );

  const submitCode = useCallback(
    async (value: string) => {
      if (busy || !challenge || value.length !== OTP_DIGITS) return;
      setBusy(true);
      setError(null);
      try {
        await verifyLoginCode(challenge.email, value);
        done();
      } catch (err) {
        setError(err instanceof AuthError ? err.message : 'Could not verify that code.');
        setDigits(emptyDigits());
        focusFirstOtpBox();
        setBusy(false);
      }
    },
    [busy, challenge, done]
  );

  const sendReset = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const result = await requestPasswordReset(email.trim().toLowerCase());
        setChallenge(result);
        setDigits(emptyDigits());
        setView('reset');
        setNotice(
          result.devCode
            ? `Development mode — your code is ${result.devCode}.`
            : 'If an account exists with this email, a reset code has been sent.'
        );
        focusFirstOtpBox();
      } catch (err) {
        setError(err instanceof AuthError ? err.message : 'Could not send a reset code.');
      } finally {
        setBusy(false);
      }
    },
    [busy, email]
  );

  const submitReset = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (busy || !challenge) return;
      if (code.length !== OTP_DIGITS) {
        setError(`Enter the ${OTP_DIGITS}-digit code from your email.`);
        return;
      }
      if (!passwordReady) {
        setError('Choose a password that meets every rule below.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError('Those passwords do not match.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await resetPassword({ email: challenge.email, code, newPassword });
        setView('signin');
        setNotice('Password changed. Sign in with your new password.');
        setPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setDigits(emptyDigits());
      } catch (err) {
        setError(err instanceof AuthError ? err.message : 'Could not reset your password.');
        setDigits(emptyDigits());
      } finally {
        setBusy(false);
      }
    },
    [busy, challenge, code, passwordReady, newPassword, confirmPassword]
  );

  if (!open || !mounted) return null;

  const titles: Record<View, { title: string; sub: string }> = {
    signin: { title: 'Sign in', sub: 'Welcome back. Enter your details to reach the tables.' },
    code: { title: 'Check your email', sub: `We sent a ${OTP_DIGITS}-digit code to finish signing in.` },
    forgot: { title: 'Reset password', sub: 'We will email you a code to set a new password.' },
    reset: { title: 'Choose a new password', sub: 'Enter the code with your new password.' },
  };

  return createPortal(
    <div
      className="authm__overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="authm__panel"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="authm-title"
      >
        <div className="authm__head">
          <div>
            <h2 className="authm__title" id="authm-title">
              {titles[view].title}
            </h2>
            <p className="authm__sub">{titles[view].sub}</p>
          </div>
          <button type="button" className="authm__close" onClick={onClose} aria-label={t('common.close')}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {error && <p className="authm__msg authm__msg--err">{error}</p>}
        {!error && notice && <p className="authm__msg authm__msg--ok">{notice}</p>}

        {view === 'signin' && (
          <form onSubmit={signIn} noValidate>
            <div className="authm__field">
              <label htmlFor="authm-email">{t('common.email')}</label>
              <input
                id="authm-email"
                className="authm__input"
                type="email"
                autoComplete="email"
                value={email}
                disabled={busy}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="authm__field">
              <label htmlFor="authm-password">{t('common.password')}</label>
              <input
                id="authm-password"
                className="authm__input"
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="authm__submit" disabled={busy}>
              {busy ? 'Checking…' : 'Continue'}
            </button>

            <div className="authm__row">
              <button
                type="button"
                className="authm__link"
                onClick={() => {
                  setView('forgot');
                  setError(null);
                  setNotice(null);
                }}
              >
                Forgot password?
              </button>
              <Link className="authm__link" href="/register" onClick={onClose}>
                Create an account
              </Link>
            </div>
          </form>
        )}

        {view === 'code' && (
          <>
            <OtpDigits
              idPrefix="authm-login"
              digits={digits}
              onDigitsChange={setDigits}
              onComplete={(value) => void submitCode(value)}
              disabled={busy}
            />
            <button
              type="button"
              className="authm__submit"
              disabled={busy || code.length !== OTP_DIGITS}
              onClick={() => void submitCode(code)}
            >
              {busy ? 'Verifying…' : 'Verify and sign in'}
            </button>
            <div className="authm__row">
              <button
                type="button"
                className="authm__link"
                onClick={() => {
                  setView('signin');
                  setChallenge(null);
                  setPassword('');
                }}
              >
                Back to sign in
              </button>
            </div>
          </>
        )}

        {view === 'forgot' && (
          <form onSubmit={sendReset} noValidate>
            <div className="authm__field">
              <label htmlFor="authm-forgot-email">{t('common.email')}</label>
              <input
                id="authm-forgot-email"
                className="authm__input"
                type="email"
                autoComplete="email"
                value={email}
                disabled={busy}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="authm__submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send reset code'}
            </button>
            <div className="authm__row">
              <button
                type="button"
                className="authm__link"
                onClick={() => {
                  setView('signin');
                  setError(null);
                }}
              >
                Back to sign in
              </button>
            </div>
          </form>
        )}

        {view === 'reset' && (
          <form onSubmit={submitReset} noValidate>
            <OtpDigits
              idPrefix="authm-reset"
              digits={digits}
              onDigitsChange={setDigits}
              onComplete={() => document.getElementById('authm-new-password')?.focus()}
              disabled={busy}
              label="Reset code"
            />
            <div className="authm__field">
              <label htmlFor="authm-new-password">{t('common.newPassword')}</label>
              <input
                id="authm-new-password"
                className="authm__input"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                disabled={busy}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
              <PasswordChecklist password={newPassword} failing={failing} />
            </div>
            <div className="authm__field">
              <label htmlFor="authm-confirm-password">{t('common.confirmNewPassword')}</label>
              <input
                id="authm-confirm-password"
                className="authm__input"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                disabled={busy}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              className="authm__submit"
              disabled={busy || code.length !== OTP_DIGITS || !passwordReady}
            >
              {busy ? 'Resetting…' : 'Reset password'}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}

export default AuthModal;
