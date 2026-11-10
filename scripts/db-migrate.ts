/** Applies pending migrations to the dev and test databases:  npm run db:migrate */
import { loadEnv, requireEnv } from './lib/env';
import { migrateDatabase } from './lib/db';

async function main() {
  loadEnv();
  await migrateDatabase(requireEnv('DATABASE_OWNER_URL'));
  await migrateDatabase(requireEnv('TEST_DATABASE_OWNER_URL'));
  console.log('Migrations applied to dev and test databases.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
