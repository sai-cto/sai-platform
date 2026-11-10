import { defineConfig } from 'drizzle-kit';
import { loadEnv } from './scripts/lib/env';

loadEnv();

// Tables live next to the code that owns them: the core's in src/core/db/schema,
// each module's in src/modules/<key>/schema.ts. Both are picked up automatically.
export default defineConfig({
  dialect: 'postgresql',
  // Module folders start with a lowercase letter; folders starting with "_" (the template,
  // shared helpers) are skipped.
  schema: ['./src/core/db/schema/*.ts', './src/modules/[a-z]*/schema.ts'],
  out: './db/migrations',
  dbCredentials: { url: process.env.DATABASE_OWNER_URL ?? '' },
});
