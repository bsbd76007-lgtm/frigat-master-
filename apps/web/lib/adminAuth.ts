/**
 * FRIGAT — Admin session verification (server-side only)
 *
 * Uses `jose` rather than `jsonwebtoken` because Next middleware runs on the
 * Edge runtime, which has no node:crypto. Shared by the middleware and by
 * server components so both apply identical rules.
 *
 * IMPORTANT — what this is and is not:
 *   This gates *navigation* to /admin pages. It is not the security boundary.
 *   Admin data lives behind `requireAdmin` on the Fastify API, which
 *   re-authorises every request; anyone can call that API directly, bypassing
 *   Next entirely. Treat this module as UX plus defence in depth.
 *
 * This file must never be imported by a client component — it reads the signing
 * secret. It is deliberately free of a 'use client' directive and of any React.
 */

import { jwtVerify } from 'jose';

/**
 * httpOnly cookie holding the session JWT. Named to match the localStorage key
 * so there is one word for the credential everywhere; every reader goes through
 * this constant, so the name is changed here and nowhere else.
 */
export const SESSION_COOKIE = 'token';

export interface AdminClaims {
  userId: string;
  role: 'USER' | 'ADMIN';
  exp?: number;
}

export type SessionResult =
  | { status: 'valid'; claims: AdminClaims }
  | { status: 'anonymous' }
  | { status: 'invalid' }
  | { status: 'forbidden'; claims: AdminClaims }
  | { status: 'misconfigured' };

function secretKey(): Uint8Array | null {
  const secret = process.env.JWT_SECRET;
  // Fail closed: with no secret we cannot verify anything, so we must not
  // fall back to "allow". A missing secret is a deployment error, not a
  // reason to serve the admin panel unauthenticated.
  if (!secret || secret.length === 0) return null;
  return new TextEncoder().encode(secret);
}

/** Verifies a raw JWT string. Never throws. */
export async function verifySession(
  token: string | undefined | null
): Promise<SessionResult> {
  const key = secretKey();
  if (!key) return { status: 'misconfigured' };
  if (!token) return { status: 'anonymous' };

  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
    });

    const userId =
      typeof payload.userId === 'string'
        ? payload.userId
        : typeof payload.sub === 'string'
          ? payload.sub
          : null;
    if (!userId) return { status: 'invalid' };

    const claims: AdminClaims = {
      userId,
      role: payload.role === 'ADMIN' ? 'ADMIN' : 'USER',
      exp: typeof payload.exp === 'number' ? payload.exp : undefined,
    };

    // Authenticated but not an administrator — distinct from "not logged in"
    // so the UI can say so instead of bouncing through an endless login loop.
    if (claims.role !== 'ADMIN') return { status: 'forbidden', claims };

    return { status: 'valid', claims };
  } catch {
    return { status: 'invalid' };
  }
}
