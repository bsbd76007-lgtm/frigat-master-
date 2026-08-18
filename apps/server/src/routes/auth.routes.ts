/**
 * FRIGAT — Credential authentication routes
 *
 * The endpoint the rest of the stack was already written against: until now a
 * JWT had to be minted out of band and pasted into the UI. Both routes end the
 * same way — an HS256 token carrying { userId, role }, which is exactly what
 * http/auth.ts and websocket/auth.middleware.ts already verify.
 *
 * Password hashing is argon2id with the same parameters as prisma/seed.ts, so
 * seeded accounts and registered accounts verify through one code path.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { Prisma, Role } from '@prisma/client';
import { PASSWORD_POLICY, passwordProblems } from '@frigat/shared';
import { config } from '../config';
import { prisma } from '../config/prisma';
import { identityFromRequest } from '../http/auth';
import { verifyTurnstileToken } from '../utils/turnstile';
import { MailerNotConfiguredError, sendMail } from '../services/mailer.service';
import {
  discardOtp,
  issueOtp,
  OTP_POLICY,
  OtpCooldownError,
  OtpTooManyAttemptsError,
  verifyOtp,
  type OtpPurpose,
} from '../services/otp.service';

const ARGON2_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

const DUMMY_HASH_PROMISE = argon2.hash('frigat-nonexistent-account', ARGON2_OPTS);

/**
 * The one place a password becomes a stored digest.
 *
 * Registration and password reset must produce hashes the same `argon2.verify`
 * can read, so both go through here rather than each reaching for the options
 * object — a parameter that drifted between them would lock players out of
 * accounts whose password they had just set.
 */
function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTS);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = PASSWORD_POLICY.minLength;
const MAX_PASSWORD = PASSWORD_POLICY.maxLength;

interface CredentialsBody {
  email?: unknown;
  password?: unknown;
  /** Cloudflare Turnstile token from the widget on the auth forms. */
  turnstileToken?: unknown;
}

interface RegisterQuery {
  ref?: unknown;
}

const REFERRAL_CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;

interface ParsedCredentials {
  email: string;
  password: string;
}

/** Normalises and validates a credential pair. Returns null when malformed. */
function parseCredentials(body: CredentialsBody | undefined): ParsedCredentials | null {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!EMAIL_RE.test(email) || email.length > 254) return null;
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) return null;

  return { email, password };
}

/**
 * `tokenVersion` is signed in as `tv` and compared on every authenticated
 * request. Bumping the stored value therefore retires every token already
 * issued for that account.
 */
function signToken(userId: string, role: Role, tokenVersion: number): string {
  return jwt.sign({ userId, role, tv: tokenVersion }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
    subject: userId,
  });
}

/**
 * Attempt limiting, on two axes.
 *
 * Adapted from Event-space's rate limiter, which counts failures per IP *and*
 * per account. Either alone leaves a hole: per-IP only lets an attacker with a
 * pool of addresses grind a single account, and per-account only lets one
 * address walk a list of accounts. It also means a shared NAT cannot lock a
 * stranger out of their own login, because the account axis is keyed on email.
 *
 * State is in-memory, so it is per-instance and lost on restart. That is the
 * honest limit of this implementation: with several API instances behind a load
 * balancer the effective ceiling multiplies by the instance count. Moving these
 * counters to the Redis that is already configured is the fix, and is the same
 * shape Event-space uses.
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

function ipKey(req: FastifyRequest, scope: string) {
  return `${scope}:ip:${req.ip}`;
}

function accountKey(scope: string, email: string) {
  return `${scope}:account:${email}`;
}

/**
 * Checked *before* the credentials are looked at, so a locked account costs an
 * attacker a request and no argon2 work.
 */
function throttled(req: FastifyRequest, scope: string, email?: string): boolean {
  if (bump(ipKey(req, scope), MAX_PER_IP, WINDOW_MS)) return true;
  if (email && isLocked(accountKey(scope, email), MAX_PER_ACCOUNT)) return true;
  return false;
}

/** Counts a failure against the account axis. Only called on a genuine miss. */
function recordAccountFailure(scope: string, email: string) {
  bump(accountKey(scope, email), MAX_PER_ACCOUNT, ACCOUNT_LOCKOUT_MS);
}

function clearThrottle(req: FastifyRequest, scope: string, email?: string) {
  attempts.delete(ipKey(req, scope));
  if (email) attempts.delete(accountKey(scope, email));
}

