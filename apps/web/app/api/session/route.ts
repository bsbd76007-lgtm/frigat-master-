/**
 * FRIGAT — Session cookie exchange
 *
 * GET              → reports who the cookie says you are: { user } or
 *                    { user: null }. Never 401.
 * POST  { token }  → verifies the JWT server-side, then stores it in an
 *                    httpOnly cookie the Edge middleware can read.
 * DELETE           → clears the cookie (sign out).
 *
 * Verifying before storing means an invalid token is rejected at the door
 * rather than causing a redirect loop later. The cookie is httpOnly so page
 * scripts (and therefore XSS) cannot read the admin credential.
 *
 * GET answering 200 with a null user is what breaks the sign-in loop: this is
 * the endpoint the client asks "am I signed in?", and a 401 there is
 * indistinguishable from "your session expired", which sends the client back to
 * /login, which asks again. "Not signed in" is a normal answer, not an error.
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { SESSION_COOKIE, verifySession } from '@/lib/adminAuth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const result = await verifySession(token);

  if (result.status === 'valid' || result.status === 'forbidden') {
    return NextResponse.json({
      user: { id: result.claims.userId, role: result.claims.role },
    });
  }

  const response = NextResponse.json({ user: null, reason: result.status });

  if (result.status === 'invalid') response.cookies.delete(SESSION_COOKIE);

  return response;
}

export async function POST(request: Request) {
  // No session could be established → 200 with a null user, never a 401. The
  // caller learns nothing was stored and carries on; a 401 here reads as "your
  // session expired" and sends the client back to /login, which posts again.
  // Note this is *not* a permissive fallback: the cookie is still only set for
  // a token that verifies below.
  const noSession = (reason: string) => NextResponse.json({ user: null, reason });

  let token: unknown;
  try {
    ({ token } = (await request.json()) as { token?: unknown });
  } catch {
    return noSession('invalid_body');
  }

  if (typeof token !== 'string' || token.length === 0) {
    return noSession('token_required');
  }

  const result = await verifySession(token);
  // A missing JWT_SECRET is a deployment fault, not a signed-out visitor, and
  // it stays a 5xx so it surfaces in logs and alerting rather than looking like
  // an ordinary failed sign-in.
  if (result.status === 'misconfigured') {
    return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 });
  }
  if (result.status !== 'valid' && result.status !== 'forbidden') {
    return noSession(result.status);
  }

  const response = NextResponse.json({
    user: { id: result.claims.userId, role: result.claims.role },
    role: result.claims.role,
    userId: result.claims.userId,
  });

  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Track the token's own lifetime so the cookie cannot outlive the JWT.
    ...(result.claims.exp
      ? { expires: new Date(result.claims.exp * 1000) }
      : { maxAge: 60 * 60 }),
  });

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
