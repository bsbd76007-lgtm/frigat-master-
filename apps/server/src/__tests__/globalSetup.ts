import { createScratchDb, type ScratchDb } from './helpers/db';

/**
 * Runs once, before any test worker starts.
 *
 * The Prisma singleton reads DATABASE_URL at import time, so the scratch
 * database has to exist and be exported into the environment before a single
 * test module is loaded — which is exactly what globalSetup guarantees and a
 * per-file beforeAll does not.
 */
let db: ScratchDb | undefined;

export async function setup() {
  db = createScratchDb();
  process.env.DATABASE_URL = db.url;
  // Keeps the API in its development shape (verbose errors, dev bypasses) so
  // tests exercise the same branches a developer hits locally.
  process.env.NODE_ENV = 'development';
}

export async function teardown() {
  db?.drop();
}
