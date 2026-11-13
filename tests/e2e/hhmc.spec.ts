/**
 * Hired Hands, end to end in a real browser: a lead becomes a job, the quote reproduces ref
 * §4.2 Example A, the customer signs and pays the deposit from their link (no account), staff
 * book, invoice from actual hours, and the customer pays the balance from the invoice link.
 */
import { expect, test, type Page } from '@playwright/test';
import { SEED, asOwner, loginAs } from './helpers';

const APP = '/console/hhmc/live/app';

async function confirm(page: Page, label: string) {
  await page.getByRole('alertdialog').getByRole('button', { name: label, exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
}

test('a move from lead to Closed, with the customer signing and paying from their links', async ({ page, browser }) => {
  const tag = Date.now().toString(36);
  await loginAs(page, SEED.hhmcAdmin);
  await page.goto(APP);
  await expect(page.getByRole('navigation', { name: 'App sections' }).getByRole('link')).toHaveText(['Dashboard', 'Leads', 'Estimates', 'Work Requests', 'Contacts', 'Calendar', 'Invoices', 'Settings', 'How to test']);

  // Lead.
  await page.goto(`${APP}/leads/new`);
  await page.getByLabel('First name').fill('Robin');
  await page.getByLabel('Last name').fill(`Browser${tag}`);
  await page.getByLabel('Email').fill(`robin.${tag}@example.com`);
  await page.getByLabel('Source', { exact: true }).selectOption('Cornellian');
  await page.getByLabel('Move date').fill(new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'Add lead' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Robin Browser${tag}`);
  await expect(page.getByText('No customer has this email or phone yet')).toBeVisible();

  // Convert → the Job page.
  await page.getByRole('button', { name: 'Convert to job' }).click();
  await expect(page).toHaveURL(/\/app\/jobs\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Qualified', { exact: true })).toBeVisible();

  // Quote: the default 16' truck is there; add 2 Men × 2.5 h. The total updates while typing.
  await page.getByLabel('Item', { exact: true }).selectOption({ label: '2 Men · $195.00/hour' });
  await page.getByLabel('Qty (hour)').fill('2.5');
  await expect(page.getByTestId('quote-total')).toHaveText('$682.50');
  await expect(page.getByTestId('quote-card-total')).toHaveText('$709.80');
  await page.getByRole('button', { name: 'Add line' }).click();
  await expect(page.getByText('Line added.')).toBeVisible();
  await expect(page.getByTestId('quote-card-total')).toHaveText('$709.80');
  await expect(page.getByText('$136.50 + $5.46 = $141.96')).toBeVisible();

  // Send the estimate, then copy the customer's link.
  await page.getByRole('button', { name: 'Send estimate' }).click();
  await confirm(page, 'Send estimate');
  await expect(page.getByText('Estimate Sent', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Copy link' }).click();
  const link = await page.getByLabel('Customer link').inputValue();
  expect(link).toMatch(/\/l\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const linkPath = new URL(link).pathname;

  // The customer, with no account.
  const customer = await (await browser.newContext()).newPage();
  await customer.goto(linkPath);
  await expect(customer.getByText('1. Summary')).toBeVisible();
  await expect(customer.getByText('$709.80').first()).toBeVisible();
  await customer.getByRole('link', { name: 'Next: full estimate' }).click();
  await expect(customer.getByRole('heading', { name: /Terms & Conditions/ })).toBeVisible();
  await customer.getByRole('link', { name: 'Next: sign' }).click();
  await customer.getByRole('button', { name: 'Sign estimate' }).click();
  await expect(customer.locator('p[role=alert]')).toContainText('Initial the Valuation');
  await customer.getByLabel('Your initials').fill('RB');
  await customer.getByLabel(/I have reviewed and initialed/).check();
  await customer.getByLabel('Type your full name to sign').fill(`Robin Browser${tag}`);
  await customer.getByRole('button', { name: 'Sign estimate' }).click();
  await expect(customer.getByRole('heading', { name: 'Estimate review completed' })).toBeVisible();
  await expect(customer.getByText('Total deposit required')).toBeVisible();
  // A declined card first, then the approved one.
  await customer.getByLabel('Card').selectOption('mock_declined');
  await customer.getByRole('button', { name: 'Pay deposit $141.96' }).click();
  await expect(customer.locator('p[role=alert]')).toContainText('declined');
  // Retry straight away, without reloading: a new attempt, not the declined one again.
  await customer.getByLabel('Card').selectOption('');
  await customer.getByRole('button', { name: 'Pay deposit $141.96' }).click();
  await expect(customer.getByText('✓ Deposit paid ($141.96)')).toBeVisible();
  // A tampered link is "not found".
  expect((await customer.request.get(`${linkPath}x`)).status()).toBe(404);

  // Staff: ready to book, but nothing booked itself.
  await page.reload();
  await expect(page.getByText('Ready to book')).toBeVisible();
  await expect(page.getByText('Deposit paid: $141.96')).toBeVisible();
  await page.getByRole('button', { name: 'Book this move' }).click();
  await confirm(page, 'Book');
  await expect(page.getByText('Booked', { exact: true }).first()).toBeVisible();
  const jobUrl = page.url();
  const jobNumber = (await page.getByRole('heading', { level: 1 }).innerText()).split(' ')[0];

  // It is on the schedule.
  const day = await asOwner(async (sql) => (await sql`select move_date::text as d from hhmc_jobs where job_number = ${jobNumber} and environment = 'live'`)[0].d as string);
  await page.goto(`${APP}/schedule?view=day&date=${day}`);
  await expect(page.getByRole('link', { name: jobNumber }).first()).toBeVisible();

  // After the move: 1 hour actually worked → invoice.
  await page.goto(jobUrl);
  await page.getByLabel(/Actual hours/).fill('1');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await page.getByRole('button', { name: 'Create invoice' }).click();
  await expect(page).toHaveURL(/\/app\/invoices\/[0-9a-f-]{36}$/);
  // 2 Men 1 h $195 + truck $195 = $390 − $136.50 deposit = $253.50; by card + 4% = $263.64.
  await expect(page.getByTestId('balance-due')).toHaveText('$253.50');
  await expect(page.getByTestId('balance-due-card')).toHaveText('$263.64');
  await page.getByRole('button', { name: 'Send invoice' }).click();
  await confirm(page, 'Send');
  await expect(page.getByText('Sent', { exact: true }).first()).toBeVisible();

  // The customer pays from the invoice email's link.
  const invoiceNumber = (await page.getByRole('heading', { level: 1 }).innerText()).replace('Invoice ', '');
  const body = await asOwner(async (sql) =>
    (await sql`select body from notifications where subject like ${`Invoice ${invoiceNumber}%`} and environment = 'live' order by created_at desc limit 1`)[0].body as string,
  );
  const invoicePath = new URL(body.match(/https?:\/\/\S+\/l\/\S+/)![0]).pathname;
  await customer.goto(invoicePath);
  await customer.getByRole('button', { name: 'Pay $263.64 by card' }).click();
  await expect(customer.getByText('Paid in full. Thank you!')).toBeVisible();

  await page.goto(jobUrl);
  await expect(page.getByText('Closed', { exact: true }).first()).toBeVisible();
});

test('staff see what they were granted: no Book button or invoice actions without the permission', async ({ page }) => {
  const jobId = await asOwner(async (sql) =>
    (await sql`select j.id from hhmc_jobs j join businesses b on b.id = j.business_id
               join hhmc_estimates e on e.job_id = j.id and e.status = 'signed'
               where b.slug = 'hhmc' and j.environment = 'live' and j.stage = 'estimate_sent' limit 1`)[0].id as string,
  );
  await loginAs(page, 'hhmc.staff@sai.example');
  await page.goto(`${APP}/jobs/${jobId}`);
  await expect(page.getByText('Ready to book')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Book this move' })).toHaveCount(0);
  const sections = page.getByRole('navigation', { name: 'App sections' });
  await expect(sections.getByRole('link', { name: 'Leads' })).toBeVisible();
  // Executives get no app at all; another business's admin gets "not found".
  await loginAs(page, SEED.executive);
  expect((await page.request.get(`${APP}/jobs/${jobId}`)).status()).toBe(404);
  await loginAs(page, SEED.brssAdmin);
  expect((await page.request.get(`${APP}/jobs/${jobId}`)).status()).toBe(404);
});

test('test mode has its own jobs; a live job is "not found" there', async ({ page }) => {
  const jobId = await asOwner(async (sql) =>
    (await sql`select j.id from hhmc_jobs j join businesses b on b.id = j.business_id where b.slug = 'hhmc' and j.environment = 'live' limit 1`)[0].id as string,
  );
  await loginAs(page, SEED.hhmcAdmin);
  await page.goto('/console/hhmc/sandbox/app/jobs');
  await expect(page.getByTestId('sandbox-banner')).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  expect((await page.request.get(`/console/hhmc/sandbox/app/jobs/${jobId}`)).status()).toBe(404);
});
