/**
 * FRIGAT — Attempt limiting, on two axes.
 *
 * Adapted from Event-space's rate limiter, which counts failures per IP *and*
 * per account. Either alone leaves a hole: per-IP only lets an attacker with a
 * pool of addresses grind a single account, and per-account only lets one
 * address walk a list of accounts. It also means a shared NAT cannot lock a
 * stranger out of their own login, because the account axis is keyed on email.
 *
 * Callers pass an IP string rather than a request object: nothing here is
 * HTTP-specific, so the WebSocket handshake or a job runner can use the same
 * counters without a Fastify type crossing into the service layer.
 *
 * State is in-memory, so it is per-instance and lost on restart. That is the
 * honest limit of this implementation: with several API instances behind a load
 * balancer the effective ceiling multiplies by the instance count. Moving these
 * counters to the Redis that is already configured is the fix, and is the same
 * shape Event-space uses — this module is the single seam where that swap
 * happens, which is why the Map is private to it.
 */

const WINDOW_MS = 15 * 60 * 1000;
/** Per IP: generous, because one address can legitimately be many people. */
const MAX_PER_IP = 20;
/** Per account: tight, because one account is one person who knows the password. */
const MAX_PER_ACCOUNT = 8;
/** How long an account stays locked once it trips the limit. */
const ACCOUNT_LOCKOUT_MS = 15 * 60 * 1000;

const attempts = new Map<string, { count: number; resetAt: number }>();

function sweep(now: number) {
  if (attempts.size <= 10_000) return;
  for (const [k, v] of attempts) if (now >= v.resetAt) attempts.delete(k);
}

/** Records a hit against `key` and reports whether it is now over `max`. */
function bump(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now >= entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    sweep(now);
    return false;
  }

  entry.count += 1;
  return entry.count > max;
}

/** True when this key is already over its limit, without counting a new hit. */
function isLocked(key: string, max: number): boolean {
  const entry = attempts.get(key);
  if (!entry || Date.now() >= entry.resetAt) return false;
  return entry.count > max;
}

function ipKey(ip: string, scope: string) {
  return `${scope}:ip:${ip}`;
}

function accountKey(scope: string, email: string) {
  return `${scope}:account:${email}`;
}

/**
 * Checked *before* the credentials are looked at, so a locked account costs an
 * attacker a request and no argon2 work.
 */
export function throttled(ip: string, scope: string, email?: string): boolean {
  if (bump(ipKey(ip, scope), MAX_PER_IP, WINDOW_MS)) return true;
  if (email && isLocked(accountKey(scope, email), MAX_PER_ACCOUNT)) return true;
  return false;
}

/** Counts a failure against the account axis. Only called on a genuine miss. */
export function recordAccountFailure(scope: string, email: string) {
  bump(accountKey(scope, email), MAX_PER_ACCOUNT, ACCOUNT_LOCKOUT_MS);
}

export function clearThrottle(ip: string, scope: string, email?: string) {
  attempts.delete(ipKey(ip, scope));
  if (email) attempts.delete(accountKey(scope, email));
}

/** Test seam: drops all counters. Not called by production code. */
export function resetRateLimits() {
  attempts.clear();
}
