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

const SESSION_COOKIE = 'token';

function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

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
      return null;
    }
  }
  return null;
}

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
