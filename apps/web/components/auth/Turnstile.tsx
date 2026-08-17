'use client';

/**
 * FRIGAT — Cloudflare Turnstile widget
 *
 * Wraps `challenges.cloudflare.com/turnstile/v0/api.js` directly rather than
 * pulling in a React binding: this repo ships no UI dependencies it can write
 * itself, and the whole surface here is render / reset / remove.
 *
 * Rendered **explicitly** (`?render=explicit`) rather than by scanning the DOM
 * for `.cf-turnstile`. Implicit mode gives no handle back, and the forms need
 * one — a token is single-use, so every failed submit has to reset the widget
 * or the next attempt replays a token Cloudflare has already redeemed and will
 * refuse.
 *
 * With no site key configured the component renders nothing and reports an
 * empty token. That matches the server, which bypasses when it has no secret,
 * so a checkout of this repo runs without a Cloudflare account.
 */

import {

  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

/** Public site key. Empty string when unset, which disables the widget. */
export const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

export function isTurnstileConfigured(): boolean {
  return TURNSTILE_SITE_KEY.length > 0;
}

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileRenderOptions {
  sitekey: string;
  callback?: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
  theme?: 'auto' | 'light' | 'dark';
  action?: string;
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    onloadTurnstileCallback?: () => void;
  }
}

let scriptPromise: Promise<void> | null = null;

/** Loads the Cloudflare script once per page, however many widgets mount. */
function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`
    );
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('turnstile script failed')));
      return;
    }

    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Let a later mount retry rather than caching the failure forever.
      scriptPromise = null;
      reject(new Error('turnstile script failed'));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export interface TurnstileHandle {
  /** Clears the current token and asks Cloudflare for a fresh challenge. */
  reset: () => void;
}

export interface TurnstileProps {
  /** Receives the token, or '' whenever the current one stops being valid. */
  onToken: (token: string) => void;
  /** Labels the request in the Cloudflare dashboard. */
  action?: string;
  theme?: 'auto' | 'light' | 'dark';
}

export const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(function Turnstile(
  { onToken, action, theme = 'auto' },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  // Held in a ref so re-rendering the parent never re-renders the widget:
  // Turnstile tears down and re-challenges on every render() call.
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        if (!widgetIdRef.current || !window.turnstile) return;
        window.turnstile.reset(widgetIdRef.current);
        // The old token is dead the moment we reset; say so immediately rather
        // than leaving a spent value in the form's state.
        onTokenRef.current('');
      },
    }),
    []
  );

  const mountWidget = useCallback(() => {
    const container = containerRef.current;
    if (!container || !window.turnstile || widgetIdRef.current) return;

    widgetIdRef.current = window.turnstile.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      theme,
      ...(action ? { action } : {}),
      callback: (token) => onTokenRef.current(token),
      // A token expires after a few minutes. Clearing it is what stops a form
      // from submitting one Cloudflare will already reject.
      'expired-callback': () => onTokenRef.current(''),
      'timeout-callback': () => onTokenRef.current(''),
      'error-callback': () => onTokenRef.current(''),
    });
  }, [action, theme]);

  useEffect(() => {
    if (!isTurnstileConfigured()) return;

    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (!cancelled) mountWidget();
      })
      .catch(() => {
        // Cloudflare unreachable. The form stays usable and submits without a
        // token; the server decides whether that is acceptable.
        if (!cancelled) onTokenRef.current('');
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [mountWidget]);

  if (!isTurnstileConfigured()) return null;

  return <div className="auth__turnstile" ref={containerRef} />;
});

export default Turnstile;
