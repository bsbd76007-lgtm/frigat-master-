/**
 * FRIGAT — Admin API proxy
 *
 * Forwards /api/admin/* from the browser to the Fastify admin API, attaching
 * the session JWT from the httpOnly cookie as a Bearer token. The credential
 * therefore never reaches client JavaScript.
 *
 * The session is re-verified here as defence in depth. Fastify's `requireAdmin`
 * authorises independently and remains the real boundary — this proxy only
 * decides whether to spend a request on it.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { SESSION_COOKIE, verifySession } from '@/lib/adminAuth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

const ALLOWED = [
  /^users$/,
  /^users\/[A-Za-z0-9_-]+$/,
  /^users\/[A-Za-z0-9_-]+\/balance$/,
  /^users\/[A-Za-z0-9_-]+\/role$/,
  /^users\/[A-Za-z0-9_-]+\/freeze$/,
  /^users\/[A-Za-z0-9_-]+\/revshare$/,
  /^transactions$/,
  /^metrics$/,
  /^withdrawals$/,
  /^withdrawals\/[A-Za-z0-9_-]+$/,
  /^risk$/,
  /^audit-logs$/,
];

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

async function forward(request: Request, path: string[], method: string) {
  // Cookie first, Bearer header second. The cookie is the credential the
  // browser sends on its own and cannot be read by script; the header is what
  // lib/api.ts attaches from localStorage, and is the only one that arrives
  // when the cookie was never set — a dev server restart, or a browser that
  // declined it. Accepting either is what clears the 401 on /admin/users.
  const token = cookies().get(SESSION_COOKIE)?.value ?? bearer(request);

  const session = await verifySession(token);
  if (session.status !== 'valid') {
    return NextResponse.json(
      { error: 'unauthorized', detail: `No valid admin session (${session.status}).` },
      { status: 401 }
    );
  }

  const suffix = path.join('/');
  if (!ALLOWED.some((pattern) => pattern.test(suffix))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const search = new URL(request.url).search;
  const body =
    method === 'GET' || method === 'DELETE' ? undefined : await request.text();

  try {
    const upstream = await fetch(`${API_BASE}/api/admin/${suffix}${search}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body,
      cache: 'no-store',
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'upstream_unreachable', detail: `Could not reach ${API_BASE}` },
      { status: 502 }
    );
  }
}

export async function GET(request: Request, ctx: { params: { path: string[] } }) {
  return forward(request, ctx.params.path, 'GET');
}
export async function POST(request: Request, ctx: { params: { path: string[] } }) {
  return forward(request, ctx.params.path, 'POST');
}
export async function PUT(request: Request, ctx: { params: { path: string[] } }) {
  return forward(request, ctx.params.path, 'PUT');
}
export async function PATCH(request: Request, ctx: { params: { path: string[] } }) {
  return forward(request, ctx.params.path, 'PATCH');
}
