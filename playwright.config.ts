import { defineConfig, devices } from '@playwright/test';
import { loadEnv, requireEnv } from './scripts/lib/env';

loadEnv();
const PORT = 3100;
// Optional: use an already-installed Chromium instead of the one `npx playwright install` downloads.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

/**
 * End-to-end tests run the real app (next dev) against the TEST database, which is wiped
 * and re-seeded first (tests/e2e/global-setup.ts). The dev database is never touched.
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  use: { baseURL: `http://localhost:${PORT}`, trace: 'off', launchOptions: { executablePath } },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: requireEnv('TEST_DATABASE_URL'),
      AUTH_DEV_LOGIN: 'true',
      PAYMENT_PROVIDER: 'mock',
      FILE_STORAGE_DIR: './storage/e2e',
      APP_URL: `http://localhost:${PORT}`,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
