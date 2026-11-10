/** Runs once before the end-to-end tests: a fresh, seeded TEST database. */
import { execSync } from 'node:child_process';
import path from 'node:path';

export default async function globalSetup() {
  execSync('npx tsx scripts/reset-test-db.ts', {
    cwd: path.resolve(__dirname, '..', '..'),
    stdio: 'inherit',
  });
}
