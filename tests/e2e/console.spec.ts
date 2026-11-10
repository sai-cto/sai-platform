/** The console as each role sees it, and its main workflows end to end. */
import { expect, test, type Page } from '@playwright/test';
import { SEED, asOwner, loginAs, tabLabels } from './helpers';

const ALL_TABS = ['Overview', 'App', 'People and access', 'Data', 'Activity log', 'Settings', 'Test mode'];
const PLATFORM_LINKS = ['Users and roles', 'Module registry', 'Feature flags', 'Activity log', 'Data imports', 'System health', 'Platform settings'];

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Main' }).first();

test.describe('each role sees exactly its own navigation', () => {
  test('super admin and tech: Platform section, executive view, every tab', async ({ page }) => {
    for (const email of [SEED.superAdmin, SEED.tech]) {
      await loginAs(page, email);
      for (const label of PLATFORM_LINKS) await expect(page.getByTestId('nav-platform').first().getByRole('link', { name: label })).toBeVisible();
      await expect(sidebar(page).getByRole('link', { name: 'Executive view' })).toBeVisible();
      await page.goto('/console/brss');
      await expect(page).toHaveURL(/\/console\/brss\/live\/overview/);
      expect(await tabLabels(page)).toEqual(ALL_TABS);
    }
  });

  test('executive: executive view, no Platform section, read-only tabs, no test mode', async ({ page }) => {
    await loginAs(page, SEED.executive);
    await expect(sidebar(page).getByRole('link', { name: 'Executive view' })).toBeVisible();
    await expect(page.getByTestId('nav-platform')).toHaveCount(0);
    await page.goto('/console/brss');
    expect(await tabLabels(page)).toEqual(['Overview', 'Data', 'Activity log']);
    await expect(page.getByRole('group', { name: 'Data mode' })).toHaveCount(0);
    await page.goto('/console/brss/live/data/core.customer');
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Archive' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Export CSV' })).toHaveCount(0);
  });

  test('business admin: one business, no Platform or executive view, every tab, cannot delete permanently', async ({ page }) => {
    await loginAs(page, SEED.brssAdmin);
    await expect(page.getByTestId('nav-platform')).toHaveCount(0);
    await expect(sidebar(page).getByRole('link', { name: 'Executive view' })).toHaveCount(0);
    await expect(page.getByTestId('nav-businesses').first().getByRole('link')).toHaveCount(1);
    await page.goto('/console/brss');
    expect(await tabLabels(page)).toEqual(ALL_TABS);
    await page.goto('/console/brss/live/data/core.customer?show=all');
    await expect(page.getByRole('button', { name: 'Archive' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Export CSV' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete permanently' })).toHaveCount(0);
    // Settings are visible but read-only for a business admin.
    await page.goto('/console/brss/settings');
    await expect(page.getByText('Only the tech team can change them')).toBeVisible();
    await expect(page.getByRole('button', { name: /Turn (on|off)/ })).toHaveCount(0);
  });

  test('staff: only what they were granted', async ({ page }) => {
    await loginAs(page, SEED.brssStaff);
    await page.goto('/console/brss');
    expect(await tabLabels(page)).toEqual(['Overview', 'App']);
    await expect(page.getByRole('group', { name: 'Data mode' })).toHaveCount(0);
    // Granted customers.read and scheduling.read, but not payments: no revenue on the overview.
    await expect(page.getByText('Customers', { exact: true })).toBeVisible();
    await expect(page.getByText(/Revenue/)).toHaveCount(0);

    await loginAs(page, SEED.brssNewHire);
    await page.goto('/console/brss');
    expect(await tabLabels(page)).toEqual(['Overview', 'App']);
    await expect(page.getByText('Customers', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Revenue/)).toHaveCount(0);
  });
});

