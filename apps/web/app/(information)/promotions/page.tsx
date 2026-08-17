'use client';

/**
 * /promotions
 *
 * Every offer listed here is one the server can actually pay out:
 *
 *   Daily wheel      POST /api/vip/daily-wheel   (claimed on /vip)
 *   Weekly rakeback  POST /api/vip/claim-rakeback
 *   Daily cashback   POST /api/streak/cashback
 *   Partner revenue  POST /api/referrals/claim
 *
 * A "deposit match" was on the brief and is **not** here, because no endpoint
 * grants one — there is no bonus balance, no wagering-requirement tracking and
 * nothing to credit. Advertising a match a real-money player could accept and
 * then never receive is a chargeback and a complaint, not a marketing win. It
 * belongs on this page the day the ledger can honour it.
 *
 * Each card links to the surface that owns its claim, so there is exactly one
 * implementation of each payout. The wheel is *not* mounted inline here:
 * `DailyWheelModal` calls `useGameSocket`, whose provider lives in the
 * dashboard layout, so rendering it on an information page throws at prerender.
 */

import Link from 'next/link';

import { useStoredToken } from '@/hooks/useStoredToken';

interface Promo {
  id: string;
  name: string;
  tag: string;
  blurb: string;
  detail: string;
  action: { label: string; href?: string; onClick?: () => void };
}

export default function PromotionsPage() {
  const token = useStoredToken();

  const promos: Promo[] = [
    {
      id: 'wheel',
      name: 'Daily wheel spin',
      tag: 'Daily',
      blurb: 'One free spin every day, credited straight to your balance.',
      detail:
        'Resets 24 hours after your last spin. The prize is drawn from the same committed seed scheme the games use, so the segment you land on was fixed before the wheel started turning.',
      action: { label: 'Spin the wheel', href: '/vip' },
    },
    {
      id: 'rakeback',
      name: 'VIP rakeback',
      tag: 'Weekly',
      blurb: 'A percentage of everything you wager comes back, win or lose.',
      detail:
        'The rate rises with your tier — from 5% at Bronze to 10% at Platinum and above. It accrues on every settled bet and can be claimed whenever there is a balance to take.',
      action: { label: 'View tier & claim', href: '/vip' },
    },
    {
      id: 'cashback',
      name: 'Streak cashback',
      tag: 'Daily',
      blurb: 'Play on consecutive days and take a share of net losses back.',
      detail:
        'Quoted fresh by the server each time you open it, and claimable once per day. Breaking the streak resets the multiplier, not your history.',
      action: { label: 'Check today’s cashback', href: '/vip' },
    },
    {
      id: 'partner',
      name: 'Partner revenue share',
      tag: 'Ongoing',
      blurb: 'Earn a cut of what everyone you invite wagers, for as long as they play.',
      detail:
        'Tiered revenue share paid into a separate affiliate balance you can claim at any time. No cap on referrals and no expiry on the link.',
      action: { label: 'Partner program', href: '/partner-program' },
    },
  ];

  return (
    <>
      <h1 className="info__title">Promotions</h1>
      <p className="info__lede">
        Everything below is live and pays into your real balance. Bonuses are
        credited by the server when you claim them — there is no bonus wallet
        and no wagering requirement to clear first.
      </p>

      {!token && (
        <p className="info__note">
          <b>Signed out.</b>
          <span>
            These offers are tied to an account.{' '}
            <Link href="/login">Sign in</Link> or{' '}
            <Link href="/register">create an account</Link> to claim them.
          </span>
        </p>
      )}

      <div className="info__grid">
        {promos.map((promo) => (
          <article className="info__card" key={promo.id}>
            <span className="info__tag">{promo.tag}</span>
            <h3>{promo.name}</h3>
            <p>{promo.blurb}</p>
            <p style={{ fontSize: 12.5, opacity: 0.85 }}>{promo.detail}</p>
            <div className="info__card-foot">
              {promo.action.href ? (
                <Link className="info__cta" href={promo.action.href}>
                  {promo.action.label}
                </Link>
              ) : (
                <button
                  type="button"
                  className="info__cta"
                  onClick={promo.action.onClick}
                  disabled={!token}
                >
                  {promo.action.label}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      <section className="info__section" style={{ marginTop: 22 }}>
        <h2>How claiming works</h2>
        <ul className="info__list">
          <li>
            <b>The amount is calculated server-side.</b> Whatever a page shows
            you is a display of that same calculation, never an input to it — so
            a stale tab cannot claim yesterday&apos;s figure.
          </li>
          <li>
            <b>Claims are once per period.</b> A second attempt in the same
            window is refused rather than double-paid.
          </li>
          <li>
            <b>Credited to your real balance</b> through the ledger, in the same
            transaction that marks the bonus as taken.
          </li>
          <li>
            <b>Abuse voids it.</b> Multiple accounts, self-referral, or
            deposit-and-withdraw cycles with no play forfeit outstanding bonuses
            — see <Link href="/rules#aml">the AML summary</Link>.
          </li>
        </ul>
      </section>

      <p className="info__lede" style={{ marginTop: 22 }}>
        Topping up? The cashier lives in the header once you are on the casino.{' '}
        <Link className="info__cta info__cta--ghost" href="/">
          Go to the casino
        </Link>
      </p>
    </>
  );
}
