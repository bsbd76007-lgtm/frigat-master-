'use client';

/**
 * The session token, for pages outside the dashboard.
 *
 * `useGameSocket` carries a token too, but its provider is mounted in
 * `app/(dashboard)/layout.tsx` — calling it from the information pages throws,
 * and throws during prerender, which fails the build rather than the request.
 * These pages only need to know whether somebody is signed in, so they read the
 * store directly instead of opening a websocket to find out.
 *
 * Null on the server and on the first client render, then corrected after
 * mount: localStorage does not exist during SSR, and seeding state from it
 * would hydrate a different tree than the server sent.
 */

import { useEffect, useState } from 'react';

import { readStoredToken, subscribeToToken } from '@/lib/token';

export function useStoredToken(): string | null {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    setToken(readStoredToken());
    // Signing out in another tab should empty these pages too.
    return subscribeToToken(setToken);
  }, []);

  return token;
}

export default useStoredToken;
