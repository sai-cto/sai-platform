import { expect, test } from '@playwright/test';
import { ALL_CODES, SEED, loginAs } from './helpers';

test('signed-out visitors are sent to the login page', async ({ page }) => {
  for (const path of ['/console', '/', '/console/brss/live/overview', '/console/platform/users', '/console/executive']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
});

test('the health endpoint reports the database is up', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true, database: 'up' });
});

test('Microsoft and Google sign-in routes do not exist while unconfigured', async ({ request }) => {
  for (const provider of ['microsoft', 'google', 'nonsense']) {
    expect((await request.get(`/api/auth/${provider}/start`, { maxRedirects: 0 })).status()).toBe(404);
    expect((await request.get(`/api/auth/${provider}/callback?code=x&state=y`, { maxRedirects: 0 })).status()).toBe(404);
  }
});

const EXPECTED: [string, string, string[]][] = [
  ['super_admin', SEED.superAdmin, ALL_CODES],
  ['tech', SEED.tech, ALL_CODES],
  ['executive', SEED.executive, ALL_CODES],
  ['business_admin (BRSS)', SEED.brssAdmin, ['BRSS']],
  ['business_staff (BRSS)', SEED.brssStaff, ['BRSS']],
  ['two businesses', SEED.multi, ['TUT', 'CBB']],
];

for (const [label, email, codes] of EXPECTED) {
  test(`${label} sees exactly the businesses their role allows`, async ({ page }) => {
    await loginAs(page, email);
    const sidebar = page.getByTestId('nav-businesses').first();
    for (const code of ALL_CODES) {
      const item = sidebar.getByText(code, { exact: true });
      if (codes.includes(code)) await expect(item).toBeVisible();
      else await expect(item).toHaveCount(0);
    }
    await expect(page.getByTestId('home-businesses').getByRole('link')).toHaveCount(codes.length);
  });
}

test('signing out ends the session', async ({ page }) => {
  await loginAs(page, SEED.brssAdmin);
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/console');
  await expect(page).toHaveURL(/\/login/);
});

test('a forged session cookie is rejected', async ({ page, context }) => {
  await context.addCookies([{ name: 'sai_session', value: 'forged-token', url: 'http://localhost:3100' }]);
  await page.goto('/console');
  await expect(page).toHaveURL(/\/login/);
});
