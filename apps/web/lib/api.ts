'use client';

/**
 * FRIGAT — Browser API fetcher
 *
 * One place that attaches credentials to an outgoing request, so no caller has
 * to remember. Every request carries both halves of the session:
 *
 *   Authorization: Bearer …   from the localStorage token
 *   credentials: 'include'    so the httpOnly cookie rides along too
 *
 * Sending both is what fixes the 401s on the admin screens. The cookie is set
 * by /api/session and is the only credential a *server* component can read; the
 * localStorage token is the only one that survives a dev server restart or a
 * cookie the browser declined. Either alone leaves a gap; together, a request
 * succeeds if the browser holds a valid session in either store.
 *
 * Client components only — it reads localStorage. Server components must keep
 * reading the cookie via next/headers.
 */

import { API_URL, readStoredToken } from '@/lib/token';

/** A non-2xx response, carrying the server's own error copy where it gave any. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function resolve(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return path.startsWith('/') ? path : `${API_URL}/${path}`;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);

  const token = readStoredToken();
  if (token && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token}`);
  }
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return fetch(resolve(path), {
    ...init,
    headers,
    credentials: 'include',
    // Admin data is live; a cached 401 from a previous session would be worse
    // than useless.
    cache: init.cache ?? 'no-store',
  });
}

/**
 * `apiFetch` plus JSON parsing. Throws `ApiError` on a non-2xx, preferring the
 * server's `detail`/`error` copy over a bare status code.
 */
export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const detail =
      (typeof body.detail === 'string' && body.detail) ||
      (typeof body.error === 'string' && body.error) ||
      `Request failed (${response.status})`;
    throw new ApiError(response.status, detail);
  }

  return body as T;
}
