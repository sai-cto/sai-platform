/** Seeds the local dev database with businesses, fake users and fake demo data:  npm run db:seed */
import { loadEnv } from './lib/env';

async function main() {
  loadEnv();
  const { isLocalDatabaseUrl } = await import('../src/core/demo/pilot');
  // Fake users and fake live data must never reach a hosted (real) database.
  if (!isLocalDatabaseUrl(process.env.DATABASE_OWNER_URL) || !isLocalDatabaseUrl(process.env.DATABASE_URL))
    throw new Error('Refusing to seed a database that is not on this machine. db:seed is for local development only.');
  const { seedAll } = await import('../src/seed/run');
  const { closeDb } = await import('../src/core/db/client');
  const { SEED_BUSINESSES } = await import('../src/seed/businesses');
  await seedAll({ demoData: true });
  await closeDb();
  console.log(
    `  Seeded ${SEED_BUSINESSES.length} businesses, test users for every role, and fake demo data (live + sandbox).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
