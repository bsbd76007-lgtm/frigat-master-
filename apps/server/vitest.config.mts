import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./src/__tests__/globalSetup.ts'],
    // Only sources. dist/ holds compiled copies of these same files; running
    // both doubles every test and the compiled ones fail outright, since
    // vitest cannot be imported from plain CJS output.
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    // One fork: the integration tests share a single database and several
    // deliberately race requests against each other. Parallel files hitting
    // the same rows would make a failure mean "two tests collided" rather
    // than "the invariant broke".
    pool: 'forks',
    maxForks: 1,
    minForks: 1,
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
