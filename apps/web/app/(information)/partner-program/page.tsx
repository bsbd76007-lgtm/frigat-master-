'use client';

/**
 * /partner-program
 *
 * The affiliate scheme, described against what the server actually does:
 * `revSharePercentage` on the user row (25% by default, per-account so an
 * affiliate can be given a custom cut), earnings accruing into a separate
 * `affiliateBalance`, and `POST /api/referrals/claim` to draw it down.
 *
 * ── On the "Join Program" form ─────────────────────────────────────────────
 * There is no join endpoint, and there does not need to be: every account is
 * issued a `referralCode` at registration, so the programme is already open to
 * everyone with a login. A form posting an application into nothing would be a
 * fake — this section instead does the only two things that are real, which is
 * hand a signed-in partner their link and send everyone else to registration.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { useStoredToken } from '@/hooks/useStoredToken';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { apiJson } from '@/lib/api';
import { formatDecimalString } from '@/lib/decimal';
import { consumedAsSessionExpiry } from '@/lib/sessionExpiry';

interface ReferralSummary {
  referralCode: string;
  revSharePercentage: string;
  totalInvited: number;
  activeDepositors: number;
  claimable: string;
  currency: string;
}

/** Mirrors `revSharePercentage` on the user row — 25% unless an admin lifts it. */
const TIERS = [
  { band: 'Standard', invited: '1 – 9 active', share: '25%' },
  { band: 'Silver partner', invited: '10 – 49 active', share: 'up to 30%' },
  { band: 'Gold partner', invited: '50 – 199 active', share: 'up to 35%' },
  { band: 'VIP partner', invited: '200+ active', share: 'negotiated' },
];

export default function PartnerProgramPage() {
  const { t } = useLanguage();
  const token = useStoredToken();
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void apiJson<ReferralSummary>('api/referrals/me')
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err) => {
        // A dead session sends the player to sign-in; anything else just leaves
        // the preview empty rather than breaking the page.
        consumedAsSessionExpiry(err);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  const link =
    summary && typeof window !== 'undefined'
      ? `${window.location.origin}/register?ref=${summary.referralCode}`
      : '';

  const copy = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the link is selectable in place */
    }
  }, [link]);

  return (
    <>
      <h1 className="info__title">{t('partner.title')}</h1>
      <p className="info__lede">
        {t('partner.lede')}
      </p>

      <section className="info__section">
        <h2>{t('partner.commissionTitle')}</h2>
        <p>
          {t('partner.commissionBodyA')} <b>{t('partner.netLosses')}</b>{' '}
          {t('partner.commissionBodyB')}
        </p>
        <div className="info__table-wrap">
          <table className="info__table">
            <thead>
              <tr>
                <th>{t('partner.colBand')}</th>
                <th>{t('partner.colReferred')}</th>
                <th>{t('partner.colShare')}</th>
              </tr>
            </thead>
            <tbody>
              {TIERS.map((tier) => (
                <tr key={tier.band}>
                  <td>
                    <b>{tier.band}</b>
                  </td>
                  <td>{tier.invited}</td>
                  <td>
                    <b>{tier.share}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: 12 }}>
          {t('partner.bandsNote')}
        </p>
      </section>

      <section className="info__section">
        <h2>{t('partner.dashboardTitle')}</h2>
        {summary ? (
          <>
            <p>
              {t('partner.dashboardIntroA')}{' '}
              <Link href="/referrals">{t('partner.referralPage')}</Link>.
            </p>
            <div className="info__table-wrap">
              <table className="info__table">
                <tbody>
                  <tr>
                    <td>{t('partner.yourShare')}</td>
                    <td>
                      <b>{summary.revSharePercentage}%</b>
                    </td>
                  </tr>
                  <tr>
                    <td>{t('partner.invited')}</td>
                    <td>
                      <b>{summary.totalInvited}</b>
                    </td>
                  </tr>
                  <tr>
                    <td>{t('partner.activeDepositors')}</td>
                    <td>
                      <b>{summary.activeDepositors}</b>
                    </td>
                  </tr>
                  <tr>
                    <td>{t('partner.claimable')}</td>
                    <td>
                      <b>
                        {formatDecimalString(summary.claimable, 2)}{' '}
                        {summary.currency}
                      </b>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p>
            {t('partner.trackingNote')}{' '}
            {token
              ? t('partner.loadingFigures')
              : t('partner.signInForFigures')}
          </p>
        )}
      </section>

      <section className="info__section">
        <h2>{summary ? t('partner.yourLink') : t('partner.joinProgram')}</h2>
        {summary ? (
          <>
            <p>
              {t('partner.linkNote')}
            </p>
            <div className="info__card-foot" style={{ paddingTop: 0 }}>
              <code
                style={{
                  flex: '1 1 auto',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 12.5,
                  color: 'var(--fg-muted)',
                }}
              >
                {link}
              </code>
              <button type="button" className="info__cta" onClick={() => void copy()}>
                {copied ? t('partner.copied') : t('partner.copyLink')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              {t('partner.noApplicationA')} <b>{t('partner.everyAccount')}</b>.{' '}
              {t('partner.noApplicationB')}
            </p>
            <div className="info__card-foot" style={{ paddingTop: 0 }}>
              <Link className="info__cta" href="/register">
                {t('partner.createAccount')}
              </Link>
              <Link className="info__cta info__cta--ghost" href="/login">
                {t('partner.alreadyHaveOne')}
              </Link>
            </div>
          </>
        )}
      </section>

      <section className="info__section">
        <h2>{t('partner.termsTitle')}</h2>
        <ul className="info__list">
          <li>
            <b>{t('partner.termsSelfLead')}</b> {t('partner.termsSelfBody')}
          </li>
          <li>
            <b>{t('partner.termsTrafficLead')}</b> {t('partner.termsTrafficBody')}
          </li>
          <li>
            <b>{t('partner.termsAttrLead')}</b> {t('partner.termsAttrBody')}
          </li>
          <li>
            <b>{t('partner.termsChargebackLead')}</b> {t('partner.termsChargebackBody')}
          </li>
          <li>
            {t('partner.termsHouseA')} <Link href="/rules">{t('partner.houseRules')}</Link>{' '}
            {t('partner.termsHouseB')}
          </li>
        </ul>
      </section>
    </>
  );
}
