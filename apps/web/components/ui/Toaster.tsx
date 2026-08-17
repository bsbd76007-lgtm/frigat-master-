'use client';

/**
 * FRIGAT — Toast renderer
 *
 * Mounted once, in the dashboard layout. Everything else raises toasts through
 * lib/toast.ts, so no component needs a reference to this one.
 *
 * Announced with role="status" and aria-live="polite": a confirmation that only
 * appears visually is invisible to anyone using a screen reader, and "your
 * withdrawal was submitted" is exactly the kind of thing that must be spoken.
 */

import { useCallback, useEffect, useState } from 'react';

import { subscribeToToasts, type Toast } from '@/lib/toast';
import { useInjectedStyles } from '@/lib/useInjectedStyles';

const STYLE_ID = 'fg-toaster-styles';

const CSS = `
.fg-toaster { position: fixed; z-index: 120; right: 18px; bottom: 18px;
  display: flex; flex-direction: column; gap: 10px; width: min(360px, calc(100vw - 36px));
  pointer-events: none; }
@media (max-width: 640px) {
  /* Above the mobile dock, which owns the bottom of the screen. */
  .fg-toaster { right: 12px; left: 12px; bottom: 84px; width: auto; }
}

.fg-toast { display: flex; align-items: flex-start; gap: 10px; padding: 13px 14px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px; font-weight: 600; line-height: 1.45; color: #e2e8f0;
  background: #121c24; border: 1px solid #1e293b; border-left-width: 4px;
  border-radius: 12px; box-shadow: 0 18px 32px -12px rgba(0,0,0,.7);
  pointer-events: auto; animation: fg-toast-in .26s cubic-bezier(.2,.9,.3,1) both; }
.fg-toast--success { border-left-color: var(--fg-accent); }
.fg-toast--error { border-left-color: #ef4444; }
.fg-toast--info { border-left-color: #5b8fb9; }
.fg-toast--out { animation: fg-toast-out .22s ease forwards; }

.fg-toast__icon { flex: 0 0 auto; width: 18px; height: 18px; margin-top: 1px;
  border-radius: 999px; display: grid; place-items: center; font-size: 11px;
  font-weight: 900; color: #04120d; }
.fg-toast--success .fg-toast__icon { background: var(--fg-accent); }
.fg-toast--error .fg-toast__icon { background: #ef4444; color: #fff; }
.fg-toast--info .fg-toast__icon { background: #5b8fb9; }

.fg-toast__text { flex: 1 1 auto; min-width: 0; }
.fg-toast__close { flex: 0 0 auto; padding: 0 2px; font-size: 15px; line-height: 1;
  color: #64748b; background: none; border: 0; cursor: pointer; }
.fg-toast__close:hover { color: #e2e8f0; }
.fg-toast__close:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.35); }

@keyframes fg-toast-in {
  from { opacity: 0; transform: translateY(10px) scale(.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes fg-toast-out {
  to { opacity: 0; transform: translateY(6px) scale(.98); }
}

@media (prefers-reduced-motion: reduce) {
  .fg-toast, .fg-toast--out { animation: none; }
}
`;

const GLYPH: Record<Toast['tone'], string> = {
  success: '✓',
  error: '!',
  info: 'i',
};

export function Toaster() {
  useInjectedStyles(STYLE_ID, CSS);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  useEffect(
    () =>
      subscribeToToasts((toast) => {
        // Cap the stack: a burst of failures must not paper over the screen.
        setToasts((current) => [...current.slice(-2), toast]);
      }),
    []
  );

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((toast) =>
      setTimeout(() => dismiss(toast.id), toast.duration)
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  if (!toasts.length) return null;

  return (
    <div className="fg-toaster" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`fg-toast fg-toast--${toast.tone}`}>
          <span className="fg-toast__icon" aria-hidden="true">
            {GLYPH[toast.tone]}
          </span>
          <span className="fg-toast__text">{toast.message}</span>
          <button
            type="button"
            className="fg-toast__close"
            aria-label="Dismiss notification"
            onClick={() => dismiss(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export default Toaster;
