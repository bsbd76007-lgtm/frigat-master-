/**
 * FRIGAT — Next.js configuration.
 *
 * Beyond the build wiring this file owns two security concerns that have no
 * better home: the secret-leak guard below, and the response headers further
 * down. Both run for every build and every request respectively, so neither
 * depends on a developer remembering anything.
 */

/* ── Secret-leak guard ────────────────────────────────────────────────
 * Next.js inlines every NEXT_PUBLIC_* variable into the client bundle at
 * build time. That makes the prefix a loaded gun: a variable named
 * NEXT_PUBLIC_JWT_SECRET is not "a secret that happens to be public", it is
 * the signing key published to every visitor. This repo shipped exactly that
 * pairing in apps/web/.env.production once already.
 *
 * Failing the build is deliberate. A warning is something a deploy pipeline
 * scrolls past; a non-zero exit is not.
 */
const FORBIDDEN_PUBLIC = /^NEXT_PUBLIC_.*(SECRET|PRIVATE|TOKEN|PASSWORD|CREDENTIAL|_KEY)$/i;
// Turnstile's SITE key is public by design — the widget renders it into the
// page — so the one legitimate *_KEY is allowed through by name.
const PUBLIC_KEY_ALLOWLIST = new Set(['NEXT_PUBLIC_TURNSTILE_SITE_KEY']);

const leaked = Object.keys(process.env).filter(
  (name) => FORBIDDEN_PUBLIC.test(name) && !PUBLIC_KEY_ALLOWLIST.has(name)
);

if (leaked.length > 0) {
  throw new Error(
    `Refusing to build: ${leaked.join(', ')} would be inlined into the client ` +
      `bundle and served to every visitor. Drop the NEXT_PUBLIC_ prefix so the ` +
      `value stays server-side, or rename it if it is genuinely public.`
  );
}

/* ── Response headers ─────────────────────────────────────────────────
 * Applied to every route. HSTS is the one that forces HTTPS for real: the
 * middleware redirect below catches a visitor's first plain-http request, and
 * this header means the browser never makes a second one.
 *
 * `preload` is intentionally omitted. Submitting to the HSTS preload list is
 * close to irreversible and would break any http-only subdomain the operator
 * still runs, so that is an operator decision, not a default.
 */
const SECURITY_HEADERS = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains',
  },
  // The site frames nothing and should be framed by nobody — clickjacking on a
  // page with real-money buttons is not theoretical.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Send the origin to third parties but never the path: a game URL can carry
  // context about what a player is doing.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Nothing here uses these, so deny them rather than leave them available to
  // injected script.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @frigat/shared ships TypeScript-adjacent ESM from a workspace package.
  transpilePackages: ['@frigat/shared'],
  // `next dev` and `next build` share .next by default, and a build replaces
  // the chunks a running dev server is serving — every route then 500s with
  // "Cannot find module './<n>.js'". Setting NEXT_DIST_DIR lets a production
  // build run alongside dev without touching it.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The bundle should not advertise which framework version to attack.
  poweredByHeader: false,

  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
