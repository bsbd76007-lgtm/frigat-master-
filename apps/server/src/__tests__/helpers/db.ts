import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import path from 'path';
import { config as loadEnv } from 'dotenv';

/**
 * A disposable Postgres database per test file.
 *
 * These tests exist to catch what unit tests structurally cannot — transaction
 * boundaries, unique-constraint races, whether a rollback actually rolled back.
 * All of that needs a real server, so nothing here mocks Prisma.
 *
 * The database is created fresh and migrated with `migrate deploy`, so every
 * run also re-proves that the committed migrations build a schema the code can
 * actually talk to. Drift like the kind `sync_schema` fixed would fail here
 * instead of on a fresh production deploy.
 */
export interface ScratchDb {
  url: string;
  drop: () => void;
}

/** Vitest runs with cwd = apps/server; prisma commands need the repo root. */
const REPO_ROOT = path.resolve(process.cwd(), '../..');

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  execFileSync(cmd, args, {
    stdio: 'pipe',
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
  });
}

export function createScratchDb(): ScratchDb {
  const name = `frigat_test_${randomBytes(6).toString('hex')}`;

  // Vitest does not read .env, so without this DATABASE_URL is undefined here
  // and the scratch database is created for a role that may not exist. dotenv
  // never overwrites an already-set variable, so CI's own DATABASE_URL wins.
  loadEnv({ path: path.join(process.cwd(), '.env'), quiet: true });

  // Reuse the developer's own connection string, swapping only the database
  // name, so this needs no second set of credentials locally or in CI.
  const template = process.env.DATABASE_URL;
  if (!template) {
    throw new Error(
      'DATABASE_URL is not set and apps/server/.env did not supply one — integration tests need a reachable Postgres.'
    );
  }
  const url = new URL(template);
  url.pathname = `/${name}`;
  url.search = 'schema=public';

  // psql with an explicit connection URI rather than bare createdb/dropdb:
  // those fall back to local socket defaults, which exist on a developer
  // machine and do not on a CI runner talking to a service container.
  //
  // ?schema=public is a Prisma extension; libpq rejects it as an unknown URI
  // parameter, so the maintenance connection drops the query string.
  const admin = new URL(template);
  admin.search = '';

  const drop = () => {
    try {
      run('psql', [admin.toString(), '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS "${name}"`]);
    } catch {
      /* a leaked test database is noise, not a failure */
    }
  };

  run('psql', [admin.toString(), '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE "${name}"`]);
  try {
    run('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
      DATABASE_URL: url.toString(),
    });
  } catch (err) {
    // The database exists but is unusable. Without this the run aborts before
    // teardown is registered and the empty database is orphaned on the server
    // — which is exactly what happened the first time this helper ran.
    drop();
    throw err;
  }

  return {
    url: url.toString(),
    drop,
  };
}
