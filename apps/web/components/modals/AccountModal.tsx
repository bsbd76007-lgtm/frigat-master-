'use client';

/**
 * FRIGAT — Account panel
 *
 * The player's own profile, wallet, security state and VIP standing in one
 * dialog, opened from the avatar button in the header.
 *
 * Three sources, deliberately:
 *  - `GET /api/auth/me` for identity (id, email, role, join date, frozen flag).
 *    A returning visitor arrives with nothing but a stored JWT, so the profile
 *    the login response returned once is long gone by then.
 *  - the socket context for the balance, because that is the only thing on the
 *    client that tracks the ledger live — re-reading a balance over HTTP here
 *    would show a stale number the moment a bet settles behind the dialog.
 *  - `GET /api/vip/me` for tier and rakeback, which degrades to a hidden
 *    section rather than an error if the endpoint is unavailable.
 *
 * Nothing here can move money: it reads, and the two actions it offers hand off
 * to the fairness dialog and the VIP page.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useInjectedStyles } from '@/lib/useInjectedStyles';
import { apiJson } from '@/lib/api';
import { consumedAsSessionExpiry, handleSessionExpiry } from '@/lib/sessionExpiry';
import { formatDecimalString } from '@/lib/decimal';
import {
  AuthError,
  requestPasswordReset,
  resetPassword,
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
import {

  isTurnstileConfigured,
  Turnstile,
  type TurnstileHandle,
} from '@/components/auth/Turnstile';

interface AccountProfile {
  id: string;
  email: string;
  role: string;
  frozen: boolean;
  createdAt: string;
  referralCode?: string | null;
  balance: string;
  currency: string;
}

interface VipSummary {
  tier: string;
  rakebackRate: number;
  totalWagered: string;
  nextTier: { name: string; threshold: string; remaining: string } | null;
  progress: number;
}

const STYLE_ID = 'fg-account-modal-styles';

const CSS = `
.acc__overlay { position: fixed; inset: 0; z-index: 120; display: flex;
  align-items: center; justify-content: center; padding: 20px;
  background: rgba(5, 10, 16, .72); backdrop-filter: blur(4px); }

.acc__panel { position: relative; display: flex; flex-direction: column;
  width: 100%; max-width: 460px; max-height: min(88vh, 760px); overflow-y: auto;
  padding: 22px; box-sizing: border-box; color: #e2e8f0;
  background: #101a22; border: 1px solid #1e293b; border-radius: 18px;
  box-shadow: 0 30px 60px -20px rgba(0,0,0,.75);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.acc__panel:focus { outline: none; }

.acc__head { display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; margin-bottom: 18px; }
.acc__title { margin: 0; font-size: 19px; font-weight: 800; letter-spacing: -.01em; }
.acc__sub { margin: 4px 0 0; font-size: 12px; color: #64748b; }
.acc__close { flex: 0 0 auto; display: grid; place-items: center; width: 32px;
  height: 32px; color: #94a3b8; background: transparent; border: 1px solid #1e293b;
  border-radius: 9px; cursor: pointer;
  transition: color .2s ease, background .2s ease; }
.acc__close:hover { color: #f1f5f9; background: #1e293b; }
.acc__close:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.35); }

/* Identity strip: avatar initial plus the address the account is known by. */
.acc__ident { display: flex; align-items: center; gap: 13px; margin-bottom: 18px;
  padding: 14px; background: #0b141b; border: 1px solid #1e293b; border-radius: 14px; }
/* The brand monogram, replacing the amber initial disc. White ink with real
   transparency, so it needs no invert treatment on the dark panel. */
.acc__mark { flex: 0 0 auto; height: 28px; width: auto; object-fit: contain; }
html[data-theme='light'] .acc__mark { filter: invert(1); }
.acc__ident-name { font-size: 15px; font-weight: 700; letter-spacing: -.01em;
  color: var(--fg-text); }
.acc__ident-main { min-width: 0; }
.acc__ident-meta { margin-top: 3px; font-size: 11px; color: #64748b;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.acc__section { margin-bottom: 16px; }
.acc__section-title { margin: 0 0 8px; font-size: 11px; font-weight: 700;
  letter-spacing: .1em; text-transform: uppercase; color: #64748b; }
.acc__rows { display: flex; flex-direction: column; gap: 1px; overflow: hidden;
  background: #1e293b; border: 1px solid #1e293b; border-radius: 12px; }
.acc__row { display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 11px 13px; background: #0b141b; }
.acc__key { flex: 0 0 auto; font-size: 12px; color: #94a3b8; }
.acc__val { min-width: 0; font-size: 13px; font-weight: 700;
  font-variant-numeric: tabular-nums; text-align: right; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.acc__val--mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px; font-weight: 600; }
.acc__val--big { font-size: 16px; color: var(--fg-pos); }

.acc__copy { flex: 0 0 auto; margin-left: 8px; padding: 4px 8px; font-family: inherit;
  font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
  color: #94a3b8; background: #111d26; border: 1px solid #1e293b; border-radius: 7px;
  cursor: pointer; transition: color .2s ease, background .2s ease; }
.acc__copy:hover { color: #f1f5f9; background: #1e293b; }
.acc__copy:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.35); }
.acc__id-cell { display: flex; align-items: center; justify-content: flex-end;
  min-width: 0; }

.acc__pill { padding: 3px 9px; font-size: 11px; font-weight: 800; letter-spacing: .03em;
  border-radius: 999px; }
.acc__pill--ok { color: var(--fg-pos-soft); background: rgba(34,197,94,.14);
  border: 1px solid rgba(34,197,94,.35); }
.acc__pill--warn { color: #d69199; background: rgba(239,68,68,.14);
  border: 1px solid rgba(239,68,68,.35); }

.acc__note { margin: 8px 0 0; font-size: 11px; line-height: 1.5; color: #d69199; }

.acc__actions { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.acc__btn { display: block; width: 100%; padding: 11px; font-family: inherit;
  font-size: 13px; font-weight: 700; text-align: center; text-decoration: none;
  color: #cbd5e1; background: #0b141b; border: 1px solid #1e293b; border-radius: 11px;
  cursor: pointer; transition: color .2s ease, background .2s ease; }
.acc__btn:hover { color: #fff; background: #1e293b; }
.acc__btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.35); }
.acc__btn--danger { color: #d69199; }
.acc__btn--danger:hover { color: #fff; background: rgba(239,68,68,.2); }

.acc__state { padding: 26px 0; font-size: 13px; text-align: center; color: #64748b; }
.acc__state--error { color: #c25560; }

/* ── Change password sub-view ── */
.acc__back { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 14px;
  padding: 0; font-family: inherit; font-size: 12px; font-weight: 700; color: #94a3b8;
  background: none; border: 0; cursor: pointer; }
.acc__back:hover { color: #f1f5f9; }
.acc__back:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.35);
  border-radius: 6px; }

.acc__pw-email { display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin-bottom: 14px; padding: 11px 13px; font-size: 13px;
  background: #0b141b; border: 1px solid #1e293b; border-radius: 11px; }
.acc__pw-email b { min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; font-weight: 700; }
.acc__pw-email span { flex: 0 0 auto; font-size: 11px; color: #64748b; }

.acc__field { margin-bottom: 12px; }
.acc__field label { display: block; margin-bottom: 6px; font-size: 11px; font-weight: 700;
  letter-spacing: .08em; text-transform: uppercase; color: #64748b; }
.acc__input { width: 100%; box-sizing: border-box; padding: 11px 12px; font-family: inherit;
  font-size: 14px; color: #f1f5f9; background: #0b141b; border: 1px solid #1e293b;
  border-radius: 10px; outline: none; }
.acc__input:focus-visible { border-color: var(--fg-accent); box-shadow: 0 0 0 3px rgba(34,197,94,.22); }
.acc__input:disabled { opacity: .5; cursor: not-allowed; }

.acc__submit { width: 100%; padding: 13px; font-family: inherit; font-size: 14px;
  font-weight: 800; color: #0b0e14;
  background: linear-gradient(90deg, var(--fg-accent), var(--fg-accent-deep)); border: none; border-radius: 11px;
  cursor: pointer; transition: background .2s ease; }
.acc__submit:hover:not(:disabled) { background: linear-gradient(90deg, var(--fg-pos), var(--fg-accent)); }
.acc__submit:disabled { opacity: .45; cursor: not-allowed; }
.acc__submit:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.45); }

.acc__resend { display: flex; justify-content: space-between; gap: 10px; margin-top: 10px; }
.acc__link-btn { padding: 0; font-family: inherit; font-size: 12px; font-weight: 700;
  color: var(--fg-pos); background: none; border: 0; cursor: pointer; }
.acc__link-btn:disabled { color: #475569; cursor: not-allowed; }
.acc__link-btn:hover:not(:disabled) { text-decoration: underline; }

.acc__banner { margin-bottom: 14px; padding: 11px 13px; font-size: 12.5px; font-weight: 700;
  border-radius: 11px; }
.acc__banner--ok { color: var(--fg-pos-soft); background: rgba(34,197,94,.14);
  border: 1px solid rgba(34,197,94,.4); }
.acc__banner--err { color: #d69199; background: rgba(239,68,68,.14);
  border: 1px solid rgba(239,68,68,.4); }
`;

function formatJoined(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function AccountModal({
  open,
  onClose,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  onSignOut?: () => void;
}) {
  useInjectedStyles(STYLE_ID, CSS);

  const { token, balance, seed, setFairnessOpen } = useGameSocket();
  const { t, locale } = useLanguage();

  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isMounted, setIsMounted] = useState(false);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [vip, setVip] = useState<VipSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Change password ──
  //
  // The same emailed-code flow the signed-out reset page uses, rather than a
  // "current password + new password" endpoint. Two reasons: that endpoint does
  // not exist server-side, and possession of the inbox is a stronger proof than
  // a password typed into a session that is already open — a borrowed laptop
  // with a live session cannot change the password without the mail too.
  const [view, setView] = useState<'overview' | 'password'>('overview');
  const [challenge, setChallenge] = useState<CodeChallenge | null>(null);
  const [digits, setDigits] = useState<string[]>(emptyDigits);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwNotice, setPwNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef<TurnstileHandle>(null);

  const { failing, ready: passwordReady } = evaluatePassword(newPassword);
  const code = digits.join('');

  useEffect(() => setIsMounted(true), []);

  const load = useCallback(async () => {
    // No token at all: there is no account to show and no request worth making.
    // Previously this returned silently, leaving an empty panel open with no
    // way forward. Hand off to sign-in instead.
    if (!token) {
      onClose();
      handleSessionExpiry();
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setProfile(await apiJson<AccountProfile>('api/auth/me'));
    } catch (err) {
      // A 401 is not something the player can retry their way out of — the
      // session is gone. The bare `catch` here used to turn it into "Could not
      // load your account details", which reads as a server fault and leaves a
      // dead token in localStorage so every later call fails the same way.
      // consumedAsSessionExpiry clears it and redirects to /login?error=invalid.
      if (consumedAsSessionExpiry(err)) {
        onClose();
        return;
      }
      setError(t('account.loadError'));
    } finally {
      setLoading(false);
    }

    // VIP is supporting detail: a failure here leaves the section hidden rather
    // than failing the whole panel. An expiry is still worth acting on, but the
    // profile call above will have caught it first in every ordinary case.
    try {
      setVip(await apiJson<VipSummary>('api/vip/me'));
    } catch (err) {
      if (consumedAsSessionExpiry(err)) return;
      setVip(null);
    }
  }, [token, t, onClose]);

  // Fetched on open rather than on mount: the panel lives in the header on
  // every page, and a dialog nobody opened should not be polling the API.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => returnFocusRef.current?.focus?.();
  }, [open]);

  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    []
  );

  const copyId = useCallback(async () => {
    if (!profile) return;
    try {
      await navigator.clipboard.writeText(profile.id);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the id is selectable in place */
    }
  }, [profile]);

  const onBackdropClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose]
  );

  /** Clears the password sub-view. Called on close and on returning to the overview. */
  const resetPasswordView = useCallback(() => {
    setView('overview');
    setChallenge(null);
    setDigits(emptyDigits());
    setNewPassword('');
    setConfirmPassword('');
    setPwError(null);
    setCooldown(0);
    setTurnstileToken('');
  }, []);

  // A half-finished password change must not be sitting there on reopen — the
  // code will have expired, and a filled-in new password left in state is
  // exactly what should not survive the dialog closing.
  useEffect(() => {
    if (!open) {
      resetPasswordView();
      setPwNotice(null);
    }
  }, [open, resetPasswordView]);

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

  /** Step one: mail a code to the address on the account. */
  const sendCode = useCallback(async () => {
    if (!profile || pwBusy || cooldown > 0) return;
    setPwBusy(true);
    setPwError(null);
    try {
      const result = await requestPasswordReset(profile.email, turnstileToken);
      setChallenge(result);
      setDigits(emptyDigits());
      setCooldown(result.resendAfterSeconds);
      focusFirstOtpBox();
    } catch (err) {
      setPwError(err instanceof AuthError ? err.message : t('account.pwSendError'));
    } finally {
      // Single-use token: spent by the attempt whatever the outcome.
      turnstileRef.current?.reset();
      setPwBusy(false);
    }
  }, [profile, pwBusy, cooldown, turnstileToken, t]);

  /** Step two: spend the code and set the new password. */
  const submitPasswordChange = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!profile || !challenge || pwBusy) return;

      if (code.length !== OTP_DIGITS) {
        setPwError(t('account.pwCodeRequired'));
        return;
      }
      if (!passwordReady) {
        setPwError(t('account.pwWeak'));
        return;
      }
      if (newPassword !== confirmPassword) {
        setPwError(t('account.pwMismatch'));
        return;
      }

      setPwBusy(true);
      setPwError(null);
      try {
        await resetPassword({
          email: challenge.email,
          code,
          newPassword,
        });
        // Back to the overview with a confirmation, rather than leaving the
        // player on a form whose fields are now meaningless.
        resetPasswordView();
        setPwNotice(t('account.pwChanged'));
      } catch (err) {
        setPwError(err instanceof AuthError ? err.message : t('account.pwResetError'));
        setDigits(emptyDigits());
        focusFirstOtpBox();
      } finally {
        setPwBusy(false);
      }
    },
    [
      profile,
      challenge,
      pwBusy,
      code,
      passwordReady,
      newPassword,
      confirmPassword,
      resetPasswordView,
      t,
    ]
  );

  if (!open || !isMounted) return null;

  // The live ledger figure wins; the profile's copy is the fallback for the
  // moment before the socket has pushed a balance frame.
  const balanceText = balance.hasSynced
    ? `${balance.formatted} ${balance.currency}`
    : profile
      ? `${formatDecimalString(profile.balance, 2)} ${profile.currency}`
      : '—';

  return createPortal(
    <div className="acc__overlay" onMouseDown={onBackdropClick}>
      <div
        className="acc__panel"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
      >
        <div className="acc__head">
          <div>
            <h2 className="acc__title" id="account-title">
              {view === 'password' ? t('account.changePassword') : t('account.title')}
            </h2>
            <p className="acc__sub">
              {view === 'password' ? t('account.pwSubtitle') : t('account.subtitle')}
            </p>
          </div>
          <button
            type="button"
            className="acc__close"
            onClick={onClose}
            aria-label={t('account.close')}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* ── Change password ── */}
        {view === 'password' && profile && (
          <>
            <button type="button" className="acc__back" onClick={resetPasswordView}>
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path
                  d="M10 3L5 8l5 5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {t('account.back')}
            </button>

            {pwError && (
              <p className="acc__banner acc__banner--err" role="alert">
                {pwError}
              </p>
            )}
            {!pwError && challenge?.devCode && (
              <p className="acc__banner acc__banner--ok" role="status">
                {t('account.pwDevCode', { code: challenge.devCode })}
              </p>
            )}

            {/* The address is the account's own — not a field, so a code can
                never be aimed anywhere but the inbox that owns the account. */}
            <div className="acc__pw-email">
              <b title={profile.email}>{profile.email}</b>
              <span>{t('account.pwEmailNote')}</span>
            </div>

            {!challenge ? (
              <>
                <Turnstile
                  ref={turnstileRef}
                  onToken={setTurnstileToken}
                  action="account-password"
                />
                <button
                  type="button"
                  className="acc__submit"
                  disabled={
                    pwBusy ||
                    cooldown > 0 ||
                    (isTurnstileConfigured() && !turnstileToken)
                  }
                  onClick={() => void sendCode()}
                >
                  {pwBusy
                    ? t('account.pwSending')
                    : cooldown > 0
                      ? t('account.pwResendIn', { seconds: cooldown })
                      : t('account.pwSendCode')}
                </button>
              </>
            ) : (
              <form onSubmit={submitPasswordChange} noValidate>
                <OtpDigits
                  idPrefix="account-pw"
                  digits={digits}
                  onDigitsChange={setDigits}
                  // The form carries two more fields, so a complete code moves
                  // focus on rather than submitting against an empty password.
                  onComplete={() =>
                    document.getElementById('account-new-password')?.focus()
                  }
                  disabled={pwBusy}
                  label={t('account.pwCode')}
                />

                <div className="acc__field">
                  <label htmlFor="account-new-password">{t('account.pwNew')}</label>
                  <input
                    id="account-new-password"
                    className="acc__input"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    disabled={pwBusy}
                    onChange={(event) => setNewPassword(event.target.value)}
                    aria-invalid={
                      newPassword.length > 0 && !passwordReady ? true : undefined
                    }
                  />
                  <PasswordChecklist password={newPassword} failing={failing} />
                </div>

                <div className="acc__field">
                  <label htmlFor="account-confirm-password">
                    {t('account.pwConfirm')}
                  </label>
                  <input
                    id="account-confirm-password"
                    className="acc__input"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    disabled={pwBusy}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  className="acc__submit"
                  disabled={pwBusy || code.length !== OTP_DIGITS || !passwordReady}
                >
                  {pwBusy ? t('account.pwSaving') : t('account.pwSubmit')}
                </button>

                <Turnstile
                  ref={turnstileRef}
                  onToken={setTurnstileToken}
                  action="account-password-resend"
                />

                <div className="acc__resend">
                  <button
                    type="button"
                    className="acc__link-btn"
                    disabled={
                      pwBusy ||
                      cooldown > 0 ||
                      (isTurnstileConfigured() && !turnstileToken)
                    }
                    onClick={() => void sendCode()}
                  >
                    {cooldown > 0
                      ? t('account.pwResendIn', { seconds: cooldown })
                      : t('account.pwResend')}
                  </button>
                </div>
              </form>
            )}
          </>
        )}

        {view === 'overview' && pwNotice && (
          <p className="acc__banner acc__banner--ok" role="status">
            {pwNotice}
          </p>
        )}

        {view === 'overview' && loading && !profile && (
          <p className="acc__state">{t('account.loading')}</p>
        )}

        {view === 'overview' && error && !profile && (
          <>
            <p className="acc__state acc__state--error">{error}</p>
            <button type="button" className="acc__btn" onClick={() => void load()}>
              {t('account.retry')}
            </button>
          </>
        )}

        {view === 'overview' && profile && (
          <>
            <div className="acc__ident">
              <Image
                src="/frigat-monogram.png"
                alt=""
                width={400}
                height={345}
                className="acc__mark"
              />
              <div className="acc__ident-main">
                <div className="acc__ident-name">Frigat</div>
                {/* The account is still named here. The strip identifies which
                    login you are in, so dropping the address for the brand
                    would leave two signed-in accounts looking identical. */}
                <div className="acc__ident-meta" title={profile.email}>
                  {profile.email} · {t('account.memberSince')}{' '}
                  {formatJoined(profile.createdAt, locale)}
                </div>
              </div>
            </div>

            <section className="acc__section">
              <h3 className="acc__section-title">{t('account.profile')}</h3>
              <div className="acc__rows">
                <div className="acc__row">
                  <span className="acc__key">{t('account.userId')}</span>
                  <span className="acc__id-cell">
                    <span className="acc__val acc__val--mono" title={profile.id}>
                      {profile.id}
                    </span>
                    <button
                      type="button"
                      className="acc__copy"
                      onClick={() => void copyId()}
                    >
                      {copied ? t('account.copied') : t('account.copy')}
                    </button>
                  </span>
                </div>
                <div className="acc__row">
                  <span className="acc__key">{t('account.email')}</span>
                  <span className="acc__val">{profile.email}</span>
                </div>
                <div className="acc__row">
                  <span className="acc__key">{t('account.role')}</span>
                  <span className="acc__val">{profile.role}</span>
                </div>
              </div>
            </section>

            <section className="acc__section">
              <h3 className="acc__section-title">{t('account.wallet')}</h3>
              <div className="acc__rows">
                <div className="acc__row">
                  <span className="acc__key">{t('account.balance')}</span>
                  <span className="acc__val acc__val--big">{balanceText}</span>
                </div>
              </div>
            </section>

            <section className="acc__section">
              <h3 className="acc__section-title">{t('account.security')}</h3>
              <div className="acc__rows">
                <div className="acc__row">
                  <span className="acc__key">{t('account.accountStatus')}</span>
                  <span
                    className={`acc__pill ${
                      profile.frozen ? 'acc__pill--warn' : 'acc__pill--ok'
                    }`}
                  >
                    {profile.frozen ? t('account.statusFrozen') : t('account.statusActive')}
                  </span>
                </div>
                <div className="acc__row">
                  <span className="acc__key">{t('account.sessionStatus')}</span>
                  <span className="acc__val">{t('account.sessionActive')}</span>
                </div>
                {/* Only the *hashed* server seed and the nonce ever reach the
                    client — revealing a live server seed would let the holder
                    predict every future round on the pair. */}
                {seed && (
                  <div className="acc__row">
                    <span className="acc__key">{t('account.seedNonce')}</span>
                    <span className="acc__val">{seed.nonce}</span>
                  </div>
                )}
              </div>
              {profile.frozen && <p className="acc__note">{t('account.frozenNote')}</p>}
            </section>

            {vip && (
              <section className="acc__section">
                <h3 className="acc__section-title">{t('account.vip')}</h3>
                <div className="acc__rows">
                  <div className="acc__row">
                    <span className="acc__key">{t('account.tier')}</span>
                    <span className="acc__val">{vip.tier}</span>
                  </div>
                  <div className="acc__row">
                    <span className="acc__key">{t('account.rakeback')}</span>
                    <span className="acc__val">
                      {(vip.rakebackRate * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="acc__row">
                    <span className="acc__key">{t('account.wagered')}</span>
                    <span className="acc__val">
                      {formatDecimalString(vip.totalWagered, 2)}
                    </span>
                  </div>
                  {vip.nextTier && (
                    <div className="acc__row">
                      <span className="acc__key">
                        {t('account.nextTier', { tier: vip.nextTier.name })}
                      </span>
                      <span className="acc__val">
                        {formatDecimalString(vip.nextTier.remaining, 2)}
                      </span>
                    </div>
                  )}
                </div>
              </section>
            )}

            <div className="acc__actions">
              <button
                type="button"
                className="acc__btn"
                onClick={() => {
                  onClose();
                  setFairnessOpen(true);
                }}
              >
                {t('account.verifySeeds')}
              </button>
              <Link className="acc__btn" href="/vip" onClick={onClose}>
                {t('account.viewVip')}
              </Link>
              <button
                type="button"
                className="acc__btn"
                onClick={() => {
                  setPwNotice(null);
                  setPwError(null);
                  setView('password');
                }}
              >
                {t('account.changePassword')}
              </button>
              {onSignOut && (
                <button
                  type="button"
                  className="acc__btn acc__btn--danger"
                  onClick={() => {
                    onClose();
                    onSignOut();
                  }}
                >
                  {t('account.signOut')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

export default AccountModal;
