/** Wipes the local dev database, re-runs migrations and re-seeds:  npm run db:reset */
import { execSync } from 'node:child_process';
import { ROOT, loadEnv, requireEnv } from './lib/env';
import { dropEverything, migrateDatabase } from './lib/db';
import { backupDatabase, holdsImportedData } from './lib/backup';

async function main() {
  loadEnv();
  const ownerUrl = requireEnv('DATABASE_OWNER_URL');
  // Real Movegistics data is never wiped without a copy: back it up first.
  if (await holdsImportedData(ownerUrl)) {
    const file = await backupDatabase(ownerUrl, { label: 'before-reset' });
    console.log(`The database holds imported Movegistics data: backed up to ${file} first (npm run db:restore -- ${file} --yes to get it back).`);
  }
  await dropEverything(ownerUrl);
  await migrateDatabase(ownerUrl);
  execSync('npx tsx scripts/seed.ts', { cwd: ROOT, stdio: 'inherit' });
  console.log('Local dev database reset.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
