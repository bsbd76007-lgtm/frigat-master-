/**
 * FRIGAT — Database Seed
 * Creates a default ADMIN user and a test USER with a 1000-unit wallet.
 * Idempotent: safe to re-run (upserts on email).
 *
 * The admin is fixed at admin@frigat.local / 12345678 so the documented
 * credentials always work; the test user can be overridden via env:
 *   SEED_USER_EMAIL, SEED_USER_PASSWORD
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

async function main() {
  const adminEmail = 'admin@frigat.local';
  const adminPassword = '12345678';
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
  console.log(`   Admin password: ${adminPassword}`);
  if (!process.env.SEED_USER_PASSWORD) {
    console.log(`   Generated user password:  ${userPassword}`);
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
