/**
 * FRIGAT — Email one-time login codes
 *
 * A 6-digit code has a keyspace of one million. That is only safe when three
 * things hold at once, so all three are enforced here rather than left to the
 * caller:
 *
 *   1. Codes expire quickly (5 minutes).
 *   2. Each code is single-use, and issuing a new one retires the old.
 *   3. Guesses are capped per code AND per email, so the keyspace cannot be
 *      walked from one address or from many.
 *
 * Take any one away and the other two stop mattering: unlimited guesses beat a
 * short expiry, and an unlimited number of live codes beats single use.
 *
 * The digits are never persisted. `codeHash` is HMAC-SHA256 keyed with the
 * server secret — see the note on the OtpCode model for why a fast keyed hash
 * is the right primitive here and argon2 is not.
 */

import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { Prisma, Role } from '@prisma/client';

import { config } from '../config';
import { prisma } from '../config/prisma';

export const OTP_POLICY = {
  digits: 6,
  ttlMs: 5 * 60 * 1000,
  /** Lifetime of a password-reset code — see `IssueOtpOptions.ttlMs`. */
  resetTtlMs: 10 * 60 * 1000,
  /** Minimum gap between sends to one address. */
  resendCooldownMs: 60 * 1000,
  /** Wrong guesses allowed against a single code before it is burned. */
  maxAttemptsPerCode: 5,
  /** Wrong guesses allowed against one address per window, across codes. */
  maxAttemptsPerEmail: 15,
  attemptWindowMs: 15 * 60 * 1000,
} as const;

export class OtpCooldownError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('A code was already sent recently');
    this.name = 'OtpCooldownError';
  }
}

export class OtpTooManyAttemptsError extends Error {
  constructor() {
    super('Too many incorrect codes');
    this.name = 'OtpTooManyAttemptsError';
  }
}

function hashCode(email: string, code: string): string {
  // The email is bound into the digest so a code minted for one address cannot
  // be replayed against another, even if two happen to share digits.
  return createHmac('sha256', config.jwtSecret)
    .update(`otp:${email}:${code}`)
    .digest('hex');
}

function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Cryptographically uniform digits — Math.random is not acceptable here. */
function generateCode(): string {
  let code = '';
  for (let i = 0; i < OTP_POLICY.digits; i += 1) code += randomInt(0, 10).toString();
  return code;
}

export interface IssuedOtp {
  code: string;
  expiresAt: Date;
}

/**
 * What a code entitles its bearer to do.
 *
 * `LOGIN` opens a session on an account that already exists — both the
 * passwordless path and the second factor after a correct password. `REGISTER`
 * carries a pending account, and only `/api/auth/register/confirm` accepts it.
 *
 * Verification matches on this, so the two cannot be traded for each other: a
 * REGISTER code is minted for an address with no account by anyone who knows
 * the address, and if that verified at the login endpoint it would be an open
 * door rather than a second factor.
 */
export type OtpPurpose = 'LOGIN' | 'REGISTER' | 'PASSWORD_RESET';

export interface IssueOtpOptions {
  purpose?: OtpPurpose;
  /**
   * argon2id digest of the password chosen at registration step one. Held on
   * the code row until the confirm step writes the User. REGISTER only.
   */
  passwordHash?: string | null;
  /**
   * Lifetime override. Defaults to `OTP_POLICY.ttlMs`.
   *
   * A password reset gets longer than a sign-in code: the player has to leave
   * the tab, find the mail, come back and *also* choose a new password, and a
   * five-minute window turns that into a retry loop.
   */
  ttlMs?: number;
}

/**
 * Issues a code for `email`, retiring any still-live one.
 *
 * Retiring the previous code is what keeps "single use" true in practice: a
 * player who taps resend three times must end up with one working code, not
 * three, or the effective keyspace shrinks with every tap.
 *
 * Retirement deliberately ignores `purpose`: one address gets one live code,
 * whatever it is for. Letting a login code and a registration code coexist
 * would double the number of values in play against the same inbox for no gain
 * — and the cooldown below is per address for the same reason.
 */
