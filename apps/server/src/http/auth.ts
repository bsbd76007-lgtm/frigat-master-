/**
 * FRIGAT — HTTP JWT Authentication
 *
 * JWT verification for REST routes, mirroring the WebSocket guard in
 * websocket/auth.middleware.ts. The token is read from the Authorization header
 * or the session cookie — never a query string, which would leak the credential
 * into access logs, referrers and browser history.
 */

import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config';

export interface AuthedIdentity {
  userId: string;
  role: 'USER' | 'ADMIN';
}

interface FrigatJwtClaims extends jwt.JwtPayload {
  sub?: string;
  userId?: string;
  role?: 'USER' | 'ADMIN';
}

declare module 'fastify' {
  interface FastifyRequest {
    identity?: AuthedIdentity;
  }
}

/**
 * Cookie the web app stores the session JWT in — must stay in step with
 * SESSION_COOKIE in apps/web/lib/adminAuth.ts.
 */
const SESSION_COOKIE = 'token';

/** `Authorization: Bearer <jwt>`. Null when absent or malformed. */
function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/**
 * The session cookie, parsed off the raw header — no cookie plugin is
 * registered, and one dependency is not worth a single lookup.
 */
function cookieToken(req: FastifyRequest): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;

    try {
      return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    } catch {
      return null; // malformed percent-encoding — treat as no cookie
    }
  }
  return null;
}

/**
 * Verifies the caller's JWT, taken from the Authorization header or, failing
 * that, the session cookie. Returns null on any failure.
 *
 * The header is preferred: it is the credential a client attaches deliberately,
 * whereas a cookie is attached by the browser on every request, including ones
 * a third-party page provoked. The cookie fallback exists because the admin UI
 * can reach this API with only that. It is not a CSRF hole in this shape — the
 * CORS allow-list refuses cross-origin reads, and every mutating admin route
 * takes a JSON body, which forces a preflight a forged form cannot satisfy.
 */
export function identityFromRequest(req: FastifyRequest): AuthedIdentity | null {
  const token = bearerToken(req) ?? cookieToken(req);
  if (!token) return null;

  let claims: FrigatJwtClaims;
  try {
    claims = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'], // pinned: never let the token pick "none"
    }) as FrigatJwtClaims;
  } catch {
    return null;
  }

  const userId = claims.userId ?? claims.sub;
  if (!userId) return null;

  return { userId, role: claims.role === 'ADMIN' ? 'ADMIN' : 'USER' };
}

/**
 * Fastify preHandler enforcing an ADMIN token.
 *
 * This is the real security boundary for admin data. The Next.js middleware in
 * the web app gates *navigation* only — anyone can curl this API directly, so
 * authorisation has to be decided here, on every request.
 */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const identity = identityFromRequest(req);

  if (!identity) {
    await reply.code(401).send({ error: 'unauthorized' });
    return reply;
  }
  if (identity.role !== 'ADMIN') {
    // Deliberately identical shape to a 401 body — don't confirm to a
    // non-admin that the endpoint exists and their token was otherwise valid.
    req.log.warn({ userId: identity.userId }, 'non-admin blocked from admin route');
    await reply.code(403).send({ error: 'forbidden' });
    return reply;
  }

  req.identity = identity;
}
