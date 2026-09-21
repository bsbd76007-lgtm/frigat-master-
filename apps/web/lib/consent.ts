/**
 * FRIGAT — analytics consent.
 *
 * Scope is deliberately narrow. This governs ONE thing: whether optional
 * analytics may load. It does not gate the session cookie or the session token
 * — those are strictly necessary (without them you cannot stay signed in), and
 * under the ePrivacy rules strictly necessary storage does not require
 * consent. Asking about them would be theatre: there is no working site if you
 * decline.
 *
 * Consent is stored per-device in localStorage rather than in a cookie, so the
 * record of a refusal does not itself create the tracking surface the visitor
 * just refused.
 */

export type ConsentChoice = 'accepted' | 'rejected';

const STORAGE_KEY = 'frigat.consent.analytics';

/** Fired on the window when the choice changes, so listeners update at once. */
export const CONSENT_EVENT = 'frigat:consent';

/**
 * The stored choice, or null if the visitor has not answered yet.
 *
 * Every access is wrapped: localStorage throws outright in some contexts
 * (Safari private mode historically, and any browser configured to block site
 * data), and an exception here would take down whatever is rendering the
 * banner. An unreadable store is treated as "no answer", which fails closed —
 * analytics stay off.
 */
export function readConsent(): ConsentChoice | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'accepted' || value === 'rejected' ? value : null;
  } catch {
    return null;
  }
}

/** Record a choice and notify listeners in this tab. */
export function writeConsent(choice: ConsentChoice): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // A blocked store means the choice cannot persist. The event below still
    // fires, so the banner closes and the session behaves as the visitor
    // asked; it will simply ask again next time rather than silently assuming.
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: choice }));
}
