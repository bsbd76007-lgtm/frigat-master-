'use client';

/**
 * FRIGAT — Session token storage
 *
 * One place that knows where the player's JWT lives, so the auth pages, the
 * socket hook and the dashboard shell can never disagree about the key.
 *
 * Note the trade-off: localStorage is readable by any script on the origin, so
 * an XSS can exfiltrate this token. The *admin* credential deliberately does
 * not live here — it goes into the httpOnly cookie set by /api/session, which
 * is what middleware.ts checks before serving any /admin route.
 */

export const TOKEN_STORAGE_KEY = 'token';

const LEGACY_TOKEN_KEY = 'frigat.token';

const LOCAL_CHANGE_EVENT = 'frigat:token';

export function readStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const current = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (current) return current;

    const legacy = window.localStorage.getItem(LEGACY_TOKEN_KEY);
    if (legacy) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, legacy);
      window.localStorage.removeItem(LEGACY_TOKEN_KEY);
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeStoredToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
  }
  window.dispatchEvent(new CustomEvent(LOCAL_CHANGE_EVENT));
}

export function subscribeToToken(onChange: (token: string | null) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== TOKEN_STORAGE_KEY) return;
    onChange(readStoredToken());
  };
  const handleLocal = () => onChange(readStoredToken());

  window.addEventListener('storage', handleStorage);
  window.addEventListener(LOCAL_CHANGE_EVENT, handleLocal);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(LOCAL_CHANGE_EVENT, handleLocal);
  };
}

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