export async function issueOtp(
  email: string,
  options: IssueOtpOptions = {}
): Promise<IssuedOtp> {
  const { purpose = 'LOGIN', passwordHash = null, ttlMs = OTP_POLICY.ttlMs } = options;
  const now = new Date();

  const latest = await prisma.otpCode.findFirst({
    where: { email },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  if (latest) {
    const elapsed = now.getTime() - latest.createdAt.getTime();
    if (elapsed < OTP_POLICY.resendCooldownMs) {
      throw new OtpCooldownError(
        Math.ceil((OTP_POLICY.resendCooldownMs - elapsed) / 1000)
      );
    }
  }

  const code = generateCode();
  const expiresAt = new Date(now.getTime() + ttlMs);

  await prisma.$transaction([
    prisma.otpCode.updateMany({
      where: { email, used: false },
      data: { used: true },
    }),
    prisma.otpCode.create({
      data: {
        email,
        codeHash: hashCode(email, code),
        expiresAt,
        purpose,
        passwordHash: purpose === 'REGISTER' ? passwordHash : null,
      },
    }),
  ]);

  return { code, expiresAt };
}

/**
 * Retires every live code for an address.
 *
 * Used when a code was minted but could not be delivered: the row exists, the
 * cooldown is ticking, and nobody can read the digits. Clearing it makes an
 * immediate retry possible instead of a minute of waiting for nothing.
 */
export async function discardOtp(email: string): Promise<void> {
  await prisma.otpCode.deleteMany({ where: { email, used: false } });
}

export type OtpFailure = 'no_code' | 'expired' | 'incorrect' | 'exhausted';

export type OtpVerification =
  | { ok: true; purpose: OtpPurpose; passwordHash: string | null }
  | { ok: false; reason: OtpFailure; attemptsLeft?: number };

/**
 * Checks a submitted code and consumes it on success.
 *
 * `purpose` is part of the match, not a post-hoc check: a code minted for one
 * purpose is simply "no code" at an endpoint expecting the other, and the wrong
 * guess is burned exactly like any other. Callers must pass the purpose they
 * are prepared to honour rather than inspecting the result and deciding after.
 *
 * Every failure path burns something — an attempt, or the code itself — so a
 * caller cannot learn anything by retrying, and there is no branch that leaves
 * a live code behind after a wrong guess.
 */
export async function verifyOtp(
  email: string,
  code: string,
  purpose: OtpPurpose = 'LOGIN'
): Promise<OtpVerification> {
  // Per-address ceiling first: it spans codes, so requesting a fresh one does
  // not reset an attacker's budget.
  const recentFailures = await prisma.otpCode.aggregate({
    where: {
      email,
      createdAt: { gte: new Date(Date.now() - OTP_POLICY.attemptWindowMs) },
    },
    _sum: { attempts: true },
  });
  if ((recentFailures._sum.attempts ?? 0) >= OTP_POLICY.maxAttemptsPerEmail) {
    throw new OtpTooManyAttemptsError();
  }

  const record = await prisma.otpCode.findFirst({
    where: { email, used: false, purpose },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      codeHash: true,
      expiresAt: true,
      attempts: true,
      passwordHash: true,
    },
  });

  if (!record) return { ok: false, reason: 'no_code' };

  if (record.expiresAt.getTime() <= Date.now()) {
    await prisma.otpCode.update({ where: { id: record.id }, data: { used: true } });
    return { ok: false, reason: 'expired' };
  }

  if (record.attempts >= OTP_POLICY.maxAttemptsPerCode) {
    await prisma.otpCode.update({ where: { id: record.id }, data: { used: true } });
    return { ok: false, reason: 'exhausted' };
  }

  if (!digestsMatch(record.codeHash, hashCode(email, code))) {
    const updated = await prisma.otpCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    const attemptsLeft = Math.max(0, OTP_POLICY.maxAttemptsPerCode - updated.attempts);
    // Burn the code once its budget is gone, rather than leaving a dead row
    // that still answers "incorrect" forever.
    if (attemptsLeft === 0) {
      await prisma.otpCode.update({ where: { id: record.id }, data: { used: true } });
    }
    return { ok: false, reason: 'incorrect', attemptsLeft };
  }

  // Consume it. `used: false` in the predicate makes this the point of no
  // return: two requests racing with the same correct code, only one wins.
  const consumed = await prisma.otpCode.updateMany({
    where: { id: record.id, used: false },
    data: { used: true },
  });
  if (consumed.count !== 1) return { ok: false, reason: 'no_code' };

  return { ok: true, purpose, passwordHash: record.passwordHash };
}

export interface OtpAccount {
  id: string;
  email: string;
  role: Role;
  createdAt: Date;
  frozen: boolean;
  created: boolean;
}

/**
 * Returns the account for a verified email, creating one on first sign-in.
 *
 * A code-only account still gets a `passwordHash` column value, because the
 * schema requires one. It is a sentinel that no password can produce — argon2
 * verification against it always fails — so "no password set" cannot be
 * mistaken for "any password works". The wallet is created in the same
 * transaction as the user, matching /api/auth/register: an account without one
 * cannot bet or deposit, and would fail confusingly later.
 */
export async function findOrCreateOtpUser(
  email: string,
  referredById: string | null = null
): Promise<OtpAccount> {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, createdAt: true, frozen: true },
  });
  if (existing) return { ...existing, created: false };

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        // Not a hash of anything: argon2.verify rejects a malformed digest, so
        // this account can only ever be entered with an emailed code.
        passwordHash: 'otp-only-account:no-password-set',
        role: Role.USER,
        referredById,
      },
      select: { id: true, email: true, role: true, createdAt: true, frozen: true },
    });

    await tx.wallet.create({ data: { userId: user.id, currency: 'USD' } });
    return user;
  });

  return { ...created, created: true };
}

/**
 * Drops expired and spent codes.
 *
 * Not required for correctness — every read filters on `used` and `expiresAt` —
 * but a login table that only grows is a table that eventually gets slow, and
 * spent codes are not worth keeping.
 */
export async function purgeExpiredOtps(olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const { count } = await prisma.otpCode.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: cutoff } }, { used: true, createdAt: { lt: cutoff } }],
    },
  });
  return count;
}

export type { Prisma };
