'use client';

/**
 * FRIGAT — consent-gated analytics loader.
 *
 * Renders nothing at all — no script tag, no network request, no global —
 * unless BOTH are true:
 *
 *   1. an analytics endpoint is configured (lib/analytics.ts), and
 *   2. the visitor has actively accepted (lib/consent.ts).
 *
 * The gate is "the element does not exist", not "the script loaded and then
 * checked a flag". By the time a third-party script can read a flag it has
 * already been fetched, executed, and told the vendor's server that this
 * browser exists — which is the disclosure the visitor declined.
 *
 * `next/script` with `afterInteractive` keeps it off the critical path, so
 * accepting analytics does not cost first paint.
 */

import Script from 'next/script';
import { useEffect, useState } from 'react';

import {
  ANALYTICS_DOMAIN,
  ANALYTICS_ENABLED,
  ANALYTICS_ID,
  ANALYTICS_SRC,
} from '@/lib/analytics';
import { CONSENT_EVENT, readConsent, type ConsentChoice } from '@/lib/consent';

export function Analytics() {
  const [choice, setChoice] = useState<ConsentChoice | null>(null);

  useEffect(() => {
    setChoice(readConsent());

    // Re-read when the banner records an answer, so accepting starts analytics
    // in the same page view rather than only after a reload.
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<ConsentChoice>).detail;
      setChoice(detail ?? readConsent());
    };
    window.addEventListener(CONSENT_EVENT, onChange);

    // `storage` fires in the OTHER tabs when localStorage changes, so a
    // refusal in one tab is honoured by the others without a reload.
    const onStorage = () => setChoice(readConsent());
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener(CONSENT_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  if (!ANALYTICS_ENABLED || choice !== 'accepted') return null;

  return (
    <Script
      src={ANALYTICS_SRC}
      strategy="afterInteractive"
      // Both attributes are harmless when the other vendor is in use: each
      // product reads only its own, so one component serves either.
      data-domain={ANALYTICS_DOMAIN}
      data-website-id={ANALYTICS_ID}
    />
  );
}
