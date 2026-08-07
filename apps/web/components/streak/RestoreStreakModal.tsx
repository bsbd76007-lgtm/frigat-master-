'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { apiFetch } from '@/lib/api';
import { formatDecimalString } from '@/lib/decimal';

interface StreakSummary {
  restorableStreak: number;
  streakRestoreCost: string;
  restoreAvailable: boolean;
}

/**
 * Offers a paid reinstatement of a broken streak.
 *
 * Shown only while `restoreAvailable` is true — the server measures a two-day
 * window from the break, so the offer expires instead of becoming a permanent
 * upsell. The price is read from the server, never computed here.
 *
 * Deliberately plain about what it costs: the charge is real money off a real
 * balance, so the button states the amount rather than saying "Restore now"
 * and revealing the price after the click.
 */
export function RestoreStreakModal() {
  const [summary, setSummary] = useState<StreakSummary | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setIsMounted(true), []);

  useEffect(() => {
    let active = true;
    apiFetch('api/streak/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((body: StreakSummary | null) => {
        if (!active || !body?.restoreAvailable) return;
        setSummary(body);
        setIsOpen(true);
      })
      .catch(() => {
        /* no offer is the safe default */
      });
    return () => {
      active = false;
    };
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  const restore = useCallback(() => {
    setIsBusy(true);
    setError(null);
    apiFetch('api/streak/restore', { method: 'POST', body: '{}' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body?.message ?? 'Could not restore your streak.');
        }
        setIsOpen(false);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsBusy(false));
  }, []);

  if (!isMounted || !isOpen || !summary) return null;

  return createPortal(
    <div className="rsm__overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="rsm__panel" role="dialog" aria-modal="true" aria-labelledby="rsm-title">
        <h2 className="rsm__title" id="rsm-title">
          Your {summary.restorableStreak}-day streak ended
        </h2>
        <p className="rsm__copy">
          You can put it back and carry on from day {summary.restorableStreak + 1},
          or start again from day one at no cost.
        </p>

        <div className="rsm__price">
          <span>Restore cost</span>
          <b>${formatDecimalString(summary.streakRestoreCost, 2)}</b>
        </div>

        {error && <p className="rsm__error" role="alert">{error}</p>}

        <div className="rsm__actions">
          {/* The free option is a real button, not fine print: a dialog where
              only the paid path is prominent is a dark pattern. */}
          <button type="button" className="rsm__skip" onClick={close} disabled={isBusy}>
            Start from day 1
          </button>
          <button type="button" className="rsm__pay" onClick={restore} disabled={isBusy}>
            {isBusy
              ? 'Restoring…'
              : `Restore for $${formatDecimalString(summary.streakRestoreCost, 2)}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default RestoreStreakModal;
