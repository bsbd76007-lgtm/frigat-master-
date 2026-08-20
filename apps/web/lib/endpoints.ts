/**
 * FRIGAT — Backend endpoints
 *
 * The one place that decides where the API and the WebSocket live. Eleven call
 * sites used to carry their own `?? 'http://localhost:4000'`, so a deployment
 * that missed a variable did not fail loudly — it quietly pointed a production
 * page at a machine that was not there, and the only symptom was a fetch that
 * never resolved.
 *
 * Deliberately NOT a `'use client'` module. The admin screens are server
 * components that read the non-public `API_URL`, while the game screens are
 * client components that can only see `NEXT_PUBLIC_*`; both need these values,
 * and a client-only module cannot serve the server half.
 *
 * Note on how Next.js reads these: `process.env.NEXT_PUBLIC_*` is substituted
 * literally into the client bundle **at build time**, so it must be present
 * when `next build` runs — setting it only in the runtime environment leaves
 * the browser with whatever the default was at build time. `API_URL` has no
 * such constraint: it is read on the server, at request time.
 */

/** Where the API lives when nothing in the environment says otherwise. */
const DEFAULT_API_URL = 'https://frigat-master.onrender.com';

/** Trims whitespace and any trailing slash; empty becomes undefined. */
function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/, '');
  return trimmed ? trimmed : undefined;
}

/**
 * `http(s)://host` → `ws(s)://host`.
 *
 * Used when only the API URL is configured. Deriving beats defaulting: an
 * operator who sets NEXT_PUBLIC_API_URL to a new host and forgets the WS
 * variable gets a socket pointing at the same host, instead of one silently
 * still aimed at the old default while every HTTP call moves.
 */
function toWebSocketOrigin(httpOrigin: string): string {
  return httpOrigin.replace(/^http(s?):\/\//i, 'ws$1://');
}

/**
 * Ensures exactly one `/ws` path segment.
 *
 * Both spellings are in the wild here: `.env.example` ships
 * `NEXT_PUBLIC_WS_URL=ws://localhost:4000/ws` (with the path) while a bare
 * origin is the more natural thing to paste from a hosting dashboard. Handling
 * only one of them would turn the other into a `/ws/ws` 404.
 */
function withWebSocketPath(origin: string): string {
  const trimmed = origin.replace(/\/+$/, '');
  return /\/ws$/i.test(trimmed) ? trimmed : `${trimmed}/ws`;
}

/**
 * API origin, never with a trailing slash — callers append `/api/…`.
 *
 * `NEXT_PUBLIC_API_URL` wins over `API_URL` so that the value the browser was
 * built with and the value the server uses cannot disagree when both are set.
 */
export const API_URL: string =
  clean(process.env.NEXT_PUBLIC_API_URL) ??
  clean(process.env.API_URL) ??
  DEFAULT_API_URL;

/** Full WebSocket endpoint, including the `/ws` path. */
export const WS_URL: string = withWebSocketPath(
  clean(process.env.NEXT_PUBLIC_WS_URL) ?? toWebSocketOrigin(API_URL)
);
