'use client';

/**
 * `support` replaced `chat`: the community chat is gone, and the Support
 * control now opens the support ticket panel — the one wired to the queue in
 * /admin/support.
 */
export type AppPanel = 'deposit' | 'withdraw' | 'support' | 'fairness';

const EVENT = 'frigat:open-panel';

export function openPanel(panel: AppPanel) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AppPanel>(EVENT, { detail: panel }));
}

export function subscribeToPanels(
  handler: (panel: AppPanel) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const listener = (event: Event) => {
    handler((event as CustomEvent<AppPanel>).detail);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
