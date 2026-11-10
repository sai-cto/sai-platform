/** Runs in every test file: point the app at the TEST database, as the restricted app role. */
import { afterAll } from 'vitest';
import { loadEnv, requireEnv } from '../../scripts/lib/env';

loadEnv();
process.env.DATABASE_URL = requireEnv('TEST_DATABASE_URL');
process.env.AUTH_DEV_LOGIN = 'true';
process.env.PAYMENT_PROVIDER = 'mock';
process.env.FILE_STORAGE_DIR = './storage/test';

afterAll(async () => {
  const { closeDb } = await import('../../src/core/db/client');
  await closeDb();
});
