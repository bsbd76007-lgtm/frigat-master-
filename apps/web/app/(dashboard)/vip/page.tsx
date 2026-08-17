'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';

import { apiJson, ApiError } from '@/lib/api';
import { API_URL } from '@/lib/token';
import { formatDecimalString } from '@/lib/decimal';

interface VipStatus {
  tier: string;
  rakebackRate: number;
  totalWagered: string;
  nextTier: { name: string; threshold: string; remaining: string } | null;
  progress: number;
  claimable: string;
  balance: string;
  currency: string;
}

const TIERS = [
  { name: 'Unranked', threshold: 0, rakeback: '—' },
  { name: 'Bronze', threshold: 1_000, rakeback: '5%' },
  { name: 'Silver', threshold: 5_000, rakeback: '6%' },
  { name: 'Gold', threshold: 25_000, rakeback: '8%' },
  { name: 'Platinum', threshold: 100_000, rakeback: '10%' },
  { name: 'Diamond', threshold: 500_000, rakeback: '10%' },
];

const money = (value: string, digits = 2) => formatDecimalString(value, digits);

export default function VipPage() {
  const { token } = useGameSocket();
  const { t } = useLanguage();
  const [data, setData] = useState<VipStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setData(await apiJson<VipStatus>(`${API_URL}/api/vip/me`));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t('vip.loadError')
      );
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const claim = useCallback(async () => {
    if (claiming) return;
    setClaiming(true);
    setError(null);
    setClaimed(null);
    try {
      const result = await apiJson<{ claimed: string }>(
        `${API_URL}/api/vip/claim-rakeback`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      setClaimed(result.claimed);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError && err.message === 'nothing_to_claim'
          ? t('vip.nothingToClaimError')
          : err instanceof ApiError
            ? err.message
            : t('vip.claimError')
      );
    } finally {
      setClaiming(false);
    }
  }, [claiming, load, t]);

  if (!token) {
    return <p className="vip__empty">{t('vip.signIn')}</p>;
  }
  if (loading && !data) return <p className="vip__empty">{t('vip.loading')}</p>;

  const canClaim = data !== null && Number(data.claimable) > 0;

  return (
    <div className="vip">
      <header className="vip__header">
        <div>
          <h1>{t('vip.title')}</h1>
          <p>{t('vip.subtitle')}</p>
        </div>
        {/* The daily wheel moved to the Free Money hub, which owns every
            recurring reward. This page is tier progression and rakeback. */}
        <Link className="vip__wheel-btn" href="/freemoney">
          {t('vip.rewardsHub')}
        </Link>
      </header>

      {error && <p className="vip__error">{error}</p>}
      {claimed && (
        <p className="vip__ok" role="status">
          {t('vip.claimed', { amount: `$${money(claimed)}` })}
        </p>
      )}

      {data && (
        <>
          <section className="vip__cards">
            <div className="vip__card">
              <span>{t('vip.currentTier')}</span>
              <b className="vip__tier">{data.tier}</b>
              <small>
                {data.rakebackRate > 0
                  ? t('vip.rakebackRate', {
                      rate: (data.rakebackRate * 100).toFixed(0),
                    })
                  : t('vip.noRakeback')}
              </small>
            </div>
            <div className="vip__card">
              <span>{t('vip.totalWagered')}</span>
              <b>${money(data.totalWagered)}</b>
              <small>{t('vip.acrossAllGames')}</small>
            </div>
            <div className="vip__card">
              <span>{t('vip.availableRakeback')}</span>
              <b className={canClaim ? 'vip__claimable' : undefined}>
                ${money(data.claimable)}
              </b>
              <small>{data.currency}</small>
            </div>
          </section>

          <section className="vip__progress-box">
            {data.nextTier ? (
              <>
                <div className="vip__progress-head">
                  <span>
                    {t('vip.progressTo')} <b>{data.nextTier.name}</b>
                  </span>
                  <span>
                    {t('vip.toGo', { amount: `$${money(data.nextTier.remaining)}` })}
                  </span>
                </div>
                <div
                  className="vip__bar"
                  role="progressbar"
                  aria-valuenow={Math.round(data.progress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="vip__bar-fill"
                    style={{ width: `${Math.round(data.progress * 100)}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="vip__maxed">
                {t('vip.maxed', { tier: 'Diamond' })}
              </p>
            )}

            <button
              type="button"
              className="vip__claim"
              onClick={claim}
              disabled={!canClaim || claiming}
            >
              {claiming
                ? t('vip.claiming')
                : canClaim
                  ? t('vip.claimAmount', { amount: `$${money(data.claimable)}` })
                  : t('vip.nothingToClaim')}
            </button>
          </section>

          <section className="vip__ladder">
            <h2>{t('vip.ladder')}</h2>
            <table className="vip__table">
              <thead>
                <tr>
                  <th scope="col">{t('vip.colTier')}</th>
                  <th scope="col">{t('vip.colWagered')}</th>
                  <th scope="col">{t('vip.colRakeback')}</th>
                </tr>
              </thead>
              <tbody>
                {TIERS.map((tier) => (
                  <tr
                    key={tier.name}
                    className={tier.name === data.tier ? 'vip__row--on' : undefined}
                  >
                    <td>{tier.name}</td>
                    <td>${tier.threshold.toLocaleString()}</td>
                    <td>{tier.rakeback}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

    </div>
  );
}
