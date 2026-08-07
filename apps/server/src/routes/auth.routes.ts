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

import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { Prisma, Role } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../config/prisma';

const ARGON2_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
};

/**
 * Verified against when the email is unknown, so a miss costs the same as a
 * wrong password. Without it, response time alone enumerates registered users.
 */
const DUMMY_HASH_PROMISE = argon2.hash('frigat-nonexistent-account', ARGON2_OPTS);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200; // argon2 is happy to hash megabytes; don't let it

interface CredentialsBody {
  email?: unknown;
  password?: unknown;
}

/** `?ref=<referralCode>` — the recruiting affiliate's code. */
interface RegisterQuery {
  ref?: unknown;
}

/** Referral codes are cuids; anything else can't match and isn't worth a query. */
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

function signToken(userId: string, role: Role): string {
  return jwt.sign({ userId, role }, config.jwtSecret, {
    algorithm: 'HS256',
    // Cast: the value is env-supplied, so its `"12h"`-style literal type can
    // only be checked at runtime — jwt.sign throws on anything unparseable.
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
    subject: userId,
  });
}

// ─────────────────────────────────────────────
// Throttling
//
// In-process and therefore per-instance — enough to make online guessing
// expensive, not a substitute for a shared limiter once this runs on more than
// one node. Keyed by IP so one client cannot spray many accounts either.
// ─────────────────────────────────────────────

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 20;
const attempts = new Map<string, { count: number; resetAt: number }>();

function throttled(req: FastifyRequest, scope: string): boolean {
  const key = `${scope}:${req.ip}`;
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now >= entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    // Opportunistic sweep: the map only grows while requests keep arriving.
    if (attempts.size > 10_000) {
      for (const [k, v] of attempts) if (now >= v.resetAt) attempts.delete(k);
    }
    return false;
  }

  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

/** A successful sign-in shouldn't count against the window. */
function clearThrottle(req: FastifyRequest, scope: string) {
  attempts.delete(`${scope}:${req.ip}`);
}

// ─────────────────────────────────────────────

export function registerAuthRoutes(app: FastifyInstance) {
  /**
   * POST /api/auth/register
   * Creates the user, their USD wallet, and returns a signed session token.
   */
  app.post<{ Body: CredentialsBody; Querystring: RegisterQuery }>(
    '/api/auth/register',
    async (req, reply) => {
    if (throttled(req, 'register')) {
      return reply.code(429).send({ error: 'too_many_requests' });
    }

    const credentials = parseCredentials(req.body);
    if (!credentials) {
      return reply.code(400).send({
        error: 'invalid_credentials_format',
        message: `A valid email and a password of at least ${MIN_PASSWORD} characters are required.`,
      });
    }

    // Referral attribution. An unknown, malformed or expired code is ignored
    // rather than rejected: a stale affiliate link is the referrer's problem,
    // and refusing the sign-up would cost a real registration over it.
    const ref = typeof req.query?.ref === 'string' ? req.query.ref.trim() : '';
    let referredById: string | null = null;
    if (ref && REFERRAL_CODE_RE.test(ref)) {
      const referrer = await prisma.user.findUnique({
        where: { referralCode: ref },
        select: { id: true },
      });
      referredById = referrer?.id ?? null;
      if (!referrer) req.log.info({ ref }, 'unknown referral code ignored');
    }

    const passwordHash = await argon2.hash(credentials.password, ARGON2_OPTS);

    let user;
    try {
      // One transaction: an account without a wallet cannot bet, so a half-
      // finished registration would look like a working account and fail later.
      user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: credentials.email,
            passwordHash,
            // Never honour a client-supplied role — privilege is granted by an
            // admin, not claimed at sign-up.
            role: Role.USER,
            referredById,
          },
        });

        await tx.wallet.create({
          data: { userId: created.id, currency: 'USD' },
        });

        return created;
      });
    } catch (err) {
      // P2002 = unique constraint. Two are reachable here: email, and the
      // generated referralCode. Only the first is the caller's fault — a cuid
      // collision is ours, and must not be reported as "email taken".
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

    clearThrottle(req, 'register');
    req.log.info({ userId: user.id, referredById }, 'account registered');

    return reply.code(201).send({
      token: signToken(user.id, user.role),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        // The new account's own code, so the UI can show a share link
        // immediately without a second round trip.
        referralCode: user.referralCode,
        referredBy: referredById,
      },
    });
    }
  );

  /**
   * POST /api/auth/login
   * Verifies credentials and returns a signed session token plus the profile.
   */
  app.post<{ Body: CredentialsBody }>('/api/auth/login', async (req, reply) => {
    if (throttled(req, 'login')) {
      return reply.code(429).send({ error: 'too_many_requests' });
    }

    const credentials = parseCredentials(req.body);
    // A malformed body gets the same answer as a wrong password: "which field
    // was wrong" is information an attacker can use and a user already knows.
    // The *reason* still goes to the log, where only operators can read it.
    const invalid = (reason: string, detail?: Record<string, unknown>) => {
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
        frozen: true,
        createdAt: true,
        wallets: { select: { balance: true, currency: true } },
      },
    });

    const hash = user?.passwordHash ?? (await DUMMY_HASH_PROMISE);
    let ok = false;
    try {
      ok = await argon2.verify(hash, credentials.password);
    } catch (err) {
      // A malformed stored hash must fail closed, not throw a 500 that tells
      // the caller this account exists — but an operator needs to see it, or a
      // corrupted hash looks indistinguishable from a user typo forever.
      req.log.error(
        { err, email: credentials.email, userId: user?.id },
        'argon2 verify threw — stored hash is unreadable'
      );
      ok = false;
    }

    if (!user) return invalid('unknown_email', { email: credentials.email });
    if (!ok) return invalid('wrong_password', { email: credentials.email, userId: user.id });

    clearThrottle(req, 'login');

    // The wagerable USD balance, as a string — Decimal(18,8) does not survive a
    // JSON number. Falls back to '0' for an account whose wallet is missing.
    const balance =
      user.wallets.find((w) => w.currency === 'USD')?.balance.toString() ?? '0';

    req.log.info({ userId: user.id, role: user.role }, 'sign-in succeeded');

    // Frozen accounts still sign in: they need to reach the site to see why.
    // The freeze is enforced where it matters — ledger.service.processBet.
    return reply.send({
      token: signToken(user.id, user.role),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        balance,
        frozen: user.frozen,
        createdAt: user.createdAt,
      },
    });
  });
}
