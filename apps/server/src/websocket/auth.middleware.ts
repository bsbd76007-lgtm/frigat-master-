import jwt from 'jsonwebtoken';
import type { IncomingMessage } from 'http';
import { config } from '../config';
import { prisma } from '../config/prisma';

export interface AuthedIdentity {
  userId: string;
  /** What the TOKEN claimed. Not authoritative — verifyConnection decides. */
  role: 'USER' | 'ADMIN';
  /** Token version at issue time, checked against the user row on connect. */
  tokenVersion: number;
}

interface FrigatJwtClaims extends jwt.JwtPayload {
  sub?: string;
  userId?: string;
  role?: 'USER' | 'ADMIN';
  /** Token version at issue time. Absent on tokens minted before this shipped. */
  tv?: number;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function extractToken(req: IncomingMessage): string | null {
  const header = req.headers['authorization'];
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }

  // 2) token query param (browsers can't set WS headers directly)
  try {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
    const q = url.searchParams.get('token');
    if (q) return q;
  } catch {
    /* no-op */
  }

  return null;
}

export function authenticateConnection(req: IncomingMessage): AuthedIdentity {
  const token = extractToken(req);
  if (!token) throw new AuthError('Missing authentication token');

  let claims: FrigatJwtClaims;
  try {
    claims = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
    }) as FrigatJwtClaims;
  } catch (err) {
    throw new AuthError(
      err instanceof jwt.TokenExpiredError ? 'Token expired' : 'Invalid token'
    );
  }

  const userId = claims.userId ?? claims.sub;
  if (!userId) throw new AuthError('Token missing subject');

  // NOTE: the role in the token is NOT trusted — see verifyConnection below.
  // It is carried here only so a caller can log what the token claimed.
  const role = claims.role === 'ADMIN' ? 'ADMIN' : 'USER';
  return { userId, role, tokenVersion: claims.tv ?? 0 };
}

/**
 * Second half of socket authentication: everything that needs the database.
 *
 * A valid signature is not a live session. The HTTP guard (http/auth.ts) already
 * re-reads tokenVersion and role on every request; the socket did neither, which
 * left two holes:
 *
 *   - A password reset increments tokenVersion precisely to end a thief's
 *     session. HTTP calls with the old token started failing, so the victim
 *     believed they were safe — but the same token still opened a socket for the
 *     remaining 12h of its life, and the socket can bet, cash out and /tip.
 *   - Role came from the token claim, so an admin demoted through
 *     PATCH /api/admin/users/:id/role (which does not bump tokenVersion) kept
 *     ADMIN on the socket until expiry, and with it the support feed that fans
 *     every ticket and message to admin connections.
 *
 * Frozen is checked here too, so the freeze is decided before the connection is
 * allowed to send anything rather than by a fire-and-forget lookup racing the
 * first message.
 */
export async function verifyConnection(
  identity: AuthedIdentity
): Promise<{ userId: string; role: 'ADMIN' | 'USER'; email: string | null }> {
  const user = await prisma.user.findUnique({
    where: { id: identity.userId },
    select: { tokenVersion: true, role: true, frozen: true, email: true },
  });

  if (!user) throw new AuthError('Invalid token');
  if (identity.tokenVersion !== user.tokenVersion) {
    throw new AuthError('Session expired');
  }
  if (user.frozen) throw new AuthError('Account is frozen');

  return {
    userId: identity.userId,
    role: user.role === 'ADMIN' ? 'ADMIN' : 'USER',
    email: user.email ?? null,
  };
}
