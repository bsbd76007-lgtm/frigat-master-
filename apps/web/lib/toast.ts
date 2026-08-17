'use client';

/**
 * FRIGAT — Toast bus
 *
 * Deliberately the same shape as appPanels.ts: a window CustomEvent, no
 * context, no provider. A toast can then be raised from anywhere — a modal, a
 * hook, a socket handler — without that caller needing to sit under a provider
 * or thread a callback down through props it otherwise has no use for.
 *
 * The renderer is <Toaster />, mounted once in the dashboard layout.
 */

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
  /** Milliseconds on screen. */
  duration: number;
}

const EVENT = 'frigat:toast';

export function showToast(
  message: string,
  tone: ToastTone = 'info',
  duration = 5000
): void {
  if (typeof window === 'undefined') return;
  const toast: Toast = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    message,
    tone,
    duration,
  };
  window.dispatchEvent(new CustomEvent<Toast>(EVENT, { detail: toast }));
}

export function subscribeToToasts(handler: (toast: Toast) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => handler((event as CustomEvent<Toast>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
