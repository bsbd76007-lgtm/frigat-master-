'use client';

/**
 * FRIGAT — VIP dashboard
 *
 * Lifetime wagered volume, current tier and progress to the next, plus the
 * rakeback claim and the daily wheel.
 *
 * Every figure comes from GET /api/vip/me. Nothing is computed here: rakeback
 * entitlement nets off previous claims server-side, so a locally-derived
 * number would drift from what the claim endpoint actually pays.
 */

import { useCallback, useEffect, useState } from 'react';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import DailyWheelModal from '@/components/modals/DailyWheelModal';

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
  dailyWheelAvailable: boolean;
  dailyWheelNextAvailableAt: string | null;
}

/** Mirrors VIP_TIERS in apps/server/src/services/bonus.service.ts. */
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
  const [data, setData] = useState<VipStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState<string | null>(null);
  const [wheelOpen, setWheelOpen] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setData(await apiJson<VipStatus>(`${API_URL}/api/vip/me`));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not load your VIP status.'
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

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
      await load(); // entitlement has moved; re-read rather than guess
    } catch (err) {
      setError(
        err instanceof ApiError && err.message === 'nothing_to_claim'
          ? 'You have no rakeback to claim right now.'
          : err instanceof ApiError
            ? err.message
            : 'Could not claim rakeback.'
      );
    } finally {
      setClaiming(false);
    }
  }, [claiming, load]);

  if (!token) {
    return <p className="vip__empty">Sign in to see your VIP progress.</p>;
  }
  if (loading && !data) return <p className="vip__empty">Loading…</p>;

  const canClaim = data !== null && Number(data.claimable) > 0;

  return (
    <div className="vip">
      <header className="vip__header">
        <div>
          <h1>VIP Club</h1>
          <p>Wager across any game to climb tiers and earn rakeback.</p>
        </div>
        <button
          type="button"
          className="vip__wheel-btn"
          onClick={() => setWheelOpen(true)}
        >
          {data?.dailyWheelAvailable ? 'Daily spin ready' : 'Daily wheel'}
        </button>
      </header>

      {error && <p className="vip__error">{error}</p>}
      {claimed && (
        <p className="vip__ok" role="status">
          Claimed ${money(claimed)} — added to your balance.
        </p>
      )}

      {data && (
        <>
          <section className="vip__cards">
            <div className="vip__card">
              <span>Current tier</span>
              <b className="vip__tier">{data.tier}</b>
              <small>
                {data.rakebackRate > 0
                  ? `${(data.rakebackRate * 100).toFixed(0)}% rakeback`
                  : 'No rakeback yet'}
              </small>
            </div>
            <div className="vip__card">
              <span>Total wagered</span>
              <b>${money(data.totalWagered)}</b>
              <small>Across all games</small>
            </div>
            <div className="vip__card">
              <span>Available rakeback</span>
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
                    Progress to <b>{data.nextTier.name}</b>
                  </span>
                  <span>${money(data.nextTier.remaining)} to go</span>
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
                You have reached <b>Diamond</b>, the highest tier.
              </p>
            )}

            <button
              type="button"
              className="vip__claim"
              onClick={claim}
              disabled={!canClaim || claiming}
            >
              {claiming
                ? 'Claiming…'
                : canClaim
                  ? `Claim $${money(data.claimable)} rakeback`
                  : 'Nothing to claim'}
            </button>
          </section>

          <section className="vip__ladder">
            <h2>Tier ladder</h2>
            <table className="vip__table">
              <thead>
                <tr>
                  <th scope="col">Tier</th>
                  <th scope="col">Wagered</th>
                  <th scope="col">Rakeback</th>
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

      <DailyWheelModal
        open={wheelOpen}
        onClose={() => {
          setWheelOpen(false);
          void load(); // a spin changes both balance and wheel availability
        }}
      />
    </div>
  );
}
