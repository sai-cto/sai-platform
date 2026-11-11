import { defineConfig, devices } from '@playwright/test';
import { loadEnv, requireEnv } from './scripts/lib/env';
import { DEMO_TEST_ENV } from './tests/e2e-demo/demo-env';

loadEnv();
const PORT = 3200;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

/**
 * The hosted demo, locally: a PRODUCTION build (`next build && next start`) in demo mode,
 * against the TEST database. Proves the access gate, demo accounts, banner and no dev login,
 * and runs one move start to finish.  npm run test:e2e:demo
 */
export default defineConfig({
  testDir: './tests/e2e-demo',
  globalSetup: './tests/e2e-demo/global-setup.ts',
  globalTeardown: './tests/e2e-demo/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 90_000,
  use: { baseURL: `http://localhost:${PORT}`, trace: 'off', launchOptions: { executablePath } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 600_000,
    env: {
      ...DEMO_TEST_ENV,
      DATABASE_URL: requireEnv('TEST_DATABASE_URL'),
      // Set on purpose: demo mode must ignore it.
      AUTH_DEV_LOGIN: 'true',
      PAYMENT_PROVIDER: 'mock',
      FILE_STORAGE_DIR: './storage/e2e-demo',
      APP_URL: `http://localhost:${PORT}`,
      LINK_SIGNING_SECRET: process.env.LINK_SIGNING_SECRET ?? '',
      CRON_SECRET: 'demo-test-cron-secret',
      NEXT_TELEMETRY_DISABLED: '1',
      NODE_OPTIONS: '--max-old-space-size=6144',
    },
  },
});
