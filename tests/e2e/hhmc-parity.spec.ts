/**
 * Hired Hands office workflows added for the Movegistics switch, in a real browser: reschedule a
 * booked move, record a card payment taken in Shopify, cancel a move that had a deposit.
 * Uses the seeded fake moves (src/modules/hhmc/seed.ts).
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { SEED, asOwner, loginAs } from './helpers';

const APP = '/console/hhmc/live/app';

async function jobOf(jobNumber: string) {
  return asOwner(async (sql) => {
    const [job] = await sql`select j.id from hhmc_jobs j join businesses b on b.id = j.business_id where b.slug = 'hhmc' and j.environment = 'live' and j.job_number = ${jobNumber}`;
    const days = await sql`select day_date::text as d from hhmc_job_days where job_id = ${job.id} and archived_at is null order by day_date`;
    return { id: job.id as string, days: days.map((r) => r.d as string) };
  });
}

/** Opens a fold-out section; a click that lands before the page has started up is repeated. */
async function unfold(page: Page, summary: string, inside: Locator) {
  await expect(async () => {
    if (!(await inside.isVisible())) await page.locator('summary').filter({ hasText: summary }).first().click();
    await expect(inside).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

const plusDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

test('reschedule a booked move in one step', async ({ page }) => {
  const job = await jobOf('J-000009');
  const target = plusDays(job.days[0], 9);
  await loginAs(page, SEED.hhmcAdmin);
  await page.goto(`${APP}/jobs/${job.id}`);
  await unfold(page, 'Reschedule', page.getByLabel('New move date'));
  await page.getByLabel('New move date').fill(target);
  await page.getByLabel('Reason (optional)').fill('Customer asked');
  await page.getByLabel('Book without a truck if none is free').check();
  await page.getByRole('button', { name: 'Reschedule', exact: true }).click();
  await expect(page.getByText('Rescheduled.')).toBeVisible();
  expect((await jobOf('J-000009')).days[0]).toBe(target);
  await expect(page.getByText(/Rescheduled from .* Reason: Customer asked/)).toBeVisible();
  // The move date can no longer be typed over in "Edit move details".
  await unfold(page, 'Edit move details', page.locator('#jf-date'));
  await expect(page.locator('#jf-date')).toHaveAttribute('readonly', '');
});

test('record a card payment taken in Shopify on an invoice', async ({ page }) => {
  const invoiceId = await asOwner(async (sql) => {
    const [row] = await sql`select i.id from hhmc_invoices i join businesses b on b.id = i.business_id where b.slug = 'hhmc' and i.environment = 'live' and i.invoice_number = 'I-000001'`;
    return row.id as string;
  });
  await loginAs(page, SEED.hhmcAdmin);
  await page.goto(`${APP}/invoices/${invoiceId}`);
  await page.getByLabel('Amount credited ($)').fill('10.00');
  await page.getByLabel('Paid by').selectOption('card');
  await page.getByLabel('Reference (optional)').fill('Shopify #9001');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Payment recorded.')).toBeVisible();
  await expect(page.getByText(/Card \(Shopify\) · ref\. Shopify #9001/).first()).toBeVisible();
  const recorded = await asOwner(async (sql) => sql`select provider, method from payments where subject_id = ${invoiceId} and description like '%Shopify #9001%'`);
  expect(recorded).toEqual([{ provider: 'manual', method: 'card' }]);
});

test('cancel a booked move that had a deposit: the deposit outcome is recorded', async ({ page }) => {
  const job = await jobOf('J-000010');
  await loginAs(page, SEED.hhmcAdmin);
  await page.goto(`${APP}/jobs/${job.id}`);
  await unfold(page, 'Cancel job', page.locator('#cancel-reason'));
  await page.locator('#cancel-reason').fill('Moving next year instead');
  await page.getByLabel(/The deposit/).selectOption('kept');
  await page.getByRole('button', { name: 'Cancel job' }).click();
  // The cancel form goes away with the stage; the reason and the deposit outcome stay on the page.
  await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Moving next year instead · Deposit \$[\d,.]+: kept \(not refunded\)/).first()).toBeVisible();
});
