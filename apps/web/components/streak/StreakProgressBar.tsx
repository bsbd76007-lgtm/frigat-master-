'use client';

import { useEffect, useState } from 'react';

import { apiFetch } from '@/lib/api';
import { useLanguage } from '@/components/providers/LanguageProvider';

export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  nextMilestone: number | null;
  advancedToday: boolean;
  milestones: number[];
}

const VISIBLE_STOPS = 5;

export function StreakProgressBar() {
  const { t } = useLanguage();
  const [state, setState] = useState<StreakState | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch('api/streak/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((body: (StreakState & { restoreAvailable?: boolean }) | null) => {
        if (!active || !body || body.currentStreak < 1) return;
        if (body.restoreAvailable) return;
        setState(body);
        setIsVisible(true);
      })
      .catch(() => {
        /* no-op */
      });
    return () => {
      active = false;
    };
  }, []);

  if (!state || !isVisible) return null;

  const { currentStreak, nextMilestone, milestones } = state;
  const target = nextMilestone ?? currentStreak;

  const previousMilestone =
    [...milestones].reverse().find((m) => m <= currentStreak) ?? 0;
  const span = Math.max(1, target - previousMilestone);
  const done = currentStreak - previousMilestone;
  const pct = Math.min(100, Math.max(0, (done / span) * 100));

  // Deduped: when the span is shorter than VISIBLE_STOPS the rounding maps
  // several indices onto the same day, which produced duplicate React keys and
  // repeated dots on the road. A 4-day span should show 4 stops, not 5.
  const stopDays = Array.from(
    new Set(
      Array.from({ length: VISIBLE_STOPS }, (_, i) =>
        previousMilestone + Math.round(((i + 1) / VISIBLE_STOPS) * span)
      )
    )
  ).filter((day) => day > previousMilestone);

  const stops = stopDays.map((day) => ({ day, reached: day <= currentStreak }));

  return (
    <div className="streak" role="status" aria-live="polite">
      <button
        type="button"
        className="streak__close"
        onClick={() => setIsVisible(false)}
        aria-label={t('streak.dismiss')}
      >
        ×
      </button>

      <div className="streak__head">
        <span className="streak__flame" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2.5c2.5 3 5.5 5.5 5.5 9.5a5.5 5.5 0 1 1-11 0c0-1.6.6-2.9 1.5-4 .3 1.2 1 2 2 2.3-.3-3 1-5.6 2-7.8z" />
          </svg>
        </span>
        <div>
          <b className="streak__day">Day {currentStreak}</b>
          <span className="streak__sub">
            {nextMilestone
              ? `${nextMilestone - currentStreak} to go until day ${nextMilestone}`
              : 'Longest streak reached'}
          </span>
        </div>
      </div>

      <div className="streak__road">
        <div className="streak__track">
          <div className="streak__fill" style={{ width: `${pct}%` }} />
        </div>
        <ol className="streak__stops">
          {stops.map((stop) => (
            <li
              key={stop.day}
              className={`streak__stop${stop.reached ? ' streak__stop--on' : ''}`}
            >
              <span className="streak__dot" aria-hidden="true" />
              <span className="streak__label">{stop.day}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export default StreakProgressBar;
