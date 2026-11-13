/**
 * Backs up the local dev database:  npm run db:backup
 * Writes backups/sai-<date>.dump (git-ignored; real customer data once Movegistics is imported).
 * Restore with:  npm run db:restore -- backups/<file>.dump --yes
 */
import fs from 'node:fs';
import { loadEnv, requireEnv } from './lib/env';
import { backupDatabase } from './lib/backup';

async function main() {
  loadEnv();
  const file = await backupDatabase(requireEnv('DATABASE_OWNER_URL'));
  console.log(`Backup written: ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB). Keep it on this machine: it holds customer data.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
