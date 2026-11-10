/**
 * Wipes the TEST database (sai_test), re-runs every migration and seeds businesses, users
 * and fake demo data. Run automatically before the integration and end-to-end tests.
 * The dev database is never touched.
 */
import { loadEnv, requireEnv } from './lib/env';
import { dropEverything, migrateDatabase } from './lib/db';

export async function resetTestDatabase(): Promise<void> {
  loadEnv();
  const ownerUrl = requireEnv('TEST_DATABASE_OWNER_URL');
  if (!new URL(ownerUrl).pathname.endsWith('/sai_test'))
    throw new Error('TEST_DATABASE_OWNER_URL must point at sai_test.');
  await dropEverything(ownerUrl);
  await migrateDatabase(ownerUrl);
  process.env.DATABASE_URL = requireEnv('TEST_DATABASE_URL');
  const { seedAll } = await import('../src/seed/run');
  const { closeDb } = await import('../src/core/db/client');
  await seedAll({ demoData: true });
  await closeDb();
}

if (require.main === module) {
  resetTestDatabase().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