/**
 * Runs the Turnstile check for an unauthenticated endpoint.
 *
 * Returns `true` when the request was rejected and a reply has already been
 * sent — callers must return immediately rather than continuing.
 *
 * Placed after the in-memory throttles and before any password hashing or
 * database read, so the expensive work sits behind the human check rather than
 * in front of it.
 */
async function turnstileRejected(
  req: FastifyRequest<{ Body: CredentialsBody }>,
  reply: FastifyReply,
  scope: string
): Promise<boolean> {
  const token =
    typeof req.body?.turnstileToken === 'string' ? req.body.turnstileToken : undefined;

  const outcome = await verifyTurnstileToken(token, req.ip);
  if (outcome.ok) return false;

  if (outcome.misconfigured) {
    // Not a bot — our own credentials. Every sign-in and sign-up on this
    // deployment is being refused for as long as this persists, so it is an
    // error rather than the routine warning a failed challenge gets.
    req.log.error(
      { scope, codes: outcome.codes },
      'turnstile is misconfigured — TURNSTILE_SECRET_KEY is missing or not accepted by Cloudflare, so ALL auth requests are being rejected. ' +
        'Set a valid secret, or set TURNSTILE_DISABLED=true to bypass while configuring the deployment.'
    );

    // 503, not 403. A 403 saying "human verification failed" tells an operator
    // testing a fresh deploy that they look like a bot, which sends them
    // looking in the wrong place entirely. This is a server fault, it is
    // retryable once the key is set, and it says which.
    await reply.code(503).send({
      error: 'turnstile_misconfigured',
      message:
        'Human verification is not configured on this server. This is a server-side problem, not a failed check.',
    });
    return true;
  }

  req.log.warn({ scope, ip: req.ip, codes: outcome.codes }, 'turnstile verification failed');
  await reply.code(403).send({
    error: 'turnstile_failed',
    message: 'Human verification failed. Please try again.',
  });
  return true;
}

/** The envelope every code-sending endpoint answers with, on success. */
interface CodeAccepted {
  requiresOtp: true;
  email: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  /** Development only — see `deliverCode`. */
  devCode?: string;
  delivered?: boolean;
}

type CodeDelivery =
  | { ok: true; body: CodeAccepted }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Mints a code, emails it, and returns either the accepted envelope or the
 * failure a route should reply with.
 *
 * Three endpoints need this exact sequence — password login's second factor,
 * passwordless login, and registration step one — and each of them has to get
 * the cooldown, the delivery failure and the development fallback right. Doing
 * it once means a fix lands in all three rather than two of them.
 */
async function deliverCode(
  req: FastifyRequest,
  email: string,
  options: {
    purpose: OtpPurpose;
    passwordHash?: string | null;
    subject: (code: string) => string;
    body: (code: string) => string;
  }
): Promise<CodeDelivery> {
  let issued;
  try {
    issued = await issueOtp(email, {
      purpose: options.purpose,
      passwordHash: options.passwordHash ?? null,
    });
  } catch (err) {
    if (err instanceof OtpCooldownError) {
      return {
        ok: false,
        status: 429,
        body: {
          error: 'otp_cooldown',
          message: `Please wait ${err.retryAfterSeconds}s before requesting another code.`,
          retryAfterSeconds: err.retryAfterSeconds,
        },
      };
    }
    throw err;
  }

  const accepted: CodeAccepted = {
    requiresOtp: true,
    email,
    expiresInSeconds: Math.floor(OTP_POLICY.ttlMs / 1000),
    resendAfterSeconds: Math.floor(OTP_POLICY.resendCooldownMs / 1000),
  };

  try {
    const result = await sendMail(
      { to: email, subject: options.subject(issued.code), text: options.body(issued.code) },
      req.log
    );

    req.log.info(
      { email, purpose: options.purpose, delivered: result.delivered },
      'otp issued'
    );

    // Development convenience only: with no SMTP host there is no inbox to
    // read, so the code comes back in the response to keep local sign-in
    // usable. Guarded on the environment, never reachable in production.
    if (!result.delivered && config.env !== 'production') {
      return { ok: true, body: { ...accepted, devCode: issued.code, delivered: false } };
    }

    return { ok: true, body: accepted };
  } catch (err) {
    // Delivery failed after the code row was written. Retire it: nobody can
    // read a code that was never sent, and leaving it live would hold the
    // player in the 60s cooldown waiting for an email that is not coming.
    await discardOtp(email).catch((cleanupErr) => {
      req.log.error({ err: cleanupErr, email }, 'failed to retire undelivered otp');
    });

    if (err instanceof MailerNotConfiguredError) {
      req.log.error('code requested but SMTP is not configured in production');
    } else {
      // The provider's own wording (bad credentials, throttling, TLS) is
      // operator information. It is logged in full and never returned: a
      // sign-in form is not the place to surface our SMTP configuration.
      req.log.error({ err, email, purpose: options.purpose }, 'otp email delivery failed');
    }

    return {
      ok: false,
      status: 503,
      body: {
        error: 'email_unavailable',
        message: 'We could not send your code right now. Please try again shortly.',
      },
    };
  }
}

