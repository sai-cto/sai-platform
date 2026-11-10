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
  // Only ever wipe a database whose name starts with sai_test.
  if (!/^\/sai_test[a-z0-9_]*$/.test(new URL(ownerUrl).pathname)) {
    throw new Error('TEST_DATABASE_OWNER_URL must point at a sai_test database.');
  }
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
