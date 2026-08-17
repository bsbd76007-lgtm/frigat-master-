'use client';

/**
 * FRIGAT — Affiliate dashboard
 *
 * Shows the player's own referral link, their downline stats, and lets them
 * sweep accrued RevShare earnings into their wagerable balance.
 *
 * Data comes from /api/referrals/me, which is scoped to the bearer token — the
 * page never asks for a user id, so there is nothing to tamper with.
 *
 * Money is rendered straight from the API's decimal strings via the BigInt
 * helpers in lib/decimal; parsing earnings into a float would reintroduce the
 * drift the Decimal(18,8) schema exists to prevent.
 */

import { useCallback, useEffect, useState } from 'react';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';

import { API_URL } from '@/lib/token';
import { compareDecimal, formatDecimalString } from '@/lib/decimal';

interface ReferralSummary {
  referralCode: string;
  revSharePercentage: string;
  totalInvited: number;
  activeDepositors: number;
  claimable: string;
  lifetimeEarned: string;
  currency: string;
}

type Status =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: ReferralSummary };

type Notice = { tone: 'ok' | 'err'; text: string } | null;

function referralLink(code: string): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/register?ref=${encodeURIComponent(code)}`;
}

export default function ReferralsPage() {
  const { token, balance } = useGameSocket();
  const { t } = useLanguage();

  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [notice, setNotice] = useState<Notice>(null);
  const [copied, setCopied] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [link, setLink] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`${API_URL}/api/referrals/me`, {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!response.ok) {
        setStatus({
          kind: 'error',
          message:
            response.status === 401
              ? 'Your session has expired. Sign in again.'
              : `Could not load your referral data (${response.status}).`,
        });
        return;
      }
      const data = (await response.json()) as ReferralSummary;
      setStatus({ kind: 'ready', data });
      setLink(referralLink(data.referralCode));
    } catch {
      setStatus({ kind: 'error', message: 'Could not reach the FRIGAT server.' });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const field = document.getElementById('ref-link') as HTMLInputElement | null;
      field?.select();
      setNotice({ tone: 'err', text: 'Copy was blocked — the link is selected, press ⌘/Ctrl+C.' });
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const claim = async () => {
    if (claiming) return;
    setClaiming(true);
    setNotice(null);
    try {
      const response = await fetch(`${API_URL}/api/referrals/claim`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({}),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setNotice({
          tone: 'err',
          text:
            body.error === 'nothing_to_claim'
              ? 'There is nothing to claim yet.'
              : body.error === 'wallet_not_found'
                ? 'No wallet found for this account.'
                : `Claim failed (${response.status}).`,
        });
        return;
      }

      setNotice({
        tone: 'ok',
        text: `Transferred ${formatDecimalString(String(body.claimed), 2)} to your main balance.`,
      });
      await load();
    } catch {
      setNotice({ tone: 'err', text: 'Could not reach the FRIGAT server.' });
    } finally {
      setClaiming(false);
    }
  };

  if (status.kind === 'loading') {
    return <p className="ref__note">Loading your referral dashboard…</p>;
  }
  if (status.kind === 'error') {
    return (
      <div className="ref__alert" role="alert">
        <strong>{t('referrals.unavailable')}</strong> {status.message}
      </div>
    );
  }

  const data = status.data;
  const hasEarnings = compareDecimal(data.claimable, '0') > 0;

  return (
    <div className="ref">
      <header className="ref__head">
        <h1 className="ref__title">Refer &amp; Earn</h1>
        <p className="ref__sub">
          Share your link and earn {formatDecimalString(data.revSharePercentage, 2)}% of the
          net losses of every player who signs up through it. Earnings accrue
          separately and are yours to move across whenever you like.
        </p>
      </header>

      {/* ── Referral link ── */}
      <section className="ref__panel">
        <span className="ref__legend">{t('referrals.yourLink')}</span>
        <div className="ref__linkrow">
          <input
            id="ref-link"
            className="ref__input"
            value={link}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
            aria-label={t('referrals.yourLink')}
          />
          <button type="button" className="ref__btn ref__btn--primary" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="ref__note">
          {t('referrals.yourCodeIs')} <code>{data.referralCode}</code>
        </p>
      </section>

      {/* ── Stats ── */}
      <section className="ref__grid">
        <div className="ref__stat">
          <span>{t('referrals.totalInvited')}</span>
          <b>{data.totalInvited.toLocaleString()}</b>
        </div>
        <div className="ref__stat">
          <span>{t('referrals.activeDepositors')}</span>
          <b>{data.activeDepositors.toLocaleString()}</b>
          <em>{t('referrals.activeDepositorsHint')}</em>
        </div>
        <div className="ref__stat">
          <span>{t('referrals.currentRevShare')}</span>
          <b>{formatDecimalString(data.revSharePercentage, 2)}%</b>
          <em>Of each invitee&apos;s net losses</em>
        </div>
        <div className="ref__stat ref__stat--accent">
          <span>{t('referrals.totalClaimable')}</span>
          <b>
            {formatDecimalString(data.claimable, 2)} <i>{data.currency}</i>
          </b>
          <em>
            {formatDecimalString(data.lifetimeEarned, 2)} {data.currency} earned all-time
          </em>
        </div>
      </section>

      {/* ── Claim ── */}
      <section className="ref__panel">
        <span className="ref__legend">{t('referrals.claim')}</span>
        <p className="ref__note">
          Moves your full claimable balance into your main balance, where it can
          be wagered or withdrawn. Your current balance is{' '}
          <b>{balance.hasSynced ? balance.formatted : '—'} {balance.currency}</b>.
        </p>
        {notice && (
          <p className={`ref__msg ref__msg--${notice.tone}`} role="alert">
            {notice.text}
          </p>
        )}
        <button
          type="button"
          className="ref__btn ref__btn--primary"
          disabled={!hasEarnings || claiming}
          onClick={claim}
        >
          {claiming
            ? 'Transferring…'
            : hasEarnings
              ? `Claim ${formatDecimalString(data.claimable, 2)} ${data.currency} → Main balance`
              : 'Nothing to claim yet'}
        </button>
      </section>
    </div>
  );
}
