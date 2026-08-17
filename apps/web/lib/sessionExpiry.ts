'use client';

/**
 * FRIGAT — What to do when the API says the session is gone.
 *
 * A 401 from a game route is not an error the player can act on: the stake
 * dialog, the retry button and the red toast are all noise when the real answer
 * is "sign in again". Worse, the stale token stays in localStorage, so every
 * later call fails the same way and the board looks broken rather than logged
 * out.
 *
 * This clears the token and hands off to `/login`, which already renders the
 * right copy for `?error=invalid` ("That session has expired. Sign in again.")
 * and already knows how to return the player to `?next=` afterwards — the same
 * contract `middleware.ts` uses for admin routes.
 *
 * ── Why not a modal ────────────────────────────────────────────────────────
 * `components/auth/LoginModal.tsx` exists but is mounted nowhere and its
 * transport points at `/api/auth/otp/request`, a route the server does not
 * have. Opening it on every expiry would replace a red toast with a dialog that
 * cannot sign anyone in. Sign-in here is a page, so this sends players to it.
 */

import { writeStoredToken } from '@/lib/token';

/** True when a thrown value is an API rejection meaning "not signed in". */
export function isUnauthorized(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: unknown }).status;
  if (status === 401) return true;

  // Some routes answer with a body code rather than the status alone, and the
  // socket reports its own string. Both end up as the message on ApiError.
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return false;
  const normalised = message.toLowerCase();
  return (
    normalised.includes('unauthorized') ||
    normalised.includes('unauthorised') ||
    normalised.includes('token expired') ||
    normalised.includes('invalid token') ||
    normalised.includes('jwt expired')
  );
}

let handling = false;

/**
 * Drops the dead session and sends the player to sign in.
 *
 * Guarded against re-entry: a board can have several requests in flight and
 * they will all 401 together, which without the latch would stack redirects
 * and clear the token repeatedly.
 */
export function handleSessionExpiry(): void {
  if (typeof window === 'undefined' || handling) return;
  handling = true;

  writeStoredToken(null);
  // Drop the mirrored httpOnly cookie too, or middleware keeps treating the
  // session as live for admin routes.
  void fetch('/api/session', { method: 'DELETE' }).catch(() => {});

  const next = `${window.location.pathname}${window.location.search}`;
  const target = `/login?error=invalid&next=${encodeURIComponent(next)}`;
  window.location.assign(target);
}

/**
 * Convenience for a catch block: returns true when the error was an expiry and
 * has been handled, so the caller can skip showing an error of its own.
 */
export function consumedAsSessionExpiry(error: unknown): boolean {
  if (!isUnauthorized(error)) return false;
  handleSessionExpiry();
  return true;
}
