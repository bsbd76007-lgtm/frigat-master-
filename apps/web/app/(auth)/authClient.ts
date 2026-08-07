'use client';

import { API_URL, writeStoredToken } from '@/lib/token';

export const DEFAULT_DESTINATION = '/games/crash';

export const ADMIN_DESTINATION = '/admin/dashboard';

export interface AuthedUser {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  balance?: string;
  frozen?: boolean;
}

interface AuthResponse {
  token?: string;
  user?: AuthedUser;
  error?: string;
  message?: string;
}

export class AuthError extends Error {}

const FALLBACK_COPY: Record<string, string> = {
  invalid_credentials: 'That email and password combination was not recognised.',
  invalid_credentials_format:
    'Enter a valid email address and a password of at least 8 characters.',
  email_taken: 'An account with that email already exists. Sign in instead.',
  too_many_requests: 'Too many attempts. Wait a few minutes and try again.',
};

/**
 * Posts credentials, persists the returned token, and returns the profile.
 * Throws `AuthError` with display-ready copy on any rejection.
 */
export async function authenticate(
  endpoint: 'login' | 'register',
  credentials: { email: string; password: string },
  ref?: string | null
): Promise<AuthedUser> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';

  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/auth/${endpoint}${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(credentials),
    });
  } catch {
    throw new AuthError('Could not reach the FRIGAT server. Is it running?');
  }

  let body: AuthResponse = {};
  try {
    body = (await response.json()) as AuthResponse;
  } catch {
    /* no-op */
  }

  if (!response.ok || !body.token || !body.user) {
    throw new AuthError(
      body.message ??
        (body.error && FALLBACK_COPY[body.error]) ??
        `Sign-in failed (${response.status}).`
    );
  }

  writeStoredToken(body.token);

  // Mirror the token into the httpOnly cookie. Players never need it; admins
  // do, because middleware.ts cannot see localStorage from the Edge runtime.
  // A failure here must not block an otherwise successful sign-in.
  try {
    await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: body.token }),
    });
  } catch {
    /* no-op */
  }

  return body.user;
}

export function safeDestination(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) {
    return DEFAULT_DESTINATION;
  }
  return next;
}
