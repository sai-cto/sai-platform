import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Architecture rules (docs/ARCHITECTURE.md). These keep tenant isolation and the activity
// log from being bypassed by accident. They are regular expressions so that both the alias
// form ("@/core/…") and the relative form ("../../core/…", which editors auto-import) match.

const DB_CLIENT = {
  regex: '(^@/|/)core/db/(\\./)?client(\\.[cm]?[jt]sx?)?$|^postgres$|^drizzle-orm/postgres-js',
  message:
    'Only src/core may open a database connection. Use withScope()/withPlatformScope() and the record functions in @/core/records.',
};
const SYSTEM_ACTOR = {
  regex: '(^@/|/)core/tenancy/system(\\.[cm]?[jt]sx?)?$',
  message: 'The system actor is for seed scripts and tests only.',
};
const RAW_TX = {
  regex: '(^@/|/)core/db/scope(\\.[cm]?[jt]sx?)?$',
  importNames: ['txOf'],
  message:
    'txOf() gives raw write access and skips the activity log. Use the record functions in @/core/records.',
};
// Platform tables (users, memberships, sessions…) have no row-level security, so nothing
// outside the core may query them directly. Core tenant tables come from @/core/db/schema/tenant.
const PLATFORM_TABLES = {
  regex: '(^@/|/)core/db/schema(/index|/platform)?(\\.[cm]?[jt]sx?)?$',
  message:
    'Import core tables from @/core/db/schema/tenant. Platform tables (users, memberships, sessions…) are only reachable through core services.',
};
const NO_ROUTES = { regex: '(^@/|/)app/', message: 'Modules must not import from src/app.' };

// The rules above only see static imports. Outside the core, nothing may load the database
// layer or the system actor dynamically either (import('…') or require('…')).
const GUARDED = '/core\\/(db|tenancy\\/system)|^postgres$|^drizzle-orm\\/postgres-js/';
const NO_DYNAMIC_LOADS = [
  {
    selector: `ImportExpression[source.value=${GUARDED}]`,
    message: 'Do not load the database layer dynamically. Use the core services.',
  },
  {
    selector: `CallExpression[callee.name="require"][arguments.0.value=${GUARDED}]`,
    message: 'Do not require() the database layer. Use the core services.',
  },
  // A dynamic import whose target is worked out at run time cannot be checked at all.
  {
    selector: 'ImportExpression[source.type!="Literal"]',
    message: 'Dynamic imports must use a plain string, so the architecture rules can check them.',
  },
];
// Path tricks that would make an import look different from what it is ("a/../b", "a/./b", "a/").
const NO_PATH_TRICKS = {
  regex: '^@/.*(/\\.\\.?/|//|/$)|[^./]/\\.\\.?/',
  message: 'Write the import path plainly (no "/./", "/../" in the middle, "//" or trailing "/").',
};

const OUTSIDE_CORE = [DB_CLIENT, SYSTEM_ACTOR, RAW_TX, PLATFORM_TABLES, NO_PATH_TRICKS];

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
    // Everything under src/ that is not the core, the seed data or a module (routes, UI and
    // any folder added later) is covered by default.
    files: ['src/**'],
    ignores: ['src/core/**', 'src/seed/**', 'src/modules/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: OUTSIDE_CORE }],
      'no-restricted-syntax': ['error', ...NO_DYNAMIC_LOADS],
    },
  },
  {
    // Modules: the same, and they must not reach into routes either.
    files: ['src/modules/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...OUTSIDE_CORE, NO_ROUTES] }],
      'no-restricted-syntax': ['error', ...NO_DYNAMIC_LOADS],
    },
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
              // The last part catches a folder import ("../modules/brss"). The names listed are the
              // files of src/core/modules itself; add a new one there and it must be added here.
              regex:
                '(^@/|/)modules/[^/]+/|^@/modules/(?!registry$)|/modules/(?!contract$|registry$|config$|portal$|report$)[^/]+$',
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
