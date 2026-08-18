import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../index';
import { prisma } from '../config/prisma';

describe('integration harness', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('serves /api/health against the scratch database', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('points at a throwaway database, never the developer one', () => {
    expect(process.env.DATABASE_URL).toMatch(/frigat_test_[0-9a-f]{12}/);
  });

  it('can read and write through Prisma', async () => {
    // Deliberately not "the database is empty": test files share one scratch
    // database, so that assertion passed only when this file ran first and
    // failed the moment another suite seeded a row. It tested ordering, not
    // behaviour.
    const before = await prisma.user.count();
    const created = await prisma.user.create({
      data: { email: `smoke-${Date.now()}@test.local`, passwordHash: 'x' },
      select: { id: true },
    });
    expect(await prisma.user.count()).toBe(before + 1);
    await prisma.user.delete({ where: { id: created.id } });
    expect(await prisma.user.count()).toBe(before);
  });
});
