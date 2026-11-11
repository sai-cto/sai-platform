/**
 * The BRSS staff portal, end to end in a real browser on the seeded fake data:
 * dashboard → new order → intake → payment → warehouse location → appointment → close.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { SEED, asOwner, loginAs } from './helpers';

const APP = '/console/brss/live/app';

/** A date `days` from today in Ithaca, as the browser's date field wants it (yyyy-mm-dd). */
function dayFromNow(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The card (a titled panel) with this heading. */
const card = (page: Page, title: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

/**
 * Opens a fold-out section and waits until `inside` (something in it) can be seen. A click
 * that lands before the page has finished starting up is simply repeated.
 */
async function unfold(summary: Locator, inside: Locator): Promise<void> {
  await expect(async () => {
    if (!(await inside.isVisible())) await summary.click();
    await expect(inside).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

async function orderIdByNumber(orderNumber: string, environment = 'live'): Promise<string> {
  return asOwner(
    async (sql) =>
      (
        await sql`select o.id from brss_orders o join businesses b on b.id = o.business_id
                  where b.slug = 'brss' and o.environment = ${environment} and o.order_number = ${orderNumber}`
      )[0].id as string,
  );
}

test('the orders dashboard filters by status, region and search', async ({ page }) => {
  await loginAs(page, SEED.brssAdmin);
  await page.goto(APP);
  await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible();
  const sections = page.getByRole('navigation', { name: 'App sections' });
  await expect(sections.getByRole('link')).toHaveText(['Orders', 'Articles', 'Schedule', 'Operations', 'Pricing', 'Zip zones']);
  // The default view is the orders still in progress.
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(13);
  await expect(page.getByRole('row').filter({ hasText: 'Closed' })).toHaveCount(0);

  await page.getByLabel('Status').selectOption('closed');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page).toHaveURL(/status=closed/);
  await expect(rows).toHaveCount(2);

  await page.getByLabel('Status').selectOption('all');
  await page.getByLabel('Region').selectOption({ label: 'West Campus' });
  await page.getByLabel('Campus').selectOption('off_campus');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: 'Off campus' })).toHaveCount(3);

  await page.getByRole('link', { name: 'Clear' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByLabel('Search').fill('O-000005');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('$213.00 to pay');
  await rows.first().getByRole('link', { name: 'O-000005' }).click();
  await expect(page.getByRole('heading', { name: 'Order O-000005' })).toBeVisible();
  // On a detail page the Orders section stays highlighted.
  await expect(sections.getByRole('link', { name: 'Orders' })).toHaveAttribute('aria-current', 'page');
});

test('a storage order from start to finish', async ({ page }) => {
  test.setTimeout(180_000);
  await loginAs(page, SEED.brssAdmin);
  await page.goto(APP);
  await page.getByRole('link', { name: 'New order' }).click();

  // ---- create
  await page.getByLabel('First name').fill('Robin');
  await page.getByLabel('Last name').fill('Endtoend');
  await page.getByLabel('Email').fill('robin.endtoend@example.com');
  await page.getByLabel('Phone').fill('607-555-0142');
  await page.getByRole('button', { name: 'Create order' }).click();
  // (Scoped to the form: the browser framework has an invisible alert of its own.)
  const formError = page.locator('form').getByRole('alert');
  await expect(formError).toContainText('Choose at least one service');
  await page.getByLabel('Storage', { exact: true }).check();
  await page.getByRole('button', { name: 'Create order' }).click();
  await expect(formError).toContainText('Choose a storage term');
  await page.getByLabel('Storage term').selectOption('4');
  await page.getByRole('button', { name: 'Create order' }).click();
  await expect(page).toHaveURL(/\/app\/orders\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Order O-000017' })).toBeVisible();
  const orderUrl = page.url();
  await expect(card(page, 'Customer and details')).toContainText('Robin Endtoend');
  await expect(card(page, 'Customer and details')).toContainText('Starts with the first payment');

  // ---- intake: the billable weight is shown while typing, and checked again on the server
  const articles = card(page, 'Articles');
  await articles.getByLabel('Description').fill('Winter clothes');
  await articles.getByLabel('Weight (lb)').fill('30');
  await articles.getByRole('button', { name: 'Large box (18 × 18 × 18)' }).click();
  await expect(articles.getByText('Billable weight: 42 lb')).toBeVisible();
  await articles.getByLabel('Extra insurance (declared value)').selectOption('300');
  await articles.getByRole('button', { name: 'Add article' }).click();
  await expect(articles.getByRole('status')).toContainText(/Added A-\d{6}\./);
  await expect(articles.locator('tbody tr')).toHaveCount(1);
  await expect(articles.locator('tbody tr')).toContainText('No status yet');

  // A box over the limit is refused with a plain message (the intake form is still open).
  await articles.getByLabel('Length (in)').fill('18');
  await articles.getByLabel('Width (in)').fill('18');
  await articles.getByLabel('Height (in)').fill('18');
  await articles.getByLabel('Weight (lb)').fill('200');
  await articles.getByRole('button', { name: 'Add article' }).click();
  await expect(articles.getByRole('alert')).toContainText('Billable weight must be from 1 to 150 lb');
  await expect(articles.locator('tbody tr')).toHaveCount(1);

  // ---- charges: $1.10 a pound × 42 lb, and 10% of the $300 declared
  const charges = card(page, 'Charges and payments');
  await expect(charges.getByRole('row').filter({ hasText: 'Box storage, 3–4 months · 42 lb' })).toContainText('$46.20');
  await expect(charges.getByRole('row').filter({ hasText: 'Extra insurance' })).toContainText('$30.00');
  await expect(charges.getByText('To pay', { exact: true })).toHaveCount(2);

  // A supply added by hand
  await unfold(charges.getByText('Add supplies, packing or a fee'), charges.getByLabel('Product'));
  await charges.getByLabel('Product').selectOption({ label: 'Packing tape · $4.00' });
  await charges.getByLabel('Quantity').fill('2');
  await charges.getByRole('button', { name: 'Add charge' }).click();
  await expect(charges.getByRole('row').filter({ hasText: 'Packing tape' })).toContainText('$8.00');

  // ---- payment: 84.20 + 8% tax 6.74 + tip 5.00 = 95.94. First a declined card.
  await charges.getByLabel('Tip (dollars)').fill('5');
  await expect(charges.getByText('$95.94').first()).toBeVisible();
  await charges.getByLabel('Test card').selectOption('mock_declined');
  await charges.getByRole('button', { name: 'Take payment of $95.94' }).click();
  await expect(charges.getByRole('alert')).toContainText('The payment did not go through');
  await expect(charges.getByText('To pay', { exact: true })).toHaveCount(3);
  await expect(charges.getByRole('row').filter({ hasText: 'Failed' })).toContainText('Card declined');

  await charges.getByLabel('Test card').selectOption('mock_ok');
  await charges.getByRole('button', { name: 'Take payment of $95.94' }).click();
  await expect(charges.getByText('To pay', { exact: true })).toHaveCount(0);
  await expect(charges.getByRole('row').filter({ hasText: '···· 4242' }).filter({ hasText: 'Paid' })).toContainText('$95.94');
  await expect(charges.getByRole('button', { name: /Take payment/ })).toHaveCount(0);
  // The first payment starts the storage clock.
  await expect(card(page, 'Customer and details')).not.toContainText('Starts with the first payment');

  // ---- warehouse location on the article's own page marks it Stored
  await articles.locator('tbody tr').getByRole('link', { name: /A-\d{6}/ }).click();
  await expect(page.getByRole('heading', { name: /Article A-\d{6}/ })).toBeVisible();
  const location = card(page, 'Warehouse location');
  await location.getByLabel('Warehouse').selectOption({ label: 'Lansing' });
  await location.getByLabel('Section').selectOption('Boxes');
  await location.getByLabel('Row').selectOption('C');
  await location.getByLabel('Pallet number').fill('7');
  await location.getByRole('button', { name: 'Save location' }).click();
  await expect(location.getByRole('status')).toContainText('Location saved. Status: Stored.');
  const status = card(page, 'Status');
  await status.getByLabel('Status').selectOption('ready_for_delivery');
  await status.getByRole('button', { name: 'Save status' }).click();
  await expect(status.getByRole('status')).toContainText('Status saved.');

  // ---- appointments: the lead time is enforced; an override needs a reason
  await page.goto(orderUrl);
  await expect(articles.locator('tbody tr')).toContainText('Ready for delivery');
  await expect(articles.locator('tbody tr')).toContainText('Lansing · Boxes · Row C · Pallet 7');
  const visits = card(page, 'Appointments');
  await visits.getByLabel('Kind of appointment').selectOption('delivery');
  await expect(visits.getByLabel('Phone')).toHaveValue('607-555-0142');
  await visits.getByLabel('Region').selectOption({ label: 'North Campus' });
  await visits.getByLabel('Building', { exact: true }).selectOption({ label: 'Balch' });
  await visits.getByLabel('Room or apartment').fill('214');
  await visits.getByLabel('Date').fill(dayFromNow(1));
  await visits.getByRole('button', { name: 'Book appointment' }).click();
  await expect(visits.getByRole('alert')).toContainText("Appointments need 2 days' notice");
  await visits.getByLabel('Date').fill(dayFromNow(25));
  await visits.getByLabel('Time', { exact: true }).selectOption({ label: '1 PM – 3 PM' });
  await visits.getByRole('button', { name: 'Book appointment' }).click();
  await expect(visits.getByRole('listitem').filter({ hasText: 'Delivery' })).toContainText('North Campus, Balch, Room 214');
  await expect(visits.getByRole('listitem').filter({ hasText: 'Delivery' })).toContainText('Unconfirmed');
  // The first appointment gave the order its campus category.
  await expect(card(page, 'Customer and details')).toContainText('On campus');

  // ---- the schedule: confirm it (the customer is emailed) and put it on a truck
  await page.goto(`${APP}/schedule?from=${dayFromNow(25)}&days=1`);
  const stop = page.getByRole('listitem').filter({ hasText: 'Robin Endtoend' });
  await expect(stop).toContainText('Order O-000017');
  await stop.getByLabel('Status').selectOption('confirmed');
  await stop.getByRole('button', { name: 'Save status' }).click();
  await expect(stop.getByRole('status')).toContainText('Confirmation emailed to robin.endtoend@example.com');
  await stop.getByLabel('Truck').selectOption({ label: 'Truck 1' });
  await stop.getByRole('button', { name: 'Save truck' }).click();
  await expect(stop).toContainText(/Truck: Truck 1 \(.+\)/);

  // ---- close the order: its articles become Delivered
  await page.goto(orderUrl);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Close order' }).click();
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await expect(articles.locator('tbody tr')).toContainText('Delivered');
  await expect(articles.getByText('Take in an article')).toHaveCount(0);

  // ---- everything that happened is in the activity log, with who did it
  await page.goto('/console/brss/live/activity');
  const log = page.getByRole('table');
  await expect(log).toContainText('Created order "O-000017"');
  await expect(log).toContainText('Updated order "O-000017" (status)');
  await expect(log.getByRole('row').filter({ hasText: 'Created order "O-000017"' })).toContainText('Blake BRSS-Admin');
});

test('unavailability blocks booking; pricing and zip zones can be changed', async ({ page }) => {
  await loginAs(page, SEED.brssAdmin);
  // Block a whole day, then try to book in it.
  const blocked = dayFromNow(30);
  await page.goto(`${APP}/schedule`);
  const blocks = card(page, 'Unavailability');
  await expect(blocks).toContainText('Staff training day');
  await unfold(blocks.getByText('Block a time'), blocks.getByLabel('First day'));
  await blocks.getByLabel('First day').fill(blocked);
  await blocks.getByLabel('Reason').fill('Slope Day');
  await blocks.getByRole('button', { name: 'Block these times' }).click();
  await expect(blocks.getByRole('alert')).toContainText('Tick "All day" or at least one time');
  await blocks.getByLabel('All day').check();
  await blocks.getByRole('button', { name: 'Block these times' }).click();
  await expect(blocks.getByRole('listitem').filter({ hasText: 'Slope Day' })).toContainText('every location');

  await page.goto(`${APP}/orders/${await orderIdByNumber('O-000015')}`);
  const visits = card(page, 'Appointments');
  const booking = visits.locator('form').filter({ has: page.getByRole('button', { name: 'Book appointment' }) });
  await unfold(visits.getByText('Book an appointment'), booking.getByLabel('Phone'));
  await booking.getByLabel('Phone').fill('607-555-0100');
  await booking.getByLabel('Region').selectOption({ label: 'Other Address' });
  await booking.getByLabel('Street address').fill('12 Sample Road');
  await booking.getByLabel('City').fill('Ithaca');
  await booking.getByLabel('Zip').fill('14850');
  await booking.getByLabel('Date').fill(blocked);
  await booking.getByRole('button', { name: 'Book appointment' }).click();
  await expect(booking.getByRole('alert')).toContainText('That time is blocked: Slope Day');
  // The admin may book anyway, with a reason that stays on the appointment.
  await booking.getByLabel('Book anyway if the time is blocked or at short notice').check();
  await booking.getByLabel('Why').fill('Customer flies out that evening');
  await booking.getByRole('button', { name: 'Book appointment' }).click();
  await expect(visits.getByText('Booked in spite of the rules: Customer flies out that evening')).toBeVisible();

  // Zip zones: look up a price.
  await page.goto(`${APP}/zones`);
  await page.getByLabel('Zip code').fill('10027');
  await page.getByLabel('Billable weight (lb)').fill('42');
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByRole('status')).toContainText('Zone 2. Ship to home: $36.78. Ship to Cornell: $33.10.');

  // Pricing: a new price shows in the list.
  await page.goto(`${APP}/pricing`);
  const tape = page.getByRole('row').filter({ hasText: 'Packing tape' });
  await tape.getByLabel('Price of Packing tape in dollars').fill('4.25');
  await tape.getByRole('button', { name: 'Save' }).click();
  await expect(tape.getByRole('status')).toContainText('Saved.');
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: 'Packing tape' })).toContainText('$4.25');
  await expect(card(page, 'Storage terms').locator('tbody tr')).toHaveCount(6);

  // Operations: warehouses, trucks and buildings.
  await page.goto(`${APP}/operations`);
  await expect(card(page, 'Warehouses').getByRole('row').filter({ hasText: 'Lansing' })).toContainText('In use');
  await expect(card(page, 'Trucks and crews')).toContainText('Truck 1');
  await unfold(card(page, 'Regions and buildings').locator('summary').filter({ hasText: 'North Campus' }), card(page, 'Regions and buildings').getByRole('row').filter({ hasText: 'Balch' }));
  await expect(card(page, 'Regions and buildings').getByRole('row').filter({ hasText: 'Balch' })).toContainText('On campus');
});

