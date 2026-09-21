/**
 * FRIGAT — Edge middleware: HTTPS enforcement + admin route guard
 *
 * Two jobs, in order:
 *
 * 1. Force HTTPS. Behind a TLS-terminating proxy (Render, Vercel, Cloudflare)
 *    the inbound request reaches Node as plain http, so the scheme has to be
 *    read from `x-forwarded-proto`. A 308 preserves the method and body, which
 *    a 302 does not — a plain-http POST of sign-in credentials must not be
 *    silently downgraded to a GET and lose them. This only catches a visitor's
 *    FIRST request; the HSTS header set in next.config.mjs is what stops the
 *    browser ever making a second one.
 *
 * 2. Guard /admin, as before.
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

/**
 * True when we can PROVE the visitor reached us over plain http.
 *
 * Deliberately conservative, and the conservatism is the point: this returns
 * false whenever the scheme is unknown.
 *
 * `x-forwarded-proto` is set by every TLS-terminating proxy this app runs
 * behind (Render, Vercel, Cloudflare). If it is absent, the request did not
 * come through such a proxy — a container health check, a smoke test against
 * a local production build, or a private-network probe. Treating "absent" as
 * "insecure" would redirect all of those to an https origin that may not be
 * listening, and for a health check that is an endless 308 loop that reports
 * the whole service as down.
 *
 * The header can carry a comma-separated chain when more than one proxy is in
 * front. The CLIENT-facing hop is the FIRST entry; reading the last would
 * report the internal hop, which is usually http, and would redirect every
 * request forever.
 */
function isInsecure(request: NextRequest): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (!forwarded) return false;
  if (forwarded.split(',')[0]!.trim().toLowerCase() !== 'http') return false;
  // Never redirect a loopback or internal-network request. Next itself sets
  // x-forwarded-proto: http on a direct connection, so without this a
  // container health check probing the service directly would be answered
  // with a 308 to an https origin nothing is listening on — the check fails
  // and the platform reports a healthy deployment as down. Verified against
  // `next start`, which reproduces exactly that.
  return !isLocalHost(request);
}

/** Loopback, link-local and cluster-internal hostnames. */
function isLocalHost(request: NextRequest): boolean {
  const raw = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
  // Strip the port, and the brackets an IPv6 authority carries.
  const host = raw.split(',')[0]!.trim().toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  );
}

export async function middleware(request: NextRequest) {
  // Localhost is served over http by design, and redirecting it would make the
  // dev server unreachable.
  if (process.env.NODE_ENV !== 'development' && isInsecure(request)) {
    const secure = request.nextUrl.clone();
    secure.protocol = 'https:';
    // `nextUrl.host` is the proxy's view of the host; prefer the forwarded
    // one so the redirect lands on the public domain rather than an internal
    // service address.
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    if (host) secure.host = host;
    return NextResponse.redirect(secure, 308);
  }

  // Everything below is the admin gate; other routes pass straight through.
  if (!request.nextUrl.pathname.startsWith('/admin')) return NextResponse.next();

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
  /**
   * Everything except Next's own build output, the metadata routes and files
   * with an extension (images, fonts, robots.txt, sitemap.xml). The HTTPS
   * redirect has to see ordinary page requests, so the old '/admin' matcher is
   * no longer sufficient — but running this on every static chunk would add a
   * middleware invocation per asset for no benefit.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)'],
};
