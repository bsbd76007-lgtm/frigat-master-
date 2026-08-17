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
      <h1 className="info__title">Partner program</h1>
      <p className="info__lede">
        Send players to FRIGAT and earn a share of what they lose, for as long
        as they keep playing. No cap on referrals, no expiry on your link, and
        earnings land in a separate balance you can draw down whenever you like.
      </p>

      <section className="info__section">
        <h2>Commission structure</h2>
        <p>
          Revenue share is paid on the <b>net losses</b> of players who signed
          up through your link — not on their deposits and not on turnover, so
          the number moves with the same figure the house books.
        </p>
        <div className="info__table-wrap">
          <table className="info__table">
            <thead>
              <tr>
                <th>Band</th>
                <th>Referred players</th>
                <th>Revenue share</th>
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
          Every account starts at the standard rate. Bands above it are set per
          account by the affiliate team rather than granted automatically —
          reach out once you are sending consistent volume and we will move you
          up.
        </p>
      </section>

      <section className="info__section">
        <h2>Your dashboard</h2>
        {summary ? (
          <>
            <p>
              Live figures for your account. The full breakdown, including
              claiming, lives on <Link href="/referrals">your referral page</Link>.
            </p>
            <div className="info__table-wrap">
              <table className="info__table">
                <tbody>
                  <tr>
                    <td>Your revenue share</td>
                    <td>
                      <b>{summary.revSharePercentage}%</b>
                    </td>
                  </tr>
                  <tr>
                    <td>Players invited</td>
                    <td>
                      <b>{summary.totalInvited}</b>
                    </td>
                  </tr>
                  <tr>
                    <td>Active depositors</td>
                    <td>
                      <b>{summary.activeDepositors}</b>
                    </td>
                  </tr>
                  <tr>
                    <td>Available to claim</td>
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
            Tracking is real-time: invited players, how many have deposited, and
            the balance available to claim, all updated as rounds settle.{' '}
            {token
              ? 'Loading your figures…'
              : 'Sign in to see your own figures here.'}
          </p>
        )}
      </section>

      <section className="info__section">
        <h2>{summary ? 'Your link' : 'Join the program'}</h2>
        {summary ? (
          <>
            <p>
              Anyone who registers through this link is attributed to you
              permanently. Share it anywhere you like.
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
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              There is no application to fill in: <b>every account is a partner
              account</b>. Registering issues you a referral code, and your link
              works from that moment.
            </p>
            <div className="info__card-foot" style={{ paddingTop: 0 }}>
              <Link className="info__cta" href="/register">
                Create an account
              </Link>
              <Link className="info__cta info__cta--ghost" href="/login">
                I already have one
              </Link>
            </div>
          </>
        )}
      </section>

      <section className="info__section">
        <h2>Terms</h2>
        <ul className="info__list">
          <li>
            <b>Self-referral is not allowed.</b> Signing up through your own link
            or running a second account to farm commission forfeits the balance.
          </li>
          <li>
            <b>No incentivised or misleading traffic.</b> Promising players a cut
            of your commission, or advertising odds and offers this site does not
            run, voids earnings.
          </li>
          <li>
            <b>Attribution is on registration.</b> A player is credited to the
            link they signed up through, and stays yours from then on.
          </li>
          <li>
            <b>Chargebacks and fraud are deducted</b> from affiliate earnings
            before they become claimable.
          </li>
          <li>
            The <Link href="/rules">house rules</Link> apply to partners exactly
            as they do to players.
          </li>
        </ul>
      </section>
    </>
  );
}
