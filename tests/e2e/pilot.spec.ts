/**
 * The HHMC pilot, as a manager meets it: lands in the app, finds anything with search, prints,
 * sends feedback (which only the tech team reads), and the phone layout never scrolls sideways.
 */
import { expect, test } from '@playwright/test';
import { SEED, loginAs } from './helpers';

const TEST_APP = '/console/hhmc/sandbox/app';

test('a manager lands on the HHMC dashboard with no platform tabs', async ({ page }) => {
  await loginAs(page, SEED.hhmcAdmin);
  await expect(page).toHaveURL(/\/console\/hhmc\/live\/app$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(page.locator('a[data-business-tab]')).toHaveCount(1);
  for (const hidden of ['Overview', 'Module settings', 'Module health']) {
    await expect(page.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
  }
  // HHMC's admins run HHMC from inside the app (managers' feedback round 1): Data and Activity
  // log are app sections, and Settings holds Business settings and People and access.
  const sections = page.getByRole('navigation', { name: 'App sections' });
  for (const shown of ['Data', 'Activity log', 'Settings']) await expect(sections.getByRole('link', { name: shown, exact: true })).toBeVisible();
  await sections.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Settings areas' }).getByRole('link', { name: 'People and access' }).click();
  await expect(page).toHaveURL(/\/console\/hhmc\/people$/);
  await expect(page.getByRole('navigation', { name: 'App sections' }).getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.goto('/console/hhmc');
  await expect(page.getByTestId('how-to-test-banner')).toBeVisible();
  await expect(page).toHaveTitle(/^Dashboard · /);
});

test('search finds a test-mode customer by name and opens it', async ({ page }) => {
  await loginAs(page, SEED.hhmcAdmin);
  await page.goto(`${TEST_APP}/contacts`);
  const name = (await page.locator('tbody tr a').first().innerText()).trim();
  await page.getByRole('navigation', { name: 'App sections' }).getByRole('button', { name: /Search/ }).click();
  const box = page.getByPlaceholder(/Search/);
  await box.fill(name.split(' ')[0]);
  const hit = page.getByRole('option', { name: new RegExp(name) }).first();
  await expect(hit).toBeVisible({ timeout: 10_000 });
  await hit.click();
  await expect(page).toHaveURL(/\/app\/contacts\/[0-9a-f-]{36}$/);
});

test('an invoice has a printable page', async ({ page }) => {
  await loginAs(page, SEED.hhmcAdmin);
  await page.goto(`${TEST_APP}/invoices?status=all`);
  await page.locator('tbody tr a[href*="/invoices/"]').first().click();
  await page.getByRole('link', { name: /Print/ }).click();
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}\/print$/);
  await expect(page.getByRole('heading', { level: 1, name: /Invoice/ })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByTestId('feedback-button')).toBeHidden();
  await expect(page.getByTestId('breadcrumbs')).toBeHidden();
});

test('feedback from a manager reaches the tech team, not other managers', async ({ page }) => {
  const message = `The calendar colours are hard to tell apart ${Date.now()}`;
  await loginAs(page, SEED.hhmcAdmin);
  await page.goto(`${TEST_APP}/schedule`);
  await page.getByTestId('feedback-button').click();
  await page.getByLabel('Your feedback').fill(message);
  await page.getByRole('dialog').getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('dialog').getByText(/Thank you|Sent/)).toBeVisible();
  expect((await page.request.get('/console/platform/feedback', { maxRedirects: 0 })).status()).toBe(404);

  await loginAs(page, SEED.tech);
  await page.goto('/console/platform/feedback');
  const item = page.getByTestId('feedback-list').locator('li', { hasText: message });
  await expect(item).toBeVisible();
  await expect(item.getByRole('link', { name: '/console/hhmc/sandbox/app/schedule' })).toBeVisible();
  await expect(item.getByText('Test mode')).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test('the calendar, a job and search fit the screen', async ({ page }) => {
    await loginAs(page, SEED.hhmcAdmin);
    const noSideways = async () =>
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.goto(`${TEST_APP}/schedule`);
    await noSideways();
    await page.goto(`${TEST_APP}/jobs`);
    await page.locator('a[href*="/app/jobs/"]').filter({ hasNotText: 'New' }).first().click();
    await expect(page).toHaveURL(/\/app\/jobs\/[0-9a-f-]{36}$/);
    await noSideways();
    const menu = page.getByRole('button', { name: 'Open menu' });
    expect((await menu.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('banner').getByRole('button', { name: 'Open search' }).click();
    await expect(page.getByPlaceholder(/Search/)).toBeVisible();
    await noSideways();
  });
});

test('an unknown page is a friendly 404', async ({ page }) => {
  await loginAs(page, SEED.hhmcAdmin);
  const response = await page.goto(`${TEST_APP}/nothing-here`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