/**
 * Whether an account signs in on its password alone.
 *
 * Two ways to qualify: the ADMIN role, or an address listed in
 * `AUTH_OTP_BYPASS_EMAILS` for a dev or break-glass account that is not an
 * admin. The role is read from the database row, never from anything the
 * client sent — a bypass keyed on a client-supplied field would let a caller
 * elect itself into it.
 */
function bypassesOtp(role: Role, email: string): boolean {
  if (role === Role.ADMIN) return true;
  return config.otpBypassEmails.includes(email.trim().toLowerCase());
}

/** Resolves a `?ref=` referral code to a user id, ignoring anything unknown. */
async function resolveReferrer(
  req: FastifyRequest,
  raw: unknown
): Promise<string | null> {
  const ref = typeof raw === 'string' ? raw.trim() : '';
  if (!ref || !REFERRAL_CODE_RE.test(ref)) return null;

  const referrer = await prisma.user.findUnique({
    where: { referralCode: ref },
    select: { id: true },
  });
  if (!referrer) req.log.info({ ref }, 'unknown referral code ignored');
  return referrer?.id ?? null;
}

export function registerAuthRoutes(app: FastifyInstance) {
  /**
   * GET /api/auth/me
   * The signed-in player's own profile.
   *
   * Register and login already return this shape, but only once — a returning
   * visitor arrives with nothing but the stored JWT, so anything that wants the
   * email or the account status (the account panel) had no way to ask for it.
   * The token decides whose row is read; the id is never taken from the client.
   */
  app.get('/api/auth/me', async (req, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });

    const user = await prisma.user.findUnique({
      where: { id: identity.userId },
      select: {
        id: true,
        email: true,
        role: true,
        frozen: true,
        createdAt: true,
        referralCode: true,
        wallets: { select: { balance: true, currency: true } },
      },
    });
    if (!user) return reply.code(404).send({ error: 'user_not_found' });

    // Decimal(18,8) does not survive a JSON number — balances stay strings all
    // the way to the client, as everywhere else.
    const wallet = user.wallets.find((w) => w.currency === 'USD') ?? user.wallets[0];

    return reply.send({
      id: user.id,
      email: user.email,
      role: user.role,
      frozen: user.frozen,
      createdAt: user.createdAt,
      referralCode: user.referralCode,
      balance: wallet?.balance.toString() ?? '0',
      currency: wallet?.currency ?? 'USD',
    });
  });

  /**
   * Registration step one: validate, hold the intent, email a code.
   *
   * Nothing is written to `User` here. The password is hashed immediately and
   * parked on the OtpCode row, so an address that never confirms leaves no
   * account behind — and an unverified address can never hold one.
   *
   * Unlike /api/auth/otp/send this *does* disclose whether an email is already
   * registered. That is unavoidable on a sign-up form: an address that cannot
   * be registered has to be reported as such, or the player is told to check an
   * inbox for a code that will never arrive. The login path keeps its silence.
   */
  const handleRegisterRequestCode = async (
    req: FastifyRequest<{ Body: CredentialsBody; Querystring: RegisterQuery }>,
    reply: FastifyReply
  ) => {
    if (throttled(req, 'register')) {
      return reply.code(429).send({ error: 'too_many_requests' });
    }

    // Covers /api/auth/register and /api/auth/register/request-code alike —
    // both are this handler, so neither can be the unguarded way in.
    if (await turnstileRejected(req, reply, 'register')) return reply;

    const credentials = parseCredentials(req.body);
    if (!credentials) {
      return reply.code(400).send({
        error: 'invalid_credentials_format',
        message: `A valid email and a password of at least ${MIN_PASSWORD} characters are required.`,
      });
    }

    // Complexity is checked on sign-up only. Applying it at login would lock
    // out every account created before the rule existed, which punishes the
    // wrong people — those passwords get upgraded on the next change instead.
    const weaknesses = passwordProblems(credentials.password);
    if (weaknesses.length > 0) {
      return reply.code(400).send({
        error: 'weak_password',
        message: `Password must contain: ${weaknesses.map((w) => w.message.toLowerCase()).join(', ')}.`,
        requirements: weaknesses.map((w) => w.code),
      });
    }

    const taken = await prisma.user.findUnique({
      where: { email: credentials.email },
      select: { id: true },
    });
    if (taken) {
      return reply.code(409).send({
        error: 'email_taken',
        message: 'An account with that email already exists.',
      });
    }

    // Hashed before it is stored, and never held in plaintext for the minutes
    // the intent is live. The cost is paid here rather than at confirm so the
    // code step stays fast.
    const passwordHash = await hashPassword(credentials.password);

    const delivery = await deliverCode(req, credentials.email, {
      purpose: 'REGISTER',
      passwordHash,
      subject: (code) => `${code} is your FRIGAT verification code`,
      body: (code) =>
        [
          `Welcome to FRIGAT. Your verification code is ${code}.`,
          ``,
          `Enter it to finish creating your account. It expires in`,
          `${Math.floor(OTP_POLICY.ttlMs / 60000)} minutes and can be used once.`,
          `If you did not sign up, you can ignore this email — no account exists`,
          `until the code is entered.`,
        ].join('\n'),
    });

    if (!delivery.ok) return reply.code(delivery.status).send(delivery.body);

    req.log.info({ email: credentials.email }, 'registration code sent');
    return reply.send(delivery.body);
  };

  app.post<{ Body: CredentialsBody; Querystring: RegisterQuery }>(
    '/api/auth/register/request-code',
    handleRegisterRequestCode
  );

  /**
   * POST /api/auth/register
   *
   * Kept as an alias of step one rather than removed, so an older client gets a
   * `requiresOtp` envelope it can act on instead of a 404. It no longer creates
   * anything — leaving a route that mints unverified accounts would make the
   * verification requirement optional for anyone who kept using this URL.
   */
  app.post<{ Body: CredentialsBody; Querystring: RegisterQuery }>(
    '/api/auth/register',
    handleRegisterRequestCode
  );

  /**
   * POST /api/auth/register/confirm
   *
   * Registration step two: the code proves the address, and the User and Wallet
   * are written together in one transaction. An account without a wallet cannot
   * bet or deposit and would fail confusingly later, so neither exists unless
   * both do.
   */
  app.post<{
    Body: { email?: unknown; code?: unknown };
    Querystring: RegisterQuery;
  }>('/api/auth/register/confirm', async (req, reply) => {
    const email =
      typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.replace(/\D/g, '') : '';

    if (!EMAIL_RE.test(email) || code.length !== OTP_POLICY.digits) {
      return reply.code(400).send({
        error: 'invalid_code_format',
        message: `Enter the ${OTP_POLICY.digits}-digit code from your email.`,
      });
    }

    if (throttled(req, 'register-confirm', email)) {
      return reply.code(429).send({
        error: 'too_many_requests',
        message: 'Too many attempts. Please wait a few minutes and try again.',
      });
    }

    let outcome;
    try {
      // REGISTER only: a login code for this address must not be spendable as
      // a sign-up, and vice versa.
      outcome = await verifyOtp(email, code, 'REGISTER');
    } catch (err) {
      if (err instanceof OtpTooManyAttemptsError) {
        return reply.code(429).send({
          error: 'too_many_requests',
          message: 'Too many incorrect codes. Request a new one in a few minutes.',
        });
      }
      throw err;
    }

    if (!outcome.ok) {
      recordAccountFailure('register-confirm', email);
      req.log.warn({ email, reason: outcome.reason, ip: req.ip }, 'registration code rejected');
      return reply.code(401).send({
        error: 'invalid_code',
        message: 'That code is not valid or has expired. Request a new one.',
      });
    }

    // The hash was minted at step one and travelled on the code row. Its
    // absence means the intent was written by something other than
    // request-code, which is not a state to guess at.
    if (!outcome.passwordHash) {
      req.log.error({ email }, 'registration intent verified without a password hash');
      return reply.code(409).send({
        error: 'registration_expired',
        message: 'That registration has expired. Please start again.',
      });
    }

    const referredById = await resolveReferrer(req, req.query?.ref);

    let user;
    try {
      user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            passwordHash: outcome.passwordHash as string,
            // Never honour a client-supplied role — privilege is granted by an
            // admin, not claimed at sign-up.
            role: Role.USER,
            referredById,
          },
        });

        await tx.wallet.create({ data: { userId: created.id, currency: 'USD' } });
        return created;
      });
    } catch (err) {
      // P2002 = unique constraint. Two are reachable here: email, and the
      // generated referralCode. Only the first is the caller's fault — a cuid
      // collision is ours, and must not be reported as "email taken".
      //
      // The email case is now a race rather than a mistake: step one checked,
      // so losing here means the address was claimed in the intervening
      // minutes. The code is already spent, so there is nothing to clean up.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = err.meta?.target;
        const fields = Array.isArray(target) ? target : [String(target ?? '')];
        if (fields.some((f) => String(f).includes('email'))) {
          return reply.code(409).send({
            error: 'email_taken',
            message: 'An account with that email already exists.',
          });
        }
      }
      throw err;
    }

    clearThrottle(req, 'register', email);
    clearThrottle(req, 'register-confirm', email);
    req.log.info({ userId: user.id, referredById }, 'account registered after email verification');

    return reply.code(201).send({
      token: signToken(user.id, user.role, user.tokenVersion),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        referralCode: user.referralCode,
        referredBy: referredById,
      },
    });
  });

  /**
   * POST /api/auth/login
   *
   * Step one of two. The password is verified here, but no session is issued:
   * a correct password now earns an emailed code and nothing else, and the JWT
   * is minted by /api/auth/otp/verify once that code comes back.
   *
   * Note what this does and does not buy. It stops a leaked or guessed password
   * from being enough on its own — but /api/auth/otp/send remains an
   * unauthenticated way to reach the same account with only the address, so
   * possession of the inbox is the real credential on both paths. As a second
   * factor over password-only sign-in it holds; as a claim that every session
   * needs two factors it does not, while passwordless sign-in stays enabled.
   */
  app.post<{ Body: CredentialsBody }>('/api/auth/login', async (req, reply) => {
    // Parsed first so the account axis has an email to key on — but nothing is
    // looked up until the limits below have passed.
    const credentials = parseCredentials(req.body);

    if (throttled(req, 'login', credentials?.email)) {
      req.log.warn({ ip: req.ip, email: credentials?.email }, 'sign-in throttled');
      return reply.code(429).send({
        error: 'too_many_requests',
        message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
      });
    }

    if (await turnstileRejected(req, reply, 'login')) return reply;
    const invalid = (reason: string, detail?: Record<string, unknown>) => {
      // Count the miss against the account, so a distributed guess at one
      // account trips the lockout even from fresh addresses.
      if (credentials) recordAccountFailure('login', credentials.email);
      req.log.warn({ reason, ip: req.ip, ...detail }, 'sign-in rejected');
      return reply.code(401).send({
        error: 'invalid_credentials',
        message: 'That email and password combination was not recognised.',
      });
    };

    if (!credentials) {
      return invalid('malformed_credentials');
    }

    const user = await prisma.user.findUnique({
      where: { email: credentials.email },
      select: {
        id: true,
        email: true,
        role: true,
        passwordHash: true,
        tokenVersion: true,
        // Only the bypass path returns a profile, but the columns are selected
        // unconditionally: branching the query on the account's role would let
        // response timing hint at which addresses are admins.
        frozen: true,
        createdAt: true,
        wallets: { select: { balance: true, currency: true } },
      },
    });

    const hash = user?.passwordHash ?? (await DUMMY_HASH_PROMISE);
    // An unreadable stored hash is a failed sign-in, not a 500: argon2 throws
    // on a malformed digest, and letting that escape would tell an attacker
    // which accounts have corrupt hashes.
    const ok = await argon2.verify(hash, credentials.password).catch((err: unknown) => {
      req.log.error(
        { err, email: credentials.email, userId: user?.id },
        'argon2 verify threw — stored hash is unreadable'
      );
      return false;
    });

    if (!user) return invalid('unknown_email', { email: credentials.email });
    if (!ok) return invalid('wrong_password', { email: credentials.email, userId: user.id });

    // The password was right, so the IP/account lockout for *this* factor is
    // cleared. The code step keeps its own budget under the 'otp-verify' scope.
    clearThrottle(req, 'login', credentials.email);

    // ── Admin bypass ──
    //
    // Admins and any designated address sign in on the password alone: no code
    // row, no email, a token straight back.
    //
    // Note what this costs. These are the accounts that can reach the admin
    // routes, so a password that leaks is now sufficient on its own for the
    // highest-privilege access in the system — the inverse of the usual rule,
    // where an admin is the account you protect *hardest*. Every use is logged
    // at warn level so the bypass leaves an audit trail rather than looking
    // like an ordinary sign-in.
    if (bypassesOtp(user.role, user.email)) {
      const balance =
        user.wallets.find((w) => w.currency === 'USD')?.balance.toString() ?? '0';

      req.log.warn(
        { userId: user.id, role: user.role, ip: req.ip },
        'sign-in completed WITHOUT the email second factor (admin/designated bypass)'
      );

      return reply.send({
        requiresOtp: false,
        token: signToken(user.id, user.role, user.tokenVersion),
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          balance,
          frozen: user.frozen,
          createdAt: user.createdAt,
        },
      });
    }

    const delivery = await deliverCode(req, credentials.email, {
      purpose: 'LOGIN',
      subject: (code) => `${code} is your FRIGAT sign-in code`,
      body: (code) =>
        [
          `Your FRIGAT sign-in code is ${code}.`,
          ``,
          `It expires in ${Math.floor(OTP_POLICY.ttlMs / 60000)} minutes and can be used once.`,
          `If you did not just sign in, someone may know your password — change it,`,
          `and do not share this code with anyone.`,
        ].join('\n'),
    });

    if (!delivery.ok) return reply.code(delivery.status).send(delivery.body);

    req.log.info({ userId: user.id, role: user.role }, 'password accepted — code sent');

    // No token, and no profile: nothing about the account is returned until the
    // second factor lands. The email is echoed back only so the client can
    // address the code step without trusting its own input field.
    return reply.send(delivery.body);
  });

  // ── Email one-time codes ─────────────────────────────
  //
  // A second way in, for players who never set a password. The two paths issue
  // the same JWT, so everything downstream — the socket, the cookie exchange,
  // requireAdmin — is unchanged.

  /**
   * POST /api/auth/otp/send — REMOVED.
   *
   * This minted a LOGIN code for any address the caller named, and
   * /api/auth/otp/verify exchanged that code for a session. Together they were
   * a complete sign-in that never asked for a password: anyone who could read
   * a player's inbox held their account, and the password protected nothing.
   *
   * Sign-in now starts at /api/auth/login, which verifies the password *first*
   * and only then issues a LOGIN code. Because that is the sole remaining
   * issuer, a LOGIN code can no longer exist without a correct password having
   * been presented, which is what makes /verify below safe to keep.
   */

  /**
   * POST /api/auth/otp/verify
   *
   * On success the account is created if it did not exist, so an emailed code
   * is both sign-in and sign-up. Every rejection returns the same generic
   * message: distinguishing "no code" from "wrong code" tells a guesser whether
   * an address currently has one outstanding.
   */
  app.post<{ Body: { email?: unknown; code?: unknown }; Querystring: RegisterQuery }>(
    '/api/auth/otp/verify',
    async (req, reply) => {
      const email =
        typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const code =
        typeof req.body?.code === 'string' ? req.body.code.replace(/\D/g, '') : '';

      if (!EMAIL_RE.test(email) || code.length !== OTP_POLICY.digits) {
        return reply.code(400).send({
          error: 'invalid_code_format',
          message: `Enter the ${OTP_POLICY.digits}-digit code from your email.`,
        });
      }

      if (throttled(req, 'otp-verify', email)) {
        return reply.code(429).send({
          error: 'too_many_requests',
          message: 'Too many attempts. Please wait a few minutes and try again.',
        });
      }

      let outcome;
      try {
        // LOGIN only. This endpoint creates an account for an unknown address,
        // so honouring a REGISTER code here would let a pending sign-up be
        // spent as a passwordless sign-in — creating the account without the
        // password its owner chose.
        outcome = await verifyOtp(email, code, 'LOGIN');
      } catch (err) {
        if (err instanceof OtpTooManyAttemptsError) {
          return reply.code(429).send({
            error: 'too_many_requests',
            message: 'Too many incorrect codes. Request a new one in a few minutes.',
          });
        }
        throw err;
      }

      if (!outcome.ok) {
        recordAccountFailure('otp-verify', email);
        req.log.warn({ email, reason: outcome.reason, ip: req.ip }, 'otp rejected');
        return reply.code(401).send({
          error: 'invalid_code',
          message: 'That code is not valid or has expired. Request a new one.',
        });
      }

      // No ?ref handling here any more: referral attribution only ever
      // applied to the account this endpoint used to create, and it creates
      // none. Sign-up carries its own ref through /api/auth/register.

      // Look up only. This endpoint used to create the account when the
      // address was unknown, which made an emailed code a complete sign-UP
      // with no password ever chosen. Registration has its own two-step flow
      // that sets one; a code alone must never mint an account.
      //
      // In practice a LOGIN code now only exists after /api/auth/login checked
      // a password, so the account is always present — a miss here means a
      // stale code, and it answers like any other invalid code.
      const account = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          role: true,
          frozen: true,
          createdAt: true,
          tokenVersion: true,
        },
      });

      if (!account) {
        req.log.warn({ email, ip: req.ip }, 'otp verify for an address with no account');
        return reply.code(401).send({
          error: 'invalid_code',
          message: 'That code is not valid or has expired. Request a new one.',
        });
      }

      clearThrottle(req, 'otp-verify', email);
      req.log.info({ userId: account.id }, 'sign-in via email code');

      return reply.code(200).send({
        token: signToken(account.id, account.role, account.tokenVersion),
        user: {
          id: account.id,
          email: account.email,
          role: account.role,
          frozen: account.frozen,
          createdAt: account.createdAt,
        },
      });
    }
  );

  // ── Password reset ───────────────────────────────────
  //
  // Two steps, both keyed on a PASSWORD_RESET code. The purpose is what keeps
  // the flow sealed: a sign-in code cannot be spent to set a new password, and
  // a reset code cannot be spent to open a session.

  /**
   * POST /api/auth/forgot-password/request
   *
   * Answers identically whether or not the address has an account. "Which of
   * these addresses are your customers" is not a question an unauthenticated
   * caller gets to ask, and a reset form is the classic place to ask it.
   *
   * A code is minted even for an address with no account, and only the *email*
   * is conditional. That is deliberate: `issueOtp` enforces the 60s cooldown,
   * so skipping it for unknown addresses would make the cooldown itself the
   * oracle — repeat the request twice and a 429 means "this one is real".
   */
  app.post<{ Body: CredentialsBody }>(
    '/api/auth/forgot-password/request',
    async (req, reply) => {
      const email =
        typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

      if (!EMAIL_RE.test(email) || email.length > 254) {
        return reply.code(400).send({
          error: 'invalid_email',
          message: 'Enter a valid email address.',
        });
      }

      if (throttled(req, 'forgot-password')) {
        return reply.code(429).send({
          error: 'too_many_requests',
          message: 'Too many reset requests. Please wait a few minutes.',
        });
      }

      // Guarded like every other endpoint that mails an address of the
      // caller's choosing. Bypasses in development.
      if (await turnstileRejected(req, reply, 'forgot-password')) return reply;

      // The one response this endpoint ever gives on success.
      const accepted = {
        success: true,
        message: 'If an account exists with this email, a reset code has been sent.',
        expiresInSeconds: Math.floor(OTP_POLICY.resetTtlMs / 1000),
        resendAfterSeconds: Math.floor(OTP_POLICY.resendCooldownMs / 1000),
      };

      let issued;
      try {
        issued = await issueOtp(email, {
          purpose: 'PASSWORD_RESET',
          ttlMs: OTP_POLICY.resetTtlMs,
        });
      } catch (err) {
        if (err instanceof OtpCooldownError) {
          return reply.code(429).send({
            error: 'otp_cooldown',
            message: `Please wait ${err.retryAfterSeconds}s before requesting another code.`,
            retryAfterSeconds: err.retryAfterSeconds,
          });
        }
        throw err;
      }

      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });

      // Nothing to reset: the code stays on the table (holding the cooldown, so
      // timing matches) but no mail goes out. Telling a stranger "there is no
      // account here" is the disclosure this endpoint exists to avoid.
      if (!user) {
        req.log.info({ email }, 'password reset requested for unknown address');
        return reply.send(accepted);
      }

      try {
        const result = await sendMail(
          {
            to: email,
            subject: 'Password Reset Code - FRIGAT',
            text: [
              `Your FRIGAT password reset code is ${issued.code}.`,
              ``,
              `It expires in ${Math.floor(OTP_POLICY.resetTtlMs / 60000)} minutes and can be used once.`,
              ``,
              `If you did not ask to reset your password, ignore this email — your`,
              `password has not changed, and nobody can change it without this code.`,
            ].join('\n'),
          },
          req.log
        );

        req.log.info(
          { userId: user.id, delivered: result.delivered },
          'password reset code sent'
        );

        // Development only, exactly as the other code paths: with no SMTP host
        // there is no inbox to read.
        if (!result.delivered && config.env !== 'production') {
          return reply.send({ ...accepted, devCode: issued.code, delivered: false });
        }

        return reply.send(accepted);
      } catch (err) {
        // Retire the code so the player is not held in the cooldown waiting for
        // an email that is not coming.
        await discardOtp(email).catch((cleanupErr) => {
          req.log.error({ err: cleanupErr, email }, 'failed to retire undelivered otp');
        });

        if (err instanceof MailerNotConfiguredError) {
          req.log.error('password reset requested but SMTP is not configured in production');
        } else {
          req.log.error({ err, email }, 'password reset email delivery failed');
        }

        return reply.code(503).send({
          error: 'email_unavailable',
          message: 'We could not send your code right now. Please try again shortly.',
        });
      }
    }
  );

  /**
   * POST /api/auth/forgot-password/reset
   *
   * Spends the code and sets the new password. No session is issued: the player
   * signs in with the password they just chose, which proves it works and keeps
   * this endpoint from being a second way to mint a token.
   */
  app.post<{
    Body: { email?: unknown; code?: unknown; newPassword?: unknown };
  }>('/api/auth/forgot-password/reset', async (req, reply) => {
    const email =
      typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.replace(/\D/g, '') : '';
    const newPassword =
      typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!EMAIL_RE.test(email) || code.length !== OTP_POLICY.digits) {
      return reply.code(400).send({
        error: 'invalid_code_format',
        message: `Enter the ${OTP_POLICY.digits}-digit code from your email.`,
      });
    }

    // Complexity is checked before the code is spent. Failing afterwards would
    // burn the code on a rejected password and force a fresh email for a
    // mistake the player can fix in the field in front of them.
    const weaknesses = passwordProblems(newPassword);
    if (weaknesses.length > 0) {
      return reply.code(400).send({
        error: 'weak_password',
        message: `Password must contain: ${weaknesses.map((w) => w.message.toLowerCase()).join(', ')}.`,
        requirements: weaknesses.map((w) => w.code),
      });
    }

    if (throttled(req, 'forgot-password-reset', email)) {
      return reply.code(429).send({
        error: 'too_many_requests',
        message: 'Too many attempts. Please wait a few minutes and try again.',
      });
    }

    let outcome;
    try {
      outcome = await verifyOtp(email, code, 'PASSWORD_RESET');
    } catch (err) {
      if (err instanceof OtpTooManyAttemptsError) {
        return reply.code(429).send({
          error: 'too_many_requests',
          message: 'Too many incorrect codes. Request a new one in a few minutes.',
        });
      }
      throw err;
    }

    if (!outcome.ok) {
      recordAccountFailure('forgot-password-reset', email);
      req.log.warn({ email, reason: outcome.reason, ip: req.ip }, 'reset code rejected');
      return reply.code(401).send({
        error: 'invalid_code',
        message: 'That code is not valid or has expired. Request a new one.',
      });
    }

    // `verifyOtp` has already marked the code used, so it cannot be replayed
    // even if the update below fails.
    const passwordHash = await hashPassword(newPassword);

    // The version bump is the point of the reset. Someone who knew the old
    // password — or stole a live token — keeps that token working until this
    // increments, which would make a reset a formality rather than a recovery.
    const updated = await prisma.user.updateMany({
      where: { email },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });

    if (updated.count === 0) {
      // A code existed for an address with no account — the enumeration-proof
      // branch of the request step. Answer as though nothing was wrong.
      req.log.warn({ email }, 'reset code verified for an address with no account');
      return reply.code(401).send({
        error: 'invalid_code',
        message: 'That code is not valid or has expired. Request a new one.',
      });
    }

    clearThrottle(req, 'forgot-password', email);
    clearThrottle(req, 'forgot-password-reset', email);
    req.log.info({ email }, 'password reset completed');

    return reply.send({
      success: true,
      message: 'Password reset successfully. You can now sign in.',
    });
  });
}
