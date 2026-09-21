'use client';

/**
 * FRIGAT — cookie consent banner.
 *
 * Shown once, until a choice is recorded. Design notes that are compliance
 * requirements rather than taste:
 *
 *   - Accept and reject are the SAME size, weight and prominence. A reject
 *     button styled as a faint text link is the pattern regulators have
 *     repeatedly ruled invalid, because consent obtained that way is not
 *     freely given.
 *   - There is no close button. Dismissing without choosing would leave the
 *     visitor in an undefined state that most implementations then read as
 *     acceptance.
 *   - Nothing loads before the choice: Analytics.tsx renders null until it
 *     sees 'accepted', so declining is honoured by the script never existing,
 *     not by a flag checked after it has already run.
 *
 * If no analytics endpoint is configured the banner never appears at all —
 * asking for consent to something the site does not do would be misleading.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { useLanguage } from '@/components/providers/LanguageProvider';
import { readConsent, writeConsent } from '@/lib/consent';
import { ANALYTICS_ENABLED } from '@/lib/analytics';

export function CookieConsent() {
  const { t } = useLanguage();
  // Starts false on both server and client so the first client render matches
  // the server HTML; the effect below is what reveals it. Reading localStorage
  // during render would be a hydration mismatch.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ANALYTICS_ENABLED) return;
    if (readConsent() === null) setVisible(true);
  }, []);

  if (!visible) return null;

  const choose = (choice: 'accepted' | 'rejected') => {
    writeConsent(choice);
    setVisible(false);
  };

  return (
    // `role="dialog"` rather than `alertdialog`: this is not an error and must
    // not steal focus from someone mid-task. It is reachable in tab order
    // because it is late in the DOM, and labelled so a screen reader announces
    // what it is on arrival.
    <section
      className="cc"
      role="dialog"
      aria-label={t('consent.aria')}
      aria-describedby="cc-body"
    >
      <div className="cc__inner">
        <div className="cc__text">
          <h2 className="cc__title">{t('consent.title')}</h2>
          <p className="cc__body" id="cc-body">
            {t('consent.body')}{' '}
            <Link className="cc__link" href="/privacy">
              {t('consent.learnMore')}
            </Link>
          </p>
        </div>

        <div className="cc__actions">
          {/* Reject first in DOM order: keyboard and screen-reader users reach
              the privacy-preserving option without passing the other one. */}
          <button type="button" className="cc__btn" onClick={() => choose('rejected')}>
            {t('consent.reject')}
          </button>
          <button
            type="button"
            className="cc__btn cc__btn--accept"
            onClick={() => choose('accepted')}
          >
            {t('consent.accept')}
          </button>
        </div>
      </div>
    </section>
  );
}
