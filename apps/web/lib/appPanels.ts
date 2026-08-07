'use client';

/**
 * FRIGAT — Cross-component panel triggers
 *
 * A few UI surfaces (the wallet dialog, the chat drawer, the fairness modal)
 * are owned by the layout or the navbar, but need to be openable from anywhere
 * — the hero banner's CTAs, most obviously.
 *
 * A tiny event bus rather than lifted state or another context: the owners are
 * in three different components at three different depths, and threading props
 * through would couple the whole dashboard tree to whichever panels exist this
 * week. Subscribing is opt-in, so a page that renders without the layout (a
 * test, a future embed) simply has nothing listening and no crash.
 */

export type AppPanel = 'deposit' | 'withdraw' | 'chat' | 'fairness';

const EVENT = 'frigat:open-panel';

/** Requests that a panel be opened. No-op on the server. */
export function openPanel(panel: AppPanel) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AppPanel>(EVENT, { detail: panel }));
}

/**
 * Subscribes to open requests. Returns an unsubscribe function, so it drops
 * straight into a useEffect cleanup.
 */
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
