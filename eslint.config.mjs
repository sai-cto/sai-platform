import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Architecture rules (docs/ARCHITECTURE.md). These keep tenant isolation and the activity
// log from being bypassed by accident. They are regular expressions so that both the alias
// form ("@/core/…") and the relative form ("../../core/…", which editors auto-import) match.

const DB_CLIENT = {
  regex: '(^@/|/)core/db/client$|^postgres$|^drizzle-orm/postgres-js',
  message:
    'Only src/core may open a database connection. Use withScope()/withPlatformScope() and the record functions in @/core/records.',
};
const SYSTEM_ACTOR = {
  regex: '(^@/|/)core/tenancy/system$',
  message: 'The system actor is for seed scripts and tests only.',
};
const RAW_TX = {
  regex: '(^@/|/)core/db/scope$',
  importNames: ['txOf'],
  message:
    'txOf() gives raw write access and skips the activity log. Use the record functions in @/core/records.',
};
// Platform tables (users, memberships, sessions…) have no row-level security, so nothing
// outside the core may query them directly. Core tenant tables come from @/core/db/schema/tenant.
const PLATFORM_TABLES = {
  regex: '(^@/|/)core/db/schema(/index|/platform)?$',
  message:
    'Import core tables from @/core/db/schema/tenant. Platform tables (users, memberships, sessions…) are only reachable through core services.',
};
const NO_ROUTES = { regex: '(^@/|/)app/', message: 'Modules must not import from src/app.' };

const OUTSIDE_CORE = [DB_CLIENT, SYSTEM_ACTOR, RAW_TX, PLATFORM_TABLES];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'storage/**',
    'playwright-report/**',
    'test-results/**',
  ]),
  {
    // Routes and UI: no direct database access, no system actor, no raw transaction.
    files: ['src/app/**', 'src/ui/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: OUTSIDE_CORE }] },
  },
  {
    // Modules: the same, and they must not reach into routes either.
    files: ['src/modules/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [...OUTSIDE_CORE, NO_ROUTES] }] },
  },
  {
    // The core never imports a module — only the registry list — and never depends on Next.js.
    files: ['src/core/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            // A module file is always inside a module's folder: "…/modules/<key>/<file>".
            // (src/core/modules/* has no sub-folders, so core's own imports do not match.)
            {
              regex: '(^@/|/)modules/[^/]+/|^@/modules/(?!registry$)',
              message: 'The core may only import @/modules/registry, never a module.',
            },
            {
              regex: '(^@/|/)app/|^next($|/)',
              message:
                'The core must not depend on Next.js or on routes; it is also used by scripts and tests.',
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
