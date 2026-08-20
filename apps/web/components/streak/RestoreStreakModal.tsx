'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { apiFetch } from '@/lib/api';
import { formatDecimalString } from '@/lib/decimal';
import { useLanguage } from '@/components/providers/LanguageProvider';

interface StreakSummary {
  restorableStreak: number;
  streakRestoreCost: string;
  restoreAvailable: boolean;
}

export function RestoreStreakModal() {
  const { t } = useLanguage();
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
        /* no-op */
      });
    return () => {
      active = false;
    };
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  // Escape closes it too. A dialog that can only be dismissed by hitting a
  // specific control is a trap for anyone on a keyboard.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

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
        <button
          type="button"
          className="rsm__close"
          onClick={close}
          disabled={isBusy}
          aria-label={t('common.close')}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <h2 className="rsm__title" id="rsm-title">
          {t('streak.endedTitle', { days: summary.restorableStreak })}
        </h2>
        <p className="rsm__copy">
          {t('streak.endedCopy', { next: summary.restorableStreak + 1 })}
        </p>

        <div className="rsm__price">
          <span>{t('streak.restoreCost')}</span>
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
