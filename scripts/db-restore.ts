/**
 * Restores the local dev database from a backup:  npm run db:restore -- backups/<file>.dump --yes
 * The current database is backed up first (backups/sai-before-restore-<date>.dump), then replaced
 * in one transaction. Stop `npm run dev` first. Afterwards, `npm run db:migrate` brings an older
 * backup up to this code's schema.
 */
import path from 'node:path';
import { loadEnv, requireEnv } from './lib/env';
import { backupDatabase, restoreDatabase } from './lib/backup';

async function main() {
  loadEnv();
  const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!file) throw new Error('Name the backup to restore: npm run db:restore -- backups/<file>.dump --yes');
  if (!process.argv.includes('--yes'))
    throw new Error(`This REPLACES everything in the local database with ${file}. The current data is backed up first. Re-run with --yes to go ahead.`);
  const ownerUrl = requireEnv('DATABASE_OWNER_URL');
  const safety = await backupDatabase(ownerUrl, { label: 'before-restore' });
  console.log(`Current database backed up to ${safety}.`);
  await restoreDatabase(ownerUrl, path.resolve(file));
  console.log(`Restored ${file}. If it is older than this code, run: npm run db:migrate`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
