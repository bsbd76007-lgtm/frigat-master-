/**
 * FRIGAT — HTTP JWT Authentication
 *
 * JWT verification for REST routes, mirroring the WebSocket guard in
 * websocket/auth.middleware.ts. The token is read from the Authorization header
 * or the session cookie — never a query string, which would leak the credential
 * into access logs, referrers and browser history.
 */

import jwt from 'jsonwebtoken';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config';
import { prisma } from '../config/prisma';

export interface AuthedIdentity {
  userId: string;
  role: 'USER' | 'ADMIN';
}

interface FrigatJwtClaims extends jwt.JwtPayload {
  sub?: string;
  userId?: string;
  role?: 'USER' | 'ADMIN';
  /** Token version at issue time. Absent on tokens minted before this shipped. */
  tv?: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    identity?: AuthedIdentity;
    /**
     * Set by the onRequest hook once the token has been checked against the
     * stored tokenVersion. Distinguishes "already validated, no session" from
     * "the hook has not run", so identityFromRequest never silently falls back
     * to a signature-only check on a revoked token.
     */
    sessionChecked?: boolean;
  }
}

/**
 * Decodes and signature-checks a token. Says nothing about revocation — that
 * needs the stored tokenVersion, which needs a database read.
 */
function claimsFromRequest(req: FastifyRequest): FrigatJwtClaims | null {
  const token = bearerToken(req) ?? cookieToken(req);
  if (!token) return null;

  try {
    return jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'], // pinned: never let the token pick "none"
    }) as FrigatJwtClaims;
  } catch {
    return null;
  }
}

/**
 * Global session check.
 *
 * Registered once, so the 35 call sites of identityFromRequest keep their
 * synchronous signature while the revocation check — which is asynchronous —
 * happens here, once per request, before any handler runs.
 *
 * A password reset or change bumps User.tokenVersion. Any token signed with an
 * older `tv` is refused from that moment, which is what makes a reset actually
 * end the thief's session rather than merely change what the owner types.
 */
export function registerSessionGuard(app: FastifyInstance) {
  app.addHook('onRequest', async (req) => {
    req.sessionChecked = true;

    const claims = claimsFromRequest(req);
    if (!claims) return;

    const userId = claims.userId ?? claims.sub;
    if (!userId) return;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true, role: true },
    });
    // Deleted account, or a token issued before the current version: both mean
    // this session no longer exists.
    if (!user) return;
    if ((claims.tv ?? 0) !== user.tokenVersion) {
      req.log.info({ userId }, 'token rejected — superseded by a newer tokenVersion');
      return;
    }

    // Role comes from the database, not the token: a demoted admin should lose
    // access immediately rather than at token expiry.
    req.identity = { userId, role: user.role === 'ADMIN' ? 'ADMIN' : 'USER' };
  });
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
  // The hook has already verified the signature *and* the tokenVersion, so its
  // verdict is the authoritative one — including when it decided there is no
  // session. Returning null here rather than re-deriving from the token is
  // what stops a revoked token being accepted by a caller that never awaited
  // the check.
  if (req.sessionChecked) return req.identity ?? null;

  // Fallback for a request that bypassed the hook (a sub-app registered
  // without it). Signature-only: better than nothing, but it cannot see a
  // revocation, so the hook is what routes should rely on.
  const claims = claimsFromRequest(req);
  const userId = claims?.userId ?? claims?.sub;
  if (!claims || !userId) return null;

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
