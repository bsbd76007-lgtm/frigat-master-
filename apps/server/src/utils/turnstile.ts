/**
 * FRIGAT — Cloudflare Turnstile verification
 *
 * A Turnstile token proves a browser solved Cloudflare's challenge. It is
 * single-use and short-lived: Cloudflare redeems it on first `siteverify` call
 * and rejects every later one, so a route must verify exactly once per request
 * and never retry with the same token.
 *
 * ── On bypassing ────────────────────────────────────────────────────────────
 * The check bypasses when no secret is configured, and only then. That is what
 * lets the repo run without a Cloudflare account — but it also means a
 * production deployment that forgets `TURNSTILE_SECRET_KEY` silently accepts
 * every request, which is the failure nobody notices. It is logged loudly at
 * the first bypass so it shows up in production logs rather than in an
 * incident.
 *
 * A missing *token* is only forgiven in development. In production an absent
 * token is a failure like any other: a bot that simply omits the field must not
 * be treated better than one that sends a bad value, which is precisely what
 * "no token means skip" would do.
 */

import { config } from '../config';

/** How long to wait on Cloudflare before giving up. */
const VERIFY_TIMEOUT_MS = 5000;

export type TurnstileOutcome =
  /** Verified, or deliberately skipped — the caller may proceed. */
  | { ok: true; bypassed: boolean }
  /**
   * Rejected. `codes` is Cloudflare's own error list, for logging only —
   * never surface it to the caller, it describes our configuration.
   *
   * `misconfigured` marks the codes that mean *our* setup is wrong rather than
   * the visitor being a bot. Both fail closed, but only one is worth waking
   * someone up for.
   */
  | { ok: false; codes: string[]; misconfigured: boolean };

/**
 * Cloudflare error codes that indicate a broken deployment rather than a
 * failed challenge. With any of these, *every* sign-in is being refused.
 */
const CONFIG_ERROR_CODES = new Set([
  'invalid-input-secret',
  'missing-input-secret',
  'bad-request',
]);

function rejection(codes: string[]): TurnstileOutcome {
  return {
    ok: false,
    codes,
    misconfigured: codes.some((code) => CONFIG_ERROR_CODES.has(code)),
  };
}

/** Cloudflare's siteverify response, narrowed to what is acted on. */
interface SiteVerifyResponse {
  success?: boolean;
  'error-codes'?: string[];
}

let warnedAboutMissingSecret = false;

function warnOnceAboutMissingSecret(): void {
  if (warnedAboutMissingSecret) return;
  warnedAboutMissingSecret = true;

  // eslint-disable-next-line no-console
  console.warn(
    '[turnstile] TURNSTILE_SECRET_KEY is not set — human verification is DISABLED in production. Every request is being accepted unchecked.'
  );
}

/**
 * True when this process will not check tokens at all.
 *
 * Development is included deliberately: a local checkout has no route to a
 * working Cloudflare secret, and the widget still mints tokens, so verifying
 * them locally means every sign-in fails on a key the developer cannot fix.
 */
function bypassReason(): 'development' | 'no-secret' | null {
  if (config.env === 'development') return 'development';
  if (!config.turnstile.secretKey) return 'no-secret';
  return null;
}

/**
 * Checks a Turnstile token with Cloudflare.
 *
 * Returns an outcome rather than throwing, so a route decides what a failure
 * means — the answer differs between "reject this sign-in" and "log it".
 *
 * A network failure or timeout reaching Cloudflare is a *failure*, not a pass.
 * Failing open here would hand anyone who can disrupt the outbound call a way
 * to switch the protection off.
 */
export async function verifyTurnstileToken(
  token?: string,
  remoteIp?: string
): Promise<TurnstileOutcome> {
  const secret = config.turnstile.secretKey;

  // ── Bypass, decided before anything is sent to Cloudflare ──
  //
  // Development bypasses whether or not a token was supplied. Checking the
  // token locally is what caused every sign-in to fail: the widget mints a
  // real token, Cloudflare rejects it against a secret the developer has no
  // way to make valid, and the form is stuck on "Human verification failed".
  const bypass = bypassReason();
  if (bypass === 'development') {
    // eslint-disable-next-line no-console
    console.log('[DEV] Bypassing Turnstile verification on localhost');
    return { ok: true, bypassed: true };
  }
  if (bypass === 'no-secret') {
    warnOnceAboutMissingSecret();
    return { ok: true, bypassed: true };
  }

  const trimmed = typeof token === 'string' ? token.trim() : '';

  // Past this point the environment is not development and a secret is set, so
  // a missing token is a genuine miss rather than a local-tooling gap.
  if (!trimmed) return rejection(['missing-input-response']);

  const body = new URLSearchParams({ secret, response: trimmed });
  // Cloudflare rejects a malformed remoteip outright, so it is sent only when
  // it looks like an address — a proxy can leave `req.ip` as something else.
  if (remoteIp && remoteIp.length <= 45) body.set('remoteip', remoteIp);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

  try {
    const response = await fetch(config.turnstile.verifyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });

    // Parsed whatever the status: Cloudflare answers a rejected *secret* with
    // HTTP 400 and the reason in the body, and that reason ("invalid-input-
    // secret") is the one an operator most needs to see. Reading the body only
    // on 2xx would reduce a precise misconfiguration to a bare "http-400".
    const result = (await response
      .json()
      .catch(() => ({}) as SiteVerifyResponse)) as SiteVerifyResponse;

    if (result.success === true) return { ok: true, bypassed: false };

    const codes = result['error-codes'] ?? [];
    if (codes.length > 0) return rejection(codes);

    return rejection([`http-${response.status}`]);
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return rejection([aborted ? 'timeout' : 'network-error']);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * True when tokens are actually checked.
 *
 * Deliberately not "is a secret configured": in development a secret is
 * present but never used, and a caller asking this question wants to know
 * whether verification is enforced, not whether a string exists in the env.
 */
export function isTurnstileEnforced(): boolean {
  return bypassReason() === null;
}
