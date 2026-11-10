/**
 * PROVES at the route level: a business admin (or staff member) of one business gets
 * "not found" for every URL of every other business, for the Platform section and for the
 * executive view — pages and the CSV export alike. The same rules are proven at the data
 * layer in tests/integration/tenant-isolation.test.ts.
 */
import { expect, test } from '@playwright/test';
import { ALL_SLUGS, SEED, loginAs, someCustomerId } from './helpers';

/** Every kind of URL a business has. {id} is a real record id of that business. */
const BUSINESS_PATHS = [
  '',
  '/live/overview',
  '/sandbox/overview',
  '/live/app',
  '/sandbox/app',
  '/live/data',
  '/live/data/core.customer',
  '/sandbox/data',
  '/sandbox/data/core.customer',
  '/sandbox/data/core.customer/{id}',
  '/live/data/core.customer/{id}',
  '/live/data/core.customer/export',
  '/sandbox/data/core.customer/export',
  '/live/activity',
  '/sandbox/activity',
  '/people',
  '/settings',
  '/test-mode',
];

const PLATFORM_PATHS = [
  '/console/executive',
  '/console/platform/users',
  '/console/platform/modules',
  '/console/platform/flags',
  '/console/platform/activity',
  '/console/platform/imports',
  '/console/platform/imports/new',
  '/console/platform/health',
  '/console/platform/settings',
  '/console/platform/users/00000000-0000-4000-8000-000000000000',
  '/console/platform/imports/hhmc/00000000-0000-4000-8000-000000000000',
];

for (const [label, email, own] of [
  ['BRSS admin', SEED.brssAdmin, 'brss'],
  ['BRSS staff', SEED.brssStaff, 'brss'],
  ['HHMC admin', SEED.hhmcAdmin, 'hhmc'],
] as const) {
  test(`${label}: every URL of every other business is "not found"`, async ({ page }) => {
    await loginAs(page, email);
    for (const slug of ALL_SLUGS.filter((s) => s !== own)) {
      const id = await someCustomerId(slug);
      for (const template of BUSINESS_PATHS) {
        const path = `/console/${slug}${template.replace('{id}', id)}`;
        const response = await page.request.get(path, { maxRedirects: 0 });
        expect(response.status(), path).toBe(404);
        expect(await response.text(), path).not.toContain('example.com'); // no customer data leaked
      }
      for (const portal of ['portal', 'field']) {
        expect((await page.request.get(`/${portal}/${slug}`, { maxRedirects: 0 })).status()).toBe(404);
      }
    }
  });

  test(`${label}: the Platform section and executive view are "not found"`, async ({ page }) => {
    await loginAs(page, email);
    for (const path of PLATFORM_PATHS) {
      expect((await page.request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
    }
  });

  test(`${label}: another business's record id is "not found" inside their own business`, async ({ page }) => {
    await loginAs(page, email);
    const other = own === 'brss' ? 'hhmc' : 'brss';
    const foreignId = await someCustomerId(other);
    const response = await page.request.get(`/console/${own}/live/data/core.customer/${foreignId}`, { maxRedirects: 0 });
    // Staff without data access get 404 for the whole Data tab; admins get 404 for this record.
    expect(response.status()).toBe(404);
  });
}

test('BRSS admin CAN open their own business, so the 404s above are not a blanket failure', async ({ page }) => {
  await loginAs(page, SEED.brssAdmin);
  const id = await someCustomerId('brss');
  for (const path of ['/console/brss/live/overview', '/console/brss/sandbox/overview', '/console/brss/live/data/core.customer', `/console/brss/live/data/core.customer/${id}`, '/console/brss/people', '/console/brss/settings', '/console/brss/test-mode']) {
    expect((await page.request.get(path)).status(), path).toBe(200);
  }
  const csv = await page.request.get('/console/brss/live/data/core.customer/export');
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('First name');
  expect(csv.headers()['x-export-rows']).toMatch(/^\d+ of \d+$/);
  // The export is in the activity log.
  await page.goto('/console/brss/live/activity?action=export');
  await expect(page.getByText(/Exported \d+ customers to CSV/).first()).toBeVisible();
});

test('customer and field portals are "not found" even for a super admin until a module builds one', async ({ page }) => {
  await loginAs(page, SEED.superAdmin);
  for (const slug of ALL_SLUGS) {
    expect((await page.request.get(`/portal/${slug}`)).status()).toBe(404);
    expect((await page.request.get(`/field/${slug}`)).status()).toBe(404);
  }
});

test('executives cannot export, use test mode, or see people and settings', async ({ page }) => {
  await loginAs(page, SEED.executive);
  for (const path of ['/console/brss/live/data/core.customer/export', '/console/brss/sandbox/overview', '/console/brss/people', '/console/brss/settings', '/console/brss/test-mode', '/console/brss/live/app', '/console/platform/users']) {
    expect((await page.request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
  }
  expect((await page.request.get('/console/brss/live/data/core.customer')).status()).toBe(200);
  expect((await page.request.get('/console/executive')).status()).toBe(200);
});
