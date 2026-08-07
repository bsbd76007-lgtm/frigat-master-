/**
 * FRIGAT — Prisma Client Singleton
 * Prevents connection-pool exhaustion from hot-reload in dev.
 */

import { PrismaClient } from '@prisma/client';
// Imported for its side effect: loads .env before the client reads DATABASE_URL.
import { config } from './index';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: config.databaseUrl } },
    log: config.env === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
