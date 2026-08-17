'use client';

/**
 * FRIGAT — Security verification interstitial.
 *
 * Shown once per browser session before the platform is revealed.
 *
 * ── What this is, and what it deliberately is not ──────────────────────────
 * It runs a **real** Turnstile challenge: the widget is mounted, and the
 * overlay clears when Cloudflare issues a token for this visitor. It does not
 * reproduce Cloudflare's own interstitial — no Cloudflare wordmark or logo of
 * our own drawing, and no invented "Ray ID". The reference shown below is
 * plainly ours, generated locally and labelled as such.
 *
 * That matters for two reasons. Dressing our page as Cloudflare's is
 * impersonation of another company's brand, and a check that always passes
 * after a fixed delay tells a visitor their traffic was screened when nothing
 * screened it — on a site that takes money, a security claim should be true.
 * The widget below genuinely challenges the browser, so the claim holds.
 *
 * With no site key configured (local development, where the server bypasses
 * Turnstile anyway) there is nothing to solve, so the overlay shows briefly and
 * clears — and says that is what happened.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  isTurnstileConfigured,
  Turnstile,
  type TurnstileHandle,
} from '@/components/auth/Turnstile';
import { RadarLoader } from '@/components/common/RadarLoader';
import { useInjectedStyles } from '@/lib/useInjectedStyles';

/** Cleared once per browser session, not once per page. */
const SESSION_KEY = 'frigat.security.verified';

/** How long the unconfigured (development) path lingers before clearing. */
const DEV_PASS_MS = 2000;

const STYLE_ID = 'fg-security-guard-styles';

const CSS = `
/* One flat screen: the slate fills the viewport and the content sits on it
   directly. No card, no border, no shadow — a raised panel floating in dark
   space reads as a dialog over the site, and this is not over the site, it is
   the whole of it until the check clears. 100dvh rather than 100vh so a
   mobile browser's collapsing toolbar cannot leave a strip of page showing
   underneath. */
.sec { position: fixed; inset: 0; z-index: 200; display: flex; align-items: center;
  justify-content: center; width: 100%; min-height: 100vh; min-height: 100dvh;
  padding: 24px; box-sizing: border-box;
  background: var(--fg-bg, #0b0e14); }
.sec__box { width: 100%; max-width: 460px; text-align: center;
  color: var(--fg-text, #fff);
  font-family: var(--fg-font, ui-sans-serif, system-ui, sans-serif); }

.sec__brand { font-size: 24px; font-weight: 900; letter-spacing: .18em;
  color: var(--fg-accent, #f59e0b); }
.sec__title { margin: 14px 0 6px; font-size: 17px; font-weight: 700; }
.sec__sub { margin: 0; font-size: 13px; line-height: 1.6;
  color: var(--fg-muted, #94a3b8); }

.sec__radar { display: flex; justify-content: center; margin: 24px 0 8px; }

.sec__status { margin: 10px 0 0; font-size: 13px; font-weight: 700;
  color: var(--fg-text, #fff); }
.sec__widget { display: flex; justify-content: center; margin-top: 16px; min-height: 68px; }

.sec__foot { margin-top: 26px; padding-top: 16px;
  border-top: 1px solid var(--fg-line, #2a3547); }
.sec__meta { margin: 0; font-size: 11px; line-height: 1.7;
  color: var(--fg-dim, #64748b); }
.sec__meta b { font-family: var(--fg-mono, ui-monospace, monospace); font-weight: 600;
  color: var(--fg-muted, #94a3b8); }

`;

/**
 * A local reference for this attempt, so a player reporting a problem has
 * something to quote. Explicitly ours — it is not, and is not labelled as, a
 * Cloudflare Ray ID.
 */
function makeReference(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface CloudflareGuardProps {
  children: React.ReactNode;
}

export function CloudflareGuard({ children }: CloudflareGuardProps) {
  useInjectedStyles(STYLE_ID, CSS);

  // Starts "unknown" rather than "blocked": the server has no idea what the
  // session storage says, so rendering the overlay during SSR would flash it at
  // every visitor including the ones already cleared.
  const [checked, setChecked] = useState<boolean | null>(null);
  const [reference] = useState(makeReference);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    try {
      window.sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      /* private mode — the check simply runs again next navigation */
    }
    setChecked(true);
  }, []);

  useEffect(() => {
    let cleared = false;
    try {
      cleared = window.sessionStorage.getItem(SESSION_KEY) === '1';
    } catch {
      /* no-op */
    }
    if (cleared) {
      setChecked(true);
      return;
    }
    setChecked(false);

    // Nothing to solve without a site key. Show the check, say so, move on.
    if (!isTurnstileConfigured()) {
      timer.current = setTimeout(() => clear(), DEV_PASS_MS);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [clear]);

  // Until the session has been read, render the app rather than an overlay:
  // a returning visitor should never see a flash of the interstitial.
  if (checked === null || checked) return <>{children}</>;

  const live = isTurnstileConfigured();

  return (
    <>
      <div className="sec" role="status" aria-live="polite">
        <div className="sec__box">
          <div className="sec__brand">FRIGAT</div>
          <h1 className="sec__title">Performing security verification</h1>
          <p className="sec__sub">
            Checking your browser before you continue. This takes a few seconds
            and happens once per session.
          </p>

          <div className="sec__radar">
            <RadarLoader size={110} label="Performing security verification" />
          </div>
          <p className="sec__status">Verifying…</p>

          <div className="sec__widget">
            {live ? (
              <Turnstile
                ref={turnstileRef}
                onToken={(token) => {
                  // Cleared only on a real token: the visitor's browser solved
                  // an actual challenge rather than waiting out a timer.
                  if (token) clear();
                }}
                action="security-gate"
              />
            ) : null}
          </div>

          <div className="sec__foot">
            <p className="sec__meta">
              {live ? (
                <>Protected by Cloudflare Turnstile.</>
              ) : (
                <>
                  Verification is not configured on this deployment — continuing
                  without a challenge.
                </>
              )}
              <br />
              FRIGAT reference: <b>{reference}</b>
            </p>
          </div>
        </div>
      </div>

      {/* Kept mounted behind the overlay so the app is warm the moment the
          check clears, rather than starting from nothing. */}
      <div aria-hidden="true" style={{ display: 'none' }}>
        {children}
      </div>
    </>
  );
}

export default CloudflareGuard;
