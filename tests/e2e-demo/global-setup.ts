/** A fresh TEST database, then the demo preparation (accounts) exactly as a deploy runs it. */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { loadEnv, requireEnv } from '../../scripts/lib/env';
import { DEMO_TEST_ENV } from './demo-env';

export default async function globalSetup() {
  loadEnv();
  const cwd = path.resolve(__dirname, '..', '..');
  execSync('npx tsx scripts/reset-test-db.ts', { cwd, stdio: 'inherit' });
  execSync('npx tsx scripts/demo-prepare.ts', {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...DEMO_TEST_ENV,
      DATABASE_URL: requireEnv('TEST_DATABASE_URL'),
      DATABASE_OWNER_URL: requireEnv('TEST_DATABASE_OWNER_URL'),
    },
  });
}
