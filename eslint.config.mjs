// Flat config, not .eslintrc.json: eslintrc support was removed in ESLint 10,
// so the legacy format would have pinned this repo to ESLint 8, which is
// end-of-life — and Dependabot's first PR would then break linting outright.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    // Generated, vendored or machine-written. Linting these reports thousands
    // of findings nobody can act on, which is how a lint step gets ignored.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/*.tsbuildinfo',
      'graphify-out/**',
      'apps/web/next-env.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // The codebase deliberately discards errors in places where the failure
      // is genuinely nothing to act on — a private-mode sessionStorage write,
      // a closed AudioContext. Those are written as `catch { /* no-op */ }`
      // with a comment, so an empty block is allowed only when it says why.
      'no-empty': ['error', { allowEmptyCatch: true }],

      // Unused args are frequently part of a signature the framework dictates
      // (Fastify handlers, React event props). Leading underscore opts out.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // `any` is a smell, not a build break — flagged so it shows in review
      // without failing CI over code that already typechecks cleanly.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  {
    // The web app carries `eslint-disable-next-line react-hooks/exhaustive-deps`
    // comments in several hooks. Without the plugin registered those comments
    // reference an unknown rule, which ESLint reports as an error — the lint
    // would fail on the suppressions rather than on any real problem.
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    // Node scripts and config files run outside the browser.
    files: ['prisma/**/*.ts', '**/*.config.{js,mjs,cjs}', 'apps/server/**/*.ts'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', __dirname: 'readonly' },
    },
  }
);
