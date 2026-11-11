/**
 * The hosted test site, locally (production build, demo mode). What the managers will see.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { DEMO_TEST_ENV } from './demo-env';

const APP = '/console/hhmc/live/app';

async function passGate(page: Page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/access/);
  await page.getByLabel('Access password').fill(DEMO_TEST_ENV.DEMO_ACCESS_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).not.toHaveURL(/\/access/);
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/console/, { timeout: 30_000 });
}

async function confirm(page: Page, label: string) {
  await page.getByRole('alertdialog').getByRole('button', { name: label, exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
}

async function customerPage(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await passGate(page);
  return page;
}

test('everything is behind the access password; no dev login; the banner is on every page', async ({ page }) => {
  for (const path of ['/', '/login', '/console', `${APP}/jobs`, '/l/anything']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/access/);
  }
  // A server action posted without the gate cookie is refused.
  expect((await page.request.post('/login', { data: 'x' })).status()).toBe(401);
  // The scheduler's door needs its own secret.
  expect((await page.request.get('/api/cron/scheduled')).status()).toBe(404);

  await page.getByLabel('Access password').fill('not the password');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('p[role=alert]')).toContainText('not right');
  await page.getByLabel('Access password').fill(DEMO_TEST_ENV.DEMO_ACCESS_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).not.toHaveURL(/\/access/);

  await page.goto('/login');
  await expect(page.getByTestId('demo-banner')).toContainText('TEST SITE – not real data');
  await expect(page.getByText('Dev login')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Sign in to the test site' })).toBeVisible();
  await page.getByLabel('Email').fill('gm@demo.example');
  await page.getByLabel('Password').fill('wrong-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('p[role=alert]')).toContainText('Wrong email or password');
  // The fake console users of local development cannot sign in here.
  await page.getByLabel('Email').fill('cto@sai.example');
  await page.getByLabel('Password').fill('test-gm-password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('p[role=alert]')).toContainText('Wrong email or password');
});

test('a manager runs one move from lead to paid; the customer signs and pays through their links', async ({ page, browser }) => {
  const tag = Date.now().toString(36);
  await passGate(page);
  await signIn(page, 'gm@demo.example', 'test-gm-password-1');
  await page.goto(APP);
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.goto(`${APP}/leads/new`);
  await page.getByLabel('First name').fill('Demo');
  await page.getByLabel('Last name').fill(`Mover${tag}`);
  await page.getByLabel('Email').fill(`demo.${tag}@example.com`);
  await page.getByLabel('Move date').fill(new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'Add lead' }).click();
  await page.getByRole('button', { name: 'Convert to job' }).click();
  await expect(page).toHaveURL(/\/app\/jobs\/[0-9a-f-]{36}$/);
  await page.getByLabel('Item').selectOption({ label: '2 Men · $195.00/hour' });
  await page.getByLabel('Qty (hour)').fill('2');
  await page.getByRole('button', { name: 'Add line' }).click();
  await expect(page.getByText('Line added.')).toBeVisible();
  await page.getByRole('button', { name: 'Send estimate' }).click();
  await confirm(page, 'Send estimate');
  await page.getByRole('button', { name: 'Copy link' }).click();
  const estimateLink = new URL(await page.getByLabel('Customer link').inputValue()).pathname;

  const customer = await customerPage(browser);
  await customer.goto(`${estimateLink}?step=sign`);
  await customer.getByLabel('Your initials').fill('DM');
  await customer.getByLabel(/I have reviewed and initialed/).check();
  await customer.getByLabel('Type your full name to sign').fill(`Demo Mover${tag}`);
  await customer.getByRole('button', { name: 'Sign estimate' }).click();
  await expect(customer.getByRole('heading', { name: 'Estimate review completed' })).toBeVisible();
  await customer.getByRole('button', { name: /Pay deposit/ }).click();
  await expect(customer.getByText(/✓ Deposit paid/)).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Book this move' }).click();
  await confirm(page, 'Book');
  await expect(page.getByText('Booked', { exact: true }).first()).toBeVisible();
  const jobUrl = page.url();
  await page.getByLabel(/Actual hours/).fill('2');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await page.getByRole('button', { name: 'Create invoice' }).click();
  await expect(page).toHaveURL(/\/app\/invoices\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Send invoice' }).click();
  await confirm(page, 'Send');
  // The customer pays the balance from their payment link.
  await page.getByRole('button', { name: 'Copy payment link' }).click();
  const invoiceLink = new URL(await page.getByLabel('Customer link').inputValue()).pathname;
  await customer.goto(invoiceLink);
  await customer.getByRole('button', { name: /by card/ }).click();
  await expect(customer.getByText('Paid in full. Thank you!')).toBeVisible();
  await page.goto(jobUrl);
  await expect(page.getByText('Closed', { exact: true }).first()).toBeVisible();
});

test('staff can run a move but cannot manage people', async ({ page }) => {
  await passGate(page);
  await signIn(page, 'staff@demo.example', 'test-staff-password-1');
  await page.goto(`${APP}/jobs`);
  await expect(page.getByRole('heading', { name: 'Jobs', level: 1 })).toBeVisible();
  expect((await page.request.get('/console/hhmc/people')).status()).toBe(404);
});