test('archive → restore → permanent delete, with every step in the activity log', async ({ page }) => {
  const name = `Zelda${Date.now()}`;
  const id = await asOwner(async (sql) => {
    const [b] = await sql`select id from businesses where slug = 'cbb'`;
    const [row] = await sql`insert into customers (business_id, environment, first_name, last_name) values (${b.id}, 'live', ${name}, 'Deleteme') returning id`;
    return row.id as string;
  });
  const list = `/console/cbb/live/data/core.customer?show=all&q=${name}`;
  const row = (page: Page) => page.getByRole('row', { name: new RegExp(name) });

  // A business admin archives ("deletes") and restores.
  await loginAs(page, 'cbb.admin@sai.example');
  await page.goto(list);
  await row(page).getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
  await expect(row(page).getByText(/Archived/)).toBeVisible();
  await page.goto(`/console/cbb/live/data/core.customer?q=${name}`);
  await expect(page.getByText('No records match')).toBeVisible(); // gone from the normal view
  await page.goto(list);
  await row(page).getByRole('button', { name: 'Restore' }).click();
  await expect(row(page).getByText('Active')).toBeVisible();

  // Archive again; the admin has no permanent delete.
  await row(page).getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
  await expect(row(page).getByText(/Archived/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete permanently' })).toHaveCount(0);

  // Tech has no permanent delete either.
  await loginAs(page, SEED.tech);
  await page.goto(list);
  await expect(row(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete permanently' })).toHaveCount(0);

  // Super admin sees it, but it is disabled until the retention window has passed.
  await loginAs(page, SEED.superAdmin);
  await page.goto(list);
  await expect(row(page).getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
  await asOwner((sql) => sql`update customers set archived_at = now() - interval '31 days' where id = ${id}`);
  await page.reload();
  await row(page).getByRole('button', { name: 'Delete permanently' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByText('No records match')).toBeVisible();

  // Every step is in the business's activity log, with who did it.
  await page.goto(`/console/cbb/live/activity?q=${name}`);
  const log = page.getByRole('table');
  for (const action of ['archive', 'restore', 'purge']) await expect(log.getByText(action, { exact: true }).first()).toBeVisible();
  await expect(log.getByText(`Permanently deleted customer "${name} Deleteme"`)).toBeVisible();
  await expect(log.getByText('Bea CBB-Admin').first()).toBeVisible();
  await expect(log.getByText('Sam Super (CTO)').first()).toBeVisible();
});

test('test mode: a persistent indicator, and sandbox data that is separate from live', async ({ page }) => {
  await loginAs(page, SEED.brssAdmin);
  await page.goto('/console/brss/live/overview');
  await expect(page.getByTestId('sandbox-banner')).toHaveCount(0);

  await page.getByRole('group', { name: 'Data mode' }).getByRole('link', { name: 'Test mode' }).click();
  await expect(page).toHaveURL(/\/console\/brss\/sandbox\/overview/);
  // The banner and frame are on every page that shows data.
  for (const tab of ['overview', 'app', 'data', 'data/core.customer', 'activity']) {
    await page.goto(`/console/brss/sandbox/${tab}`);
    await expect(page.getByTestId('sandbox-banner')).toBeVisible();
    await expect(page.getByTestId('sandbox-banner')).toContainText('TEST MODE');
    await expect(page.getByTestId('sandbox-frame')).toBeVisible();
  }
  // Tabs keep you in test mode.
  await page.goto('/console/brss/sandbox/overview');
  await page.locator('a[data-business-tab="data"]').click();
  await expect(page).toHaveURL(/\/console\/brss\/sandbox\/data/);

  // Archiving a sandbox customer does not touch live.
  const liveBefore = await asOwner(async (sql) => Number((await sql`select count(*)::int as n from customers c join businesses b on b.id = c.business_id where b.slug = 'brss' and c.environment = 'live' and c.archived_at is null`)[0].n));
  await page.goto('/console/brss/sandbox/data/core.customer');
  await page.getByRole('button', { name: 'Archive' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText('1–11 of 11')).toBeVisible();
  const liveAfter = await asOwner(async (sql) => Number((await sql`select count(*)::int as n from customers c join businesses b on b.id = c.business_id where b.slug = 'brss' and c.environment = 'live' and c.archived_at is null`)[0].n));
  expect(liveAfter).toBe(liveBefore);

  // Reset brings the sandbox back to fresh fake data.
  await page.goto('/console/brss/test-mode');
  await page.getByRole('button', { name: 'Reset sandbox' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Reset sandbox' }).click();
  await expect(page.getByText(/Last reset .* by Blake BRSS-Admin/)).toBeVisible();
  await page.goto('/console/brss/sandbox/data/core.customer');
  await expect(page.getByText('1–12 of 12')).toBeVisible();

  // Back to live: the indicator is gone.
  await page.getByRole('group', { name: 'Data mode' }).getByRole('link', { name: 'Live' }).click();
  await expect(page).toHaveURL(/\/console\/brss\/live\//);
  await expect(page.getByTestId('sandbox-banner')).toHaveCount(0);
});

test('a business admin manages their own staff', async ({ page }) => {
  const email = `e2e.staff.${Date.now()}@sai.example`;
  await loginAs(page, 'tut.admin@sai.example');
  await page.goto('/console/tut/people');
  await page.getByLabel('Full name').fill('Edie Endtoend');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Add person' }).click();
  const member = page.getByRole('listitem').filter({ hasText: email });
  await expect(member).toBeVisible();
  await expect(member.getByText('Business staff')).toBeVisible();

  await member.getByText(/Permissions:/).click();
  await member.getByLabel('Add, edit, archive and restore customers').check();
  await member.getByRole('button', { name: 'Save permissions' }).click();
  await expect(member.getByText('Saved.')).toBeVisible();

  // The new person signs in and sees only this business.
  await loginAs(page, email);
  await expect(page.getByTestId('nav-businesses').first().getByRole('link')).toHaveCount(1);

  await loginAs(page, 'tut.admin@sai.example');
  await page.goto('/console/tut/people');
  await page.getByRole('listitem').filter({ hasText: email }).getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove access' }).click();
  await expect(page.getByText('Removed (1)')).toBeVisible();

  // A business's only admin cannot remove themselves (Tutoring has two admins; the Mailroom has one).
  await loginAs(page, 'brm.admin@sai.example');
  await page.goto('/console/brm/people');
  await page.getByRole('listitem').filter({ hasText: 'brm.admin@sai.example' }).getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove access' }).click();
  await expect(page.getByRole('alertdialog').getByRole('alert')).toContainText('last admin');
});

test('Platform section: users, roles, flags and settings follow the role rules', async ({ page }) => {
  const email = `e2e.user.${Date.now()}@sai.example`;
  // Tech can create a user but cannot grant platform roles or change platform settings.
  await loginAs(page, SEED.tech);
  await page.goto('/console/platform/users');
  await page.getByLabel('Full name').fill('Una User');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByText('User created')).toBeVisible();
  await page.getByRole('link', { name: 'Una User' }).click();
  await expect(page.getByText('Only a super admin can change platform roles')).toBeVisible();
  await page.goto('/console/platform/settings');
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
  await expect(page.getByText('30', { exact: true })).toBeVisible();

  // Tech can set a feature flag.
  const flag = `e2e.flag-${Date.now()}`;
  await page.goto('/console/platform/flags');
  await page.getByLabel('Flag key').fill(flag);
  await page.getByLabel('Switched on').check();
  await page.getByRole('button', { name: 'Save flag' }).click();
  await expect(page.getByRole('row', { name: new RegExp(flag) }).getByText('On', { exact: true })).toBeVisible();

  // Super admin can grant a platform role and change the retention window.
  await loginAs(page, SEED.superAdmin);
  await page.goto('/console/platform/users?q=Una');
  await page.getByRole('link', { name: 'Una User' }).click();
  await page.getByLabel('Role').first().selectOption('executive');
  await page.getByRole('button', { name: 'Save platform role' }).click();
  await expect(page.getByText(/Saved\./)).toBeVisible();
  await page.goto('/console/platform/settings');
  await page.getByLabel('Days').fill('45');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.getByLabel('Days').fill('30');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  // The global log shows it all.
  await page.goto('/console/platform/activity?action=settings_change');
  await expect(page.getByText('Changed retention window from 45 to 30 days')).toBeVisible();
  await page.goto('/console/platform/health');
  await expect(page.getByText('Database reachable')).toBeVisible();
  await page.goto('/console/platform/modules');
  await expect(page.getByRole('row')).toHaveCount(10); // header + 9 businesses
});

test('import: CSV → map → check → sandbox → live', async ({ page }) => {
  const tag = `Imp${Date.now()}`;
  const good = `First,Last,Email Address,Phone\n${tag},One,${tag}.one@example.com,607-555-0199\n${tag},Two,,\n`;
  const bad = `First,Last,Email Address\n${tag},Bad,not-an-email\n,Nameless,x@example.com\n`;
  await loginAs(page, SEED.tech);

  // A file with bad rows is caught by the check and cannot be imported.
  await page.goto('/console/platform/imports/new');
  await page.getByLabel('Import into').selectOption({ label: 'Cornell Freshman Register — Customers' });
  await page.getByLabel('CSV file').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(bad) });
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  await expect(page).toHaveURL(/\/console\/platform\/imports\/cfr\//);
  await page.getByLabel(/^First name/).selectOption('First');
  await page.getByLabel(/^Last name/).selectOption('Last');
  await page.getByLabel(/^Email/).selectOption('Email Address');
  await page.getByRole('button', { name: 'Save and check every row' }).click();
  await expect(page.getByText('2 of 2 rows have problems').first()).toBeVisible();
  await expect(page.getByText('Email is not valid')).toBeVisible();
  await expect(page.getByRole('button', { name: /Import 2 rows into the sandbox/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Import into live' })).toBeDisabled();

  // A good file: check, sandbox, look, then live.
  await page.goto('/console/platform/imports/new');
  await page.getByLabel('Import into').selectOption({ label: 'Cornell Freshman Register — Customers' });
  await page.getByLabel('CSV file').setInputFiles({ name: 'good.csv', mimeType: 'text/csv', buffer: Buffer.from(good) });
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  await page.getByLabel(/^First name/).selectOption('First');
  await page.getByLabel(/^Last name/).selectOption('Last');
  await page.getByLabel(/^Email/).selectOption('Email Address');
  await page.getByRole('button', { name: 'Save and check every row' }).click();
  await expect(page.getByText('All 2 rows passed').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import into live' })).toBeDisabled(); // sandbox first
  await page.getByRole('button', { name: /Import 2 rows into the sandbox/ }).click();
  await expect(page.getByText('2 customers imported into the Cornell Freshman Register sandbox')).toBeVisible();
  const jobUrl = page.url();

  await page.goto(`/console/cfr/sandbox/data/core.customer?q=${tag}`);
  await expect(page.getByText('1–2 of 2')).toBeVisible();
  await page.goto(`/console/cfr/live/data/core.customer?q=${tag}`);
  await expect(page.getByText('No records match')).toBeVisible(); // not in live yet

  await page.goto(jobUrl);
  await page.getByRole('button', { name: 'Import into live' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Import into live' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.goto(`/console/cfr/live/data/core.customer?q=${tag}`);
  await expect(page.getByText('1–2 of 2')).toBeVisible();

  // The job page now says it is done and offers no second import.
  await page.goto(jobUrl);
  await expect(page.getByText(/2 customers were imported into live/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import into live' })).toHaveCount(0);
  await page.goto('/console/platform/imports');
  await expect(page.getByRole('row', { name: /good\.csv/ })).toHaveCount(2); // sandbox run + live run
});

test('a CSV larger than 1 MB uploads (up to the stated 10 MB)', async ({ page }) => {
  await loginAs(page, SEED.tech);
  await page.goto('/console/platform/imports/new');
  await page.getByLabel('Import into').selectOption({ label: 'Campus Promotions — Customers' });
  const row = `Bulk,Row,,,${'x'.repeat(900)}\n`;
  const big = Buffer.from(`First name,Last name,Email,Phone,Notes\n${row.repeat(1500)}`); // about 1.4 MB
  expect(big.byteLength).toBeGreaterThan(1_200_000);
  await page.getByLabel('CSV file').setInputFiles({ name: 'big.csv', mimeType: 'text/csv', buffer: big });
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  await expect(page).toHaveURL(/\/console\/platform\/imports\/cp\//);
  await expect(page.getByText('1,500 rows').first()).toBeVisible();
});

test('odd query strings do not break pages', async ({ page }) => {
  await loginAs(page, SEED.brssAdmin);
  for (const path of ['/console/brss/live/data/core.customer?q=a&q=b&page=999999999999', '/console/brss/live/activity?q=a&q=b&from=2026-13-45&page=-3']) {
    expect((await page.request.get(path)).status(), path).toBe(200);
  }
  await loginAs(page, SEED.tech);
  expect((await page.request.get('/console/platform/users?q=a&q=b')).status()).toBe(200);
  expect((await page.request.get('/console/executive?days=30&days=90')).status()).toBe(200);
});

test('executive view: nine businesses, all-SAI totals, nothing to edit', async ({ page }) => {
  await loginAs(page, SEED.executive);
  await page.goto('/console/executive');
  await expect(page.getByRole('heading', { name: 'Executive view' })).toBeVisible();
  const table = page.getByRole('table');
  await expect(table.locator('tbody tr')).toHaveCount(9);
  await expect(table.locator('tfoot')).toContainText('All SAI');
  await expect(page.getByText(/All-SAI revenue · last 30 days/)).toBeVisible();
  await page.getByRole('group', { name: 'Period' }).getByRole('link', { name: '90 days' }).click();
  await expect(page.getByText(/All-SAI revenue · last 90 days/)).toBeVisible();
  await expect(page.locator('main form')).toHaveCount(0);
  await expect(page.locator('main button')).toHaveCount(0);
});

test('keyboard: command palette and business shortcuts', async ({ page }) => {
  await loginAs(page, SEED.tech);
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Type a page or business…').fill('health');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/console\/platform\/health/);
  await page.keyboard.press(']');
  await expect(page).toHaveURL(/\/console\/hhmc\/live\/overview/);
  await page.keyboard.press(']');
  await expect(page).toHaveURL(/\/console\/sare\/live\/overview/);
  await page.keyboard.press('g');
  await page.keyboard.press('d');
  await expect(page).toHaveURL(/\/console\/sare\/live\/data/);
  await page.keyboard.press('[');
  await expect(page).toHaveURL(/\/console\/hhmc\/live\/overview/);
});

test('works on a phone: the menu opens as a drawer and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginAs(page, SEED.brssAdmin);
  await page.goto('/console/brss/sandbox/overview');
  await expect(page.getByTestId('sandbox-banner')).toBeVisible();
  await page.getByRole('button', { name: 'Open menu' }).click();
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  await expect(drawer.getByRole('link', { name: 'Big Red Shipping & Storage' })).toBeVisible();
  await drawer.getByRole('link', { name: 'Home' }).click();
  await expect(page).toHaveURL(/\/console$/);
  // Make sure there is recent activity, so the Overview shows its widest content (a table).
  await page.goto('/console/brss/sandbox/data/core.customer');
  await page.getByRole('button', { name: 'Archive' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  for (const path of ['/console', '/console/brss/live/overview', '/console/brss/sandbox/overview', '/console/brss/sandbox/activity', '/console/brss/live/data/core.customer', '/console/brss/people', '/console/brss/settings', '/console/brss/test-mode']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});
