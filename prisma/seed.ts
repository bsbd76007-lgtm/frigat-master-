/**
 * FRIGAT — Database Seed
 * Creates a default ADMIN user and a test USER with a 1000-unit wallet.
 * Idempotent: safe to re-run (upserts on email).
 *
 * ── Admin credentials ───────────────────────────────────────────────────────
 * The admin password is no longer a literal in this file. It resolves, in
 * order:
 *
 *   1. SEED_ADMIN_PASSWORD — whatever you supply.
 *   2. SEED_ALLOW_WEAK=true — the old documented '12345678'. Refused outright
 *      when NODE_ENV=production.
 *   3. Otherwise — a random 24-byte password, printed once and never stored.
 *
 * The default had to change because this seed is idempotent and rewrites the
 * admin hash on *every* run. Anyone who ran it against a live database — to
 * add a game type, to reset a wallet — silently reset the administrator of
 * that deployment to a password published in the repo.
 *
 * Other overrides: SEED_ADMIN_EMAIL, SEED_USER_EMAIL, SEED_USER_PASSWORD.
 */

import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'crypto';

const prisma = new PrismaClient();

const ARGON2_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
};

function generateServerSeed(): string {
  return randomBytes(32).toString('hex');
}

function hashServerSeed(seed: string): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex');
}

/** The documented development password, used only when explicitly allowed. */
const WEAK_ADMIN_PASSWORD = '12345678';

/**
 * Resolves the admin password without ever defaulting to a known value.
 *
 * The source is returned rather than a bare "was it generated" flag: three
 * origins need three different things said about them, and collapsing them to
 * a boolean made the weak path report itself as operator-supplied.
 */
type PasswordSource = 'supplied' | 'weak' | 'generated';

function resolveAdminPassword(): { value: string; source: PasswordSource } {
  const supplied = process.env.SEED_ADMIN_PASSWORD?.trim();
  if (supplied) return { value: supplied, source: 'supplied' };

  if (process.env.SEED_ALLOW_WEAK === 'true') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'SEED_ALLOW_WEAK=true is refused when NODE_ENV=production. Set SEED_ADMIN_PASSWORD ' +
          'to a real secret, or unset SEED_ALLOW_WEAK to have one generated.'
      );
    }
    return { value: WEAK_ADMIN_PASSWORD, source: 'weak' };
  }

  // base64url so the value can be pasted into a form or a URL without escaping.
  return { value: randomBytes(24).toString('base64url'), source: 'generated' };
}

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@frigat.local';
  const { value: adminPassword, source: adminPasswordSource } = resolveAdminPassword();
  const userEmail = process.env.SEED_USER_EMAIL ?? 'tester@frigat.local';
  const userPassword =
    process.env.SEED_USER_PASSWORD ?? randomBytes(16).toString('hex');

  // ── Admin ────────────────────────────────
  // The hash is rewritten on every run, not just on create: an admin row left
  // over from an earlier seed carries an old hash, and `update: {}` would keep
  // it — the account exists but the documented password never signs in.
  const adminHash = await argon2.hash(adminPassword, ARGON2_OPTS);
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash: adminHash,
      role: Role.ADMIN,
    },
    create: {
      email: adminEmail,
      passwordHash: adminHash,
      role: Role.ADMIN,
    },
  });

  // ── Test user + wallet ───────────────────
  const user = await prisma.user.upsert({
    where: { email: userEmail },
    update: {},
    create: {
      email: userEmail,
      passwordHash: await argon2.hash(userPassword, ARGON2_OPTS),
      role: Role.USER,
    },
  });

  await prisma.wallet.upsert({
    where: { userId_currency: { userId: user.id, currency: 'USD' } },
    update: {},
    create: {
      userId: user.id,
      currency: 'USD',
      balance: 1000,
    },
  });

  // ── Active provably-fair seed pair for test user ──
  const existingSeed = await prisma.provableSeed.findFirst({
    where: { userId: user.id, active: true },
  });

  if (!existingSeed) {
    const serverSeed = generateServerSeed();
    await prisma.provableSeed.create({
      data: {
        userId: user.id,
        serverSeed,
        hashedServerSeed: hashServerSeed(serverSeed),
        clientSeed: randomBytes(8).toString('hex'),
        nonce: 0,
        active: true,
      },
    });
  }

  console.log('✅ Seed complete');
  console.log(`   Admin: ${admin.email}`);
  console.log(`   User:  ${user.email} (wallet: 1000 USD)`);

  // A supplied password is already in the operator's hands, and echoing it
  // only copies a live secret into shell history and CI logs. Printed only
  // when this run is the sole place it exists.
  if (adminPasswordSource === 'generated') {
    console.log('');
    console.log(`   Admin password (generated, shown once): ${adminPassword}`);
    console.log('   Store it now — it is not recoverable from the database.');
  } else if (adminPasswordSource === 'weak') {
    console.log(`   Admin password: ${WEAK_ADMIN_PASSWORD} (SEED_ALLOW_WEAK — development only)`);
  } else {
    console.log('   Admin password: supplied via SEED_ADMIN_PASSWORD (not shown)');
  }
  if (!process.env.SEED_USER_PASSWORD) {
    console.log(`   Generated user password: ${userPassword}`);
  }
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