test('staff see only what they were granted; executives and outsiders get nothing', async ({ page }) => {
  // New staff with the default permissions: can look, and can move articles.
  await loginAs(page, SEED.brssStaff);
  await page.goto(APP);
  await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'New order' })).toHaveCount(0);
  expect((await page.request.get(`${APP}/orders/new`)).status()).toBe(404);

  const orderId = await orderIdByNumber('O-000005');
  await page.goto(`${APP}/orders/${orderId}`);
  await expect(page.getByRole('heading', { name: 'Order O-000005' })).toBeVisible();
  await expect(page.getByText('Take in an article')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Take payment/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0);
  await expect(page.getByText('You do not have permission to see payments.')).toBeVisible();
  await expect(page.getByText('Taking payment needs')).toBeVisible();
  // They can set the status of the order's articles (warehouse work).
  await card(page, 'Articles').getByLabel('Status for all articles on this order').selectOption('stored');
  await card(page, 'Articles').getByRole('button', { name: 'Set on every article' }).click();
  await expect(card(page, 'Articles').getByRole('status')).toContainText('Status set on 3 articles.');
  // They can read prices but not change them.
  await page.goto(`${APP}/pricing`);
  await expect(page.getByRole('row').filter({ hasText: 'Packing tape' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
  await expect(page.getByText('New product')).toHaveCount(0);

  // A new hire with nothing granted cannot open the portal's pages.
  await loginAs(page, SEED.brssNewHire);
  expect((await page.request.get(APP)).status()).toBe(404);
  expect((await page.request.get(`${APP}/orders/${orderId}`)).status()).toBe(404);
  expect((await page.request.get(`${APP}/pricing`)).status()).toBe(404);

  // An executive has no staff portal; another business's admin has no BRSS at all.
  await loginAs(page, SEED.executive);
  expect((await page.request.get(APP)).status()).toBe(404);
  expect((await page.request.get(`${APP}/orders/${orderId}`)).status()).toBe(404);
  await loginAs(page, SEED.hhmcAdmin);
  expect((await page.request.get(`${APP}/orders/${orderId}`)).status()).toBe(404);
  // The same order id inside the other business's own portal is "not found" too.
  expect((await page.request.get(`/console/hhmc/live/app/orders/${orderId}`)).status()).toBe(404);
});

test('test mode has its own orders, and unknown records are "not found"', async ({ page }) => {
  await loginAs(page, SEED.brssAdmin);
  // An order id that does not exist, or is not an id at all.
  expect((await page.request.get(`${APP}/orders/00000000-0000-4000-8000-000000000000`)).status()).toBe(404);
  expect((await page.request.get(`${APP}/orders/not-an-id`)).status()).toBe(404);
  expect((await page.request.get(`${APP}/articles/00000000-0000-4000-8000-000000000000`)).status()).toBe(404);
  // A live order does not exist in test mode, and the other way round.
  const liveOrder = await orderIdByNumber('O-000002');
  expect((await page.request.get(`/console/brss/sandbox/app/orders/${liveOrder}`)).status()).toBe(404);
  const sandboxOrder = await orderIdByNumber('O-000002', 'sandbox');
  expect((await page.request.get(`${APP}/orders/${sandboxOrder}`)).status()).toBe(404);

  await page.goto(`/console/brss/sandbox/app/orders/${sandboxOrder}`);
  await expect(page.getByTestId('sandbox-banner')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Order O-000002' })).toBeVisible();
  // A hand-added charge in test mode stays in test mode.
  const charges = card(page, 'Charges and payments');
  await unfold(charges.getByText('Add supplies, packing or a fee'), charges.getByLabel('Product'));
  await charges.getByLabel('Product').selectOption({ label: 'Peak day fee · $20.00' });
  await charges.getByRole('button', { name: 'Add charge' }).click();
  await expect(charges.getByRole('row').filter({ hasText: 'Peak day fee' })).toBeVisible();
  await page.goto(`${APP}/orders/${liveOrder}`);
  await expect(page.getByTestId('sandbox-banner')).toHaveCount(0);
  await expect(card(page, 'Charges and payments').getByRole('row').filter({ hasText: 'Peak day fee' })).toHaveCount(0);
});

test('BRSS numbers reach the Overview tab and the executive dashboard', async ({ page }) => {
  await loginAs(page, SEED.brssAdmin);
  await page.goto('/console/brss/live/overview');
  await expect(page.getByText('Orders placed · last 30 days')).toBeVisible();
  await expect(page.getByText('Orders in progress')).toBeVisible();
  await expect(page.getByText('Articles in our hands')).toBeVisible();
  await expect(page.getByText('Appointments · next 7 days')).toBeVisible();

  await loginAs(page, SEED.executive);
  await page.goto('/console/executive');
  const row = page.getByRole('row').filter({ hasText: 'Big Red Shipping & Storage' });
  // The work-items column counts BRSS orders; businesses without a built module show a dash.
  await expect(row.getByTestId('work-items')).toHaveText(/^\d+\s*orders$/);
  await expect(page.getByRole('row').filter({ hasText: 'Student Agencies Real Estate' }).getByTestId('work-items')).toHaveText('—');
  // Hired Hands is built (Phase 5): it counts its jobs.
  await expect(page.getByRole('row').filter({ hasText: 'Hired Hands Moving Company' }).getByTestId('work-items')).toHaveText(/^\d+\s*jobs$/);
});
