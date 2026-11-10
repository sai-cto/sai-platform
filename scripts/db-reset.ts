/** Wipes the local dev database, re-runs migrations and re-seeds:  npm run db:reset */
import { execSync } from 'node:child_process';
import { ROOT, loadEnv, requireEnv } from './lib/env';
import { dropEverything, migrateDatabase } from './lib/db';

async function main() {
  loadEnv();
  const ownerUrl = requireEnv('DATABASE_OWNER_URL');
  await dropEverything(ownerUrl);
  await migrateDatabase(ownerUrl);
  execSync('npx tsx scripts/seed.ts', { cwd: ROOT, stdio: 'inherit' });
  console.log('Local dev database reset.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
