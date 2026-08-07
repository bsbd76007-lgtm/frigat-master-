/**
 * FRIGAT — Admin route guard (Edge middleware)
 *
 * Runs before any /admin route is served. Requires a cookie holding a validly
 * signed, unexpired JWT with role === 'ADMIN'; anything else is redirected to
 * /login. Because this executes on the server, an unauthorised visitor never
 * receives the admin markup at all.
 *
 * The token is read from an httpOnly cookie rather than localStorage — the
 * Edge runtime cannot see localStorage, and a token that JavaScript can read
 * is a token XSS can exfiltrate.
 *
 * This is a navigation gate. Admin *data* is authorised independently by
 * `requireAdmin` on the Fastify API, which is what actually protects it.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/adminAuth';

const PUBLIC_ROUTES = [
  '/login',
  '/register',
  '/api/auth/login',
  '/api/auth/register',
  '/api/session',
];

function isPublic(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

function redirectToLogin(request: NextRequest, reason: string) {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  url.searchParams.set('error', reason);

  // Preserve the destination only when signing in can actually satisfy it.
  // 'forbidden' means the visitor is already authenticated and simply is not an
  // admin: sending them back to /admin after a successful sign-in returns them
  // here, which redirects to /login again — an endless bounce. 'misconfigured'
  // is the same, for a reason no credential can fix.
  if (reason !== 'forbidden' && reason !== 'misconfigured') {
    url.searchParams.set('next', request.nextUrl.pathname);
  }

  const response = NextResponse.redirect(url);
  // Clear a rejected cookie so a stale/expired token can't cause a
  // redirect loop on every subsequent navigation.
  if (reason === 'invalid') response.cookies.delete(SESSION_COOKIE);
  return response;
}

export async function middleware(request: NextRequest) {
  if (process.env.NODE_ENV === 'development') return NextResponse.next();

  if (isPublic(request.nextUrl.pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const result = await verifySession(token);

  switch (result.status) {
    case 'valid': {
      const response = NextResponse.next();
      // Admin pages are per-request and privileged: never let a shared cache
      // or the browser's back/forward cache retain them.
      response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      response.headers.set('X-Frame-Options', 'DENY');
      response.headers.set('X-Content-Type-Options', 'nosniff');
      response.headers.set('Referrer-Policy', 'no-referrer');
      return response;
    }
    case 'forbidden':
      return redirectToLogin(request, 'forbidden');
    case 'invalid':
      return redirectToLogin(request, 'invalid');
    case 'misconfigured':
      // JWT_SECRET absent — deny rather than risk serving admin pages open.
      return redirectToLogin(request, 'misconfigured');
    default:
      return redirectToLogin(request, 'required');
  }
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};
