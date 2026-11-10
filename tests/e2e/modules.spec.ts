/** Phase 3: every business has a registered module with a clean "not built yet" staff portal. */
import { expect, test } from '@playwright/test';
import { SEED, asOwner, businessCount, loginAs } from './helpers';

test('every business shows its module in the App tab', async ({ page }) => {
  const businesses = await asOwner((sql) => sql<{ slug: string; name: string }[]>`select slug, name from businesses order by sort_order`);
  expect(businesses.length).toBeGreaterThan(0);
  await loginAs(page, SEED.superAdmin);
  for (const b of businesses) {
    await page.goto(`/console/${b.slug}/live/app`);
    await expect(page.getByRole('heading', { name: b.name, level: 1 })).toBeVisible();
    await expect(page.getByText('Planned scope')).toBeVisible();
    await expect(page.getByText('No app yet')).toHaveCount(0);
  }
});

test('Hired Hands and Real Estate show "pending requirements" and nothing else', async ({ page }) => {
  await loginAs(page, SEED.hhmcAdmin);
  await page.goto('/console/hhmc/live/app');
  await expect(page.getByText('Not built yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Pending requirements' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'App sections' })).toHaveCount(0);
  // Unknown paths inside the portal are "not found".
  expect((await page.request.get('/console/hhmc/live/app/moves')).status()).toBe(404);
  expect((await page.request.get('/console/hhmc/live/app/anything/else')).status()).toBe(404);

  await loginAs(page, 'sare.admin@sai.example');
  await page.goto('/console/sare/sandbox/app');
  await expect(page.getByTestId('sandbox-banner')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Pending requirements' })).toBeVisible();
});

test('the module registry and system health show every business as registered', async ({ page }) => {
  const count = await businessCount();
  await loginAs(page, SEED.tech);
  await page.goto('/console/platform/modules');
  await expect(page.getByText(`${count} modules registered`)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'Not registered' })).toHaveCount(0);
  await page.goto('/console/platform/health');
  await expect(page.getByText('Everything checked is working.')).toBeVisible();
  await expect(page.getByText(`${count} of ${count}`)).toBeVisible();
});

test('switching a staff portal off hides the app; switching it on brings it back', async ({ page }) => {
  await loginAs(page, SEED.tech);
  await page.goto('/console/brm/settings');
  const staffRow = page.getByRole('listitem').filter({ hasText: 'Staff portal' });
  await staffRow.getByRole('button', { name: 'Turn off' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Turn off' }).click();
  await expect(staffRow.getByText('Off', { exact: true })).toBeVisible();
  await page.goto('/console/brm/live/app');
  await expect(page.getByText('Staff portal is switched off')).toBeVisible();
  await page.goto('/console/brm/settings');
  await staffRow.getByRole('button', { name: 'Turn on' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Turn on' }).click();
  await expect(staffRow.getByText('On', { exact: true })).toBeVisible();
  // Customer and field portals are not built, so there is nothing to switch.
  await expect(page.getByRole('listitem').filter({ hasText: 'Customer portal' }).getByText('Not built')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Customer portal' }).getByRole('button')).toHaveCount(0);
});
