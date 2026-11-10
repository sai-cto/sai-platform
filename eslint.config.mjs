import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Architecture rules (docs/ARCHITECTURE.md). These keep tenant isolation and the
// activity log from being bypassed by accident.
const DB_CLIENT = {
  group: ['@/core/db/client', '**/core/db/client', 'postgres', 'drizzle-orm/postgres-js*'],
  message:
    'Only src/core may open a database connection. Use withScope()/withPlatformScope() and the record functions in @/core/records.',
};
const SYSTEM_ACTOR = {
  group: ['@/core/tenancy/system', '**/core/tenancy/system'],
  message: 'The system actor is for seed scripts and tests only.',
};
const RAW_TX = {
  name: '@/core/db/scope',
  importNames: ['txOf'],
  message:
    'txOf() gives raw write access and skips the activity log. Use the record functions in @/core/records.',
};

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
    // Routes, UI and modules: no direct database access, no system actor, no raw transaction.
    files: ['src/app/**', 'src/ui/**', 'src/modules/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [DB_CLIENT, SYSTEM_ACTOR], paths: [RAW_TX] }],
    },
  },
  {
    // Modules must not reach into routes.
    files: ['src/modules/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            DB_CLIENT,
            SYSTEM_ACTOR,
            { group: ['@/app/**'], message: 'Modules must not import from src/app.' },
          ],
          paths: [RAW_TX],
        },
      ],
    },
  },
  {
    // The core never imports a module — only the registry list.
    files: ['src/core/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*', '!@/modules/registry'],
              message: 'The core may only import @/modules/registry, never a module.',
            },
            {
              group: ['@/app/**', 'next/*', 'next'],
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
