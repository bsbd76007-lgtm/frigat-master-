/**
 * FRIGAT — WebSocket JWT Authentication
 *
 * Verifies the bearer token presented at connection time. The token may arrive
 * either as `?token=<jwt>` in the upgrade URL or in the `Authorization:
 * Bearer <jwt>` header. On success the decoded identity is returned; on failure
 * the caller rejects the connection.
 */

import jwt from 'jsonwebtoken';
import type { IncomingMessage } from 'http';
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

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function extractToken(req: IncomingMessage): string | null {
  // 1) Authorization header
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
    /* ignore malformed URL */
  }

  return null;
}

/**
 * Verifies the connection's JWT. Throws AuthError on any failure.
 * Use during the WS connection handler to gate access.
 */
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

  const role = claims.role === 'ADMIN' ? 'ADMIN' : 'USER';
  return { userId, role };
}
