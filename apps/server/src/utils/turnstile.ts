/**
 * FRIGAT — Cloudflare Turnstile verification
 *
 * A Turnstile token proves a browser solved Cloudflare's challenge. It is
 * single-use and short-lived: Cloudflare redeems it on first `siteverify` call
 * and rejects every later one, so a route must verify exactly once per request
 * and never retry with the same token.
 *
 * ── On bypassing ────────────────────────────────────────────────────────────
 * Outside development the check is skipped in exactly one case: someone set
 * `TURNSTILE_DISABLED=true` on purpose. Nothing else infers a bypass, because
 * the alternative — treating an unset secret as "accept everything" — turns a
 * forgotten variable into open season on a platform that holds balances, and
 * that is the failure nobody notices until it is expensive.
 *
 * An unset secret therefore *refuses* traffic rather than waving it through,
 * and says so: the route answers 503 with a misconfiguration code, not the 403
 * a failed challenge gets, so a deploy that is missing its keys is diagnosable
 * from a single request instead of looking like every visitor is a bot.
 *
 * A missing *token* is only forgiven in development. In production an absent
 * token is a failure like any other: a bot that simply omits the field must not
 * be treated better than one that sends a bad value.
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
  console.error(
    '[turnstile] TURNSTILE_SECRET_KEY is not set. Human verification cannot run, so every sign-in and sign-up is being REFUSED with 503. ' +
      'Set the secret, or set TURNSTILE_DISABLED=true to accept traffic unchecked while you finish configuring the deployment.'
  );
}

let warnedAboutDisabled = false;

function warnOnceAboutDisabled(): void {
  if (warnedAboutDisabled) return;
  warnedAboutDisabled = true;

  // eslint-disable-next-line no-console
  console.warn(
    '[turnstile] TURNSTILE_DISABLED is set — human verification is OFF and every request is accepted unchecked. ' +
      'This is for first-deploy testing only. Unset it before taking real money.'
  );
}

/**
 * True when this process will not check a token at all.
 *
 * Narrower than it used to be. The old rule bypassed the whole of development
 * unconditionally, because the configured secret was invalid and every local
 * sign-in failed on a key the developer could not fix. That secret has since
 * been corrected, so development can and does verify for real — which is the
 * only way a local run tells you the key still works.
 *
 * What remains is the genuine tooling gap: a checkout with no secret, or a
 * form that submitted no token because the widget was never configured. Both
 * are development-only; in any other environment a missing secret is a
 * misconfiguration and a missing token is a failed challenge, and both are
 * handled as failures below.
 */
function bypassReason(
  token: string,
  secret: string
): 'disabled' | 'no-secret' | 'no-token' | null {
  // Opt-in, and the only way any environment skips the check. Checked before
  // everything else so a first deploy can come up before the keys exist.
  if (config.turnstile.disabled) return 'disabled';
  if (config.env !== 'development') return null;
  if (!secret) return 'no-secret';
  if (!token) return 'no-token';
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

  const trimmed = typeof token === 'string' ? token.trim() : '';

  // ── Bypass, decided before anything is sent to Cloudflare ──
  // Development only, and only when there is nothing to check with or nothing
  // to check. A development run that has both a secret and a token verifies
  // against Cloudflare like any other.
  const bypass = bypassReason(trimmed, secret);
  if (bypass === 'disabled') {
    warnOnceAboutDisabled();
    return { ok: true, bypassed: true };
  }
  if (bypass === 'no-secret') {
    warnOnceAboutMissingSecret();
    return { ok: true, bypassed: true };
  }
  if (bypass === 'no-token') {
    // eslint-disable-next-line no-console
    console.log('[DEV] No Turnstile token supplied — skipping verification on localhost');
    return { ok: true, bypassed: true };
  }

  // Outside development a missing secret cannot be waved through: it would
  // silently disable the protection on the environment that needs it.
  if (!secret) {
    warnOnceAboutMissingSecret();
    return rejection(['missing-input-secret']);
  }
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
 * True when a submitted token will actually be checked.
 *
 * Now equivalent to "a secret is configured": verification is skipped only
 * when the secret or the token is missing in development, and a caller asking
 * this wants to know whether a token it *does* send will be verified.
 */
export function isTurnstileEnforced(): boolean {
  return Boolean(config.turnstile.secretKey);
}
