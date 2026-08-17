'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { BetDetailsModal } from '@/components/modals/BetDetailsModal';
import { FeedSkeleton } from '@/components/feed/ShimmerSkeleton';
import { GAME_ICONS } from '@/components/icons';

import { apiFetch } from '@/lib/api';
import { gameIdentity } from '@/lib/gameIdentity';
import { betProfit, formatSignedUsd, isWin, type LiveBet } from '@/lib/liveBets';

const MAX_ROWS = 20;

const TABS = ['All Bets', 'High Rollers', 'My Bets'] as const;
type Tab = (typeof TABS)[number];

interface LiveBetsFeedProps {
  /** Sidebar variant: narrower rows, fewer of them, no tab bar. */
  compact?: boolean;
}

export default function LiveBetsFeed({ compact = false }: LiveBetsFeedProps) {
  const { socket, token } = useGameSocket();
  const [tab, setTab] = useState<Tab>('All Bets');
  const [bets, setBets] = useState<LiveBet[]>([]);
  const [selfUserId, setSelfUserId] = useState<string | null>(null);
  const [selected, setSelected] = useState<LiveBet | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    const unsubscribe = socket.subscribe('LIVE_BET', (data) => {
      const userId = String(data.userId ?? '');
      const timestamp = typeof data.timestamp === 'number' ? data.timestamp : Date.now();
      setBets((prev) =>
        [
          {
            // Live frames carry no row id, so one is synthesised. The bet is
            // already in GameSession under a different id; this key only has to
            // be unique within the rendered list. The `live-` prefix is load
            // bearing — the details dialog reads it to know there is no
            // persisted row to fetch seeds from yet.
            id: `live-${timestamp}-${userId}`,
            userId,
            username: String(data.username ?? 'player'),
            gameType: String(data.gameType ?? 'UNKNOWN'),
            betAmount: String(data.betAmount ?? '0'),
            multiplier: typeof data.multiplier === 'number' ? data.multiplier : 0,
            payout: String(data.payout ?? '0'),
            timestamp,
          },
          ...prev,
        ].slice(0, MAX_ROWS)
      );
    });
    return unsubscribe;
  }, [socket]);

  useEffect(() => {
    let active = true;
    apiFetch(`api/bets/recent?limit=${MAX_ROWS}`)
      .then((res) => res.json())
      .then((body: { bets?: LiveBet[] }) => {
        const rows = body.bets;
        if (!active || !Array.isArray(rows)) return;
        setBets((prev) => {
          const seen = new Set(prev.map((bet) => bet.id));
          return [...prev, ...rows.filter((bet) => !seen.has(bet.id))].slice(0, MAX_ROWS);
        });
      })
      .catch(() => {
        /* no-op */
      })
      .finally(() => {
        // `finally`, not the success path: a failed backfill has also finished
        // loading, and leaving the skeleton up forever would promise rows that
        // are never going to arrive.
        if (active) setHasLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    try {
      const payload = token.split('.')[1];
      const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      setSelfUserId(typeof json.userId === 'string' ? json.userId : null);
    } catch {
      setSelfUserId(null);
    }
  }, [token]);

  const filtered = useMemo(() => {
    if (tab === 'All Bets') return bets;
    if (tab === 'High Rollers') {
      return bets.filter((bet) => Number(bet.betAmount) >= 50 || bet.multiplier >= 10);
    }
    if (tab === 'My Bets' && selfUserId) {
      return bets.filter((bet) => bet.userId === selfUserId);
    }
    return [];
  }, [bets, tab, selfUserId]);

  const closeDetails = useCallback(() => setSelected(null), []);

  // The sidebar column is ~240px, so a compact feed drops the tab bar and
  // shows fewer rows rather than shrinking type until it is unreadable.
  const rows = compact ? filtered.slice(0, 8) : filtered;

  return (
    <section className={`feed${compact ? ' feed--compact' : ''}`}>
      <div className="feed__header">
        <div>
          <h3>Live Bets</h3>
          <p className="feed__subtitle">Real-time action from the tables and crash rounds.</p>
        </div>
        {!compact && <div className="feed__tabs">
          {TABS.map((option) => (
            <button
              type="button"
              key={option}
              className={`feed__tab${option === tab ? ' feed__tab--active' : ''}`}
              onClick={() => setTab(option)}
            >
              {option}
            </button>
          ))}
        </div>}
      </div>

      <div className="feed__columns" aria-hidden="true">
        <span>Игра</span>
        <span>Выплата</span>
      </div>

      {!hasLoaded ? (
        <FeedSkeleton />
      ) : (
      <div className="feed__list">
        {rows.length === 0 ? (
          <div className="feed__empty">No live bets yet.</div>
        ) : (
          rows.map((bet) => {
            const { slug, name } = gameIdentity(bet.gameType);
            const Icon = GAME_ICONS[slug];
            const won = isWin(bet);
            return (
              <button
                type="button"
                key={bet.id}
                className="feed__row"
                onClick={() => setSelected(bet)}
              >
                <span className="feed__game">
                  <span className="feed__icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <span className="feed__name">{name}</span>
                </span>
                <span
                  className={`feed__payout${won ? ' feed__payout--win' : ' feed__payout--loss'}`}
                >
                  {/* The signed net result, not the gross payout: a $10 stake
                      returning $4 is a loss, and showing a bare "$4.00" in the
                      payout column would read as a win. */}
                  {formatSignedUsd(betProfit(bet))}
                </span>
              </button>
            );
          })
        )}
      </div>
      )}

      <BetDetailsModal bet={selected} onClose={closeDetails} />
    </section>
  );
}
