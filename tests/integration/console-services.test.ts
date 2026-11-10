/** Core services added with the console: imports, CSV export, executive dashboard, registry report, health. */
import { describe, expect, it } from 'vitest';
import { parseActivitySearch } from '@/app/console/_components/activity-filters';
import { activityCount, lastDays } from '@/core/analytics/analytics';
import { executiveDashboard } from '@/core/analytics/executive';
import { listBusinessActivity } from '@/core/audit/read';
import { listCustomers } from '@/core/customers/customers';
import { withScope } from '@/core/db/scope';
import { ForbiddenError, ValidationError } from '@/core/errors';
import { runHealthChecks } from '@/core/health/health';
import { createImportJob, dryRunImport, getImportJob, importableEntities, listImportJobs, parseCsv, runLiveImport, runSandboxImport, suggestMapping } from '@/core/imports/imports';
import { matchRoute } from '@/core/modules/portal';
import { moduleRegistryReport } from '@/core/modules/report';
import { takePayment } from '@/core/payments/payments';
import { customerEntity } from '@/core/records/core-entities';
import { exportCell, exportRecords, safeCell } from '@/core/records/export';
import { sandboxSummary } from '@/core/sandbox/sandbox';
import { addMember, listMembers, removeMember, setMemberPermissions } from '@/core/people/memberships';
import { buildBusinessContext } from '@/core/tenancy/context';
import { SEED_BUSINESSES } from '@/seed/businesses';
import { USERS, ctxFor, platformCtxFor } from './helpers';

const csv = (text: string) => new TextEncoder().encode(text);
const tag = () => `Imp${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const MAPPING = { firstName: 'First', lastName: 'Last', email: 'Mail' };

describe('imports: CSV → map → check → sandbox → live', () => {
  it('guesses the mapping from column names', () => {
    expect(suggestMapping(customerEntity, ['first name', 'LastName', 'E-mail', 'Phone', 'Unrelated'])).toEqual({ firstName: 'first name', lastName: 'LastName', email: 'E-mail', phone: 'Phone' });
    expect(importableEntities('brss').map((e) => e.key)).toContain('core.customer');
  });

  it('rejects files with no header, no rows or too many rows', () => {
    expect(() => parseCsv(csv(''))).toThrow(ValidationError);
    expect(() => parseCsv(csv('First,Last\n'))).toThrow(/no data rows/);
    expect(() => parseCsv(csv(`A\n${'x\n'.repeat(2001)}`))).toThrow(/at most 2000/);
  });

  it('always starts in the sandbox, and only the tech team may import', async () => {
    const live = await ctxFor(USERS.tech, 'cp', 'live');
    await expect(createImportJob(live, { entityKey: 'core.customer', filename: 'a.csv', bytes: csv('First,Last\nA,B\n') })).rejects.toThrow(/sandbox first/);
    const admin = await ctxFor(USERS.brssAdmin, 'brss', 'sandbox');
    await expect(createImportJob(admin, { entityKey: 'core.customer', filename: 'a.csv', bytes: csv('First,Last\nA,B\n') })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listImportJobs(await platformCtxFor(USERS.brssAdmin))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('a dry run reports every bad row and imports nothing', async () => {
    const t = tag();
    const ctx = await ctxFor(USERS.tech, 'cp', 'sandbox');
    const job = await createImportJob(ctx, { entityKey: 'core.customer', filename: 'bad.csv', bytes: csv(`First,Last,Mail\n${t},Ok,ok@example.com\n${t},Bad,nope\n,NoFirst,\n`) });
    await expect(dryRunImport(ctx, job.id, { firstName: 'First' })).rejects.toThrow(/Choose a column for: Last name/);
    const checked = await dryRunImport(ctx, job.id, MAPPING);
    expect(checked).toMatchObject({ status: 'dry_run_failed', rowCount: 3, errorCount: 2 });
    expect(checked.errors.map((e) => e.row)).toEqual([3, 4]); // line numbers in the file
    await expect(runSandboxImport(ctx, job.id)).rejects.toThrow(/Run the check first/);
    expect((await listCustomers(ctx, { search: t })).total).toBe(0);
  });

  it('a clean file goes into the sandbox, then live, once; every row is logged', async () => {
    const t = tag();
    const sandbox = await ctxFor(USERS.tech, 'cp', 'sandbox');
    const live = await ctxFor(USERS.tech, 'cp', 'live');
    const platform = await platformCtxFor(USERS.tech);
    const job = await createImportJob(sandbox, { entityKey: 'core.customer', filename: 'good.csv', bytes: csv(`First,Last,Mail\n${t},One,${t}.One@Example.com\n${t},Two,\n`) });

    // Live is refused until the sandbox import has happened.
    await expect(runLiveImport(platform, live, job.id)).rejects.toThrow(/sandbox/);
    expect((await dryRunImport(sandbox, job.id, MAPPING)).status).toBe('dry_run_ok');
    expect((await getImportJob(sandbox, job.id)).preview).toHaveLength(2);
    await expect(runLiveImport(platform, live, job.id)).rejects.toThrow(/sandbox/);

    const done = await runSandboxImport(sandbox, job.id);
    expect(done).toMatchObject({ status: 'imported', importedCount: 2 });
    const inSandbox = await listCustomers(sandbox, { search: t });
    expect(inSandbox.rows.map((r) => r.email).sort()).toEqual([null, `${t.toLowerCase()}.one@example.com`].sort());
    expect((await listCustomers(live, { search: t })).total).toBe(0);
    await expect(runSandboxImport(sandbox, job.id)).rejects.toThrow(/already been imported/);
    await expect(dryRunImport(sandbox, job.id, MAPPING)).rejects.toThrow(/already been imported/);

    const liveJob = await runLiveImport(platform, live, job.id);
    expect(liveJob).toMatchObject({ environment: 'live', status: 'imported', importedCount: 2 });
    expect((await listCustomers(live, { search: t })).total).toBe(2);
    await expect(runLiveImport(platform, live, job.id)).rejects.toThrow(/already been imported into live/);

    const log = await listBusinessActivity(live, { search: t, limit: 20 });
    expect(log.rows.filter((r) => r.action === 'create' && r.entityType === 'core.customer')).toHaveLength(2);
    expect((await listBusinessActivity(live, { action: 'import' })).rows[0].summary).toContain('into LIVE');
    expect((await listImportJobs(platform)).filter((j) => j.filename === 'good.csv' && j.businessSlug === 'cp').length).toBeGreaterThanOrEqual(2);
  });

  it('an import is all-or-nothing: if any row fails while writing, no row is kept', async () => {
    const t = tag();
    const sandbox = await ctxFor(USERS.tech, 'cp', 'sandbox');
    const job = await createImportJob(sandbox, { entityKey: 'core.customer', filename: 'x.csv', bytes: csv(`First,Last\n${t},A\n${t},B\n${t},C\n`) });
    await dryRunImport(sandbox, job.id, { firstName: 'First', lastName: 'Last' });
    // Make the third row blow up when it is written (after two rows have already been inserted).
    const original = customerEntity.import!.toValues;
    let calls = 0;
    customerEntity.import!.toValues = (row) => {
      const values = original(row);
      calls += 1;
      // mapRows runs once for the check inside runSandboxImport; poison the third row's value.
      return row.lastName === 'C' ? { ...values, notes: 'cannot be stored \u0000' } : values;
    };
    try {
      await expect(runSandboxImport(sandbox, job.id)).rejects.toThrow();
    } finally {
      customerEntity.import!.toValues = original;
    }
    expect(calls).toBeGreaterThanOrEqual(3);
    expect((await listCustomers(sandbox, { search: t })).total).toBe(0);
    expect((await getImportJob(sandbox, job.id)).job.status).toBe('dry_run_ok');
  });

  it('three people clicking "import" at the same moment import the file once, in the sandbox and in live', async () => {
    const t = tag();
    const sandbox = await ctxFor(USERS.tech, 'cp', 'sandbox');
    const live = await ctxFor(USERS.tech, 'cp', 'live');
    const platform = await platformCtxFor(USERS.tech);
    const job = await createImportJob(sandbox, { entityKey: 'core.customer', filename: 'race.csv', bytes: csv(`First,Last\n${t},One\n${t},Two\n`) });
    await dryRunImport(sandbox, job.id, { firstName: 'First', lastName: 'Last' });

    const sandboxRuns = await Promise.allSettled([1, 2, 3].map(() => runSandboxImport(sandbox, job.id)));
    expect(sandboxRuns.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await listCustomers(sandbox, { search: t })).total).toBe(2);

    const liveRuns = await Promise.allSettled([1, 2, 3].map(() => runLiveImport(platform, live, job.id)));
    expect(liveRuns.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(liveRuns.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason instanceof ValidationError)).toBe(true);
    expect((await listCustomers(live, { search: t })).total).toBe(2);
  });

  it('re-checking with a different mapping while the sandbox import runs can never put an unchecked mapping into live', async () => {
    const t = tag();
    const sandbox = await ctxFor(USERS.tech, 'cp', 'sandbox');
    const live = await ctxFor(USERS.tech, 'cp', 'live');
    const platform = await platformCtxFor(USERS.tech);
    const rows = Array.from({ length: 40 }, (_, i) => `${t}First${i},${t}Alt${i},Last`).join('\n');
    const job = await createImportJob(sandbox, { entityKey: 'core.customer', filename: 'interleave.csv', bytes: csv(`First,Alt,Last\n${rows}\n`) });
    await dryRunImport(sandbox, job.id, { firstName: 'First', lastName: 'Last' });

    // The check starts a moment after the import, i.e. while the import is still writing rows.
    const [imported, rechecked] = await Promise.allSettled([
      runSandboxImport(sandbox, job.id),
      new Promise((resolve) => setTimeout(resolve, 15)).then(() => dryRunImport(sandbox, job.id, { firstName: 'Alt', lastName: 'Last' })),
    ]);
    expect(imported.status).toBe('fulfilled');
    // The check waited for the import and was then refused: the job keeps the mapping that went in.
    expect(rechecked.status).toBe('rejected');
    expect((rechecked as PromiseRejectedResult).reason).toBeInstanceOf(ValidationError);
    const after = (await getImportJob(sandbox, job.id)).job;
    expect(after.status).toBe('imported');
    expect(after.mapping).toEqual({ firstName: 'First', lastName: 'Last' });

    await runLiveImport(platform, live, job.id);
    expect((await listCustomers(live, { search: `${t}First`, limit: 100 })).total).toBe(40);
    expect((await listCustomers(live, { search: `${t}Alt`, limit: 100 })).total).toBe(0);
  });

  it('files that cannot be read cleanly are refused with a plain message', () => {
    expect(() => parseCsv(csv('First,Last\nA\u0000,B\n'))).toThrow(/cannot be read/);
    expect(() => parseCsv(new Uint8Array([70, 105, 114, 115, 116, 10, 0xff, 0xfe, 10]))).toThrow(/cannot be read/);
    expect(() => parseCsv(csv('First,Last\n"unclosed,B\n'))).toThrow(/well-formed/);
  });

  it('another business cannot see the job', async () => {
    const cp = await ctxFor(USERS.tech, 'cp', 'sandbox');
    const job = await createImportJob(cp, { entityKey: 'core.customer', filename: 'mine.csv', bytes: csv('First,Last\nA,B\n') });
    const other = await ctxFor(USERS.tech, 'brm', 'sandbox');
    await expect(getImportJob(other, job.id)).rejects.toThrow();
    await expect(runSandboxImport(other, job.id)).rejects.toThrow();
  });
});

describe('CSV export', () => {
  it('needs the export permission, is logged, and neutralises spreadsheet formulas', async () => {
    const admin = await ctxFor(USERS.brssAdmin, 'brss');
    const { columns, rows } = await exportRecords(admin, customerEntity, {});
    expect(columns[0].key).toBe('id');
    expect(rows.length).toBeGreaterThanOrEqual(12);
    expect(rows.every((r) => r.businessId === admin.business.id && r.environment === 'live')).toBe(true);
    const [entry] = (await listBusinessActivity(admin, { action: 'export' })).rows;
    expect(entry).toMatchObject({ entityType: 'core.customer', actorRole: 'business_admin' });
    await expect(exportRecords(await ctxFor(USERS.executive, 'brss'), customerEntity, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(exportRecords(await ctxFor(USERS.brssStaff, 'brss'), customerEntity, {})).rejects.toBeInstanceOf(ForbiddenError);
    expect(safeCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(safeCell(-25)).toBe('-25'); // a negative number is not a formula
    expect(safeCell('-2+3')).toBe("'-2+3");
    expect(exportCell(12345, 'money')).toBe('123.45');
    expect(exportCell(true, 'boolean')).toBe('Yes');
    expect(safeCell('+1 607')).toBe("'+1 607");
    expect(safeCell('plain')).toBe('plain');
    expect(safeCell(null)).toBe('');
  });
});

describe('executive dashboard', () => {
  it('has a row per business, totals that add up, and only live data', async () => {
    const exec = await platformCtxFor(USERS.executive);
    const before = await executiveDashboard(exec, 30);
    expect(before.rows).toHaveLength(SEED_BUSINESSES.length);
    expect(before.totals.revenueCents).toBe(before.rows.reduce((sum, r) => sum + r.revenueCents, 0));
    expect(before.totalTrend.reduce((sum, p) => sum + p.value, 0)).toBeGreaterThan(0);

    const sandbox = await ctxFor(USERS.tech, 'tut', 'sandbox');
    const live = await ctxFor(USERS.tech, 'tut', 'live');
    await withScope(sandbox, 'payments.write', (s) => takePayment(s, { amountCents: 500_000, description: 'sandbox', idempotencyKey: `exec-s-${Date.now()}` }));
    await withScope(live, 'payments.write', (s) => takePayment(s, { amountCents: 12_300, description: 'live', idempotencyKey: `exec-l-${Date.now()}` }));
    const after = await executiveDashboard(exec, 30);
    const row = (d: typeof after) => d.rows.find((r) => r.slug === 'tut')!;
    expect(row(after).revenueCents - row(before).revenueCents).toBe(12_300);
    expect(after.totals.revenueCents - before.totals.revenueCents).toBe(12_300);
    expect(row(after).trend.at(-1)).toBeGreaterThanOrEqual(12_300);
  });

  it('is for platform roles only', async () => {
    await expect(executiveDashboard(await platformCtxFor(USERS.brssAdmin), 30)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await executiveDashboard(await platformCtxFor(USERS.tech), 90)).bucket).toBe('week');
  });
});

describe('registry report, health and small helpers', () => {
  it('the module registry report lists every seeded business', async () => {
    const report = await moduleRegistryReport(await platformCtxFor(USERS.tech));
    expect(report.installed.map((r) => r.code)).toEqual(SEED_BUSINESSES.map((b) => b.code));
    await expect(moduleRegistryReport(await platformCtxFor(USERS.executive))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('health checks pass for the database and are tech-only', async () => {
    const groups = await runHealthChecks(await platformCtxFor(USERS.tech));
    const database = groups.find((g) => g.title === 'Database')!;
    expect(database.checks.every((c) => c.ok), JSON.stringify(database.checks)).toBe(true);
    await expect(runHealthChecks(await platformCtxFor(USERS.executive))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('the sandbox summary counts sandbox rows only', async () => {
    const summary = await sandboxSummary(await ctxFor(USERS.brssAdmin, 'brss'));
    expect(summary.counts.find((c) => c.entityKey === 'core.customer')!.rows).toBeGreaterThanOrEqual(12);
    await expect(sandboxSummary(await ctxFor(USERS.executive, 'brss'))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('portal routes match paths and capture parameters', () => {
    const page = () => null;
    const portal = { nav: [], routes: [{ path: '', title: 'Home', permission: 'p', component: page }, { path: 'orders/:id', title: 'Order', permission: 'p', component: page }, { path: 'orders/new', title: 'New', permission: 'p', component: page }] };
    expect(matchRoute(portal, [])?.route.title).toBe('Home');
    expect(matchRoute(portal, ['orders', '42'])).toMatchObject({ route: { title: 'Order' }, params: { id: '42' } });
    expect(matchRoute(portal, ['orders'])).toBeNull();
    expect(matchRoute(portal, ['nope', 'x', 'y'])).toBeNull();
  });
});

describe('the activity log, for staff who were granted it', () => {
  it('shows only entries about records they may read; admins and executives see everything', async () => {
    const admin = await ctxFor(USERS.brssAdmin, 'brss');
    const marker = `Vis${Date.now()}`;
    // A customer entry, a payment entry and a people entry, all carrying the marker.
    const membershipId = await addMember(admin, { name: `${marker} Staffer`, email: `${marker.toLowerCase()}@sai.example`, role: 'business_staff' });
    const { createCustomer } = await import('@/core/customers/customers');
    await createCustomer(admin, { firstName: marker, lastName: 'Customer' });
    await withScope(admin, 'payments.write', (s) => takePayment(s, { amountCents: 4321, description: `${marker} payment`, idempotencyKey: `vis-${Date.now()}` }));

    await setMemberPermissions(admin, membershipId, ['business.activity.read', 'customers.read']);
    const member = (await listMembers(admin)).find((m) => m.membershipId === membershipId)!;
    const staff = await buildBusinessContext(member.userId, 'brss', 'live');

    const typesSeenBy = async (ctx: typeof staff) => new Set((await listBusinessActivity(ctx, { search: marker, limit: 100 })).rows.map((r) => r.entityType));
    expect([...(await typesSeenBy(staff))]).toEqual(['core.customer']);
    // Asking for payment entries by name does not get round it.
    expect((await listBusinessActivity(staff, { entityType: 'core.payment' })).total).toBe(0);
    expect((await listBusinessActivity(staff, { entityType: 'membership' })).total).toBe(0);
    // Numbers counted from the log follow the same rule: the Overview count is what they could list.
    const week = lastDays(7, new Date(Date.now() + 60_000));
    const listed = (await listBusinessActivity(staff, { from: week.from, to: week.to })).total;
    expect(await withScope(staff, 'business.activity.read', (s) => activityCount(s, week))).toBe(listed);
    expect(await withScope(admin, 'business.activity.read', (s) => activityCount(s, week))).toBeGreaterThan(listed);

    // Admins and executives see every kind of entry.
    for (const ctx of [admin, await ctxFor(USERS.executive, 'brss')]) {
      for (const type of ['core.customer', 'core.payment', 'membership']) {
        expect((await listBusinessActivity(ctx, { entityType: type })).total, `${ctx.role}:${type}`).toBeGreaterThan(0);
      }
    }
    await removeMember(admin, membershipId);
  });
});

describe('activity log date filters', () => {
  it('"From" and "To" are whole days in Ithaca time, including the days the clocks change', () => {
    const range = (from: string, to: string) => {
      const { filters } = parseActivitySearch({ from, to });
      return [filters.from?.toISOString(), filters.to?.toISOString()];
    };
    // An ordinary winter day: midnight to midnight, UTC-5.
    expect(range('2026-01-15', '2026-01-15')).toEqual(['2026-01-15T05:00:00.000Z', '2026-01-16T05:00:00.000Z']);
    // Clocks go forward on 8 March 2026: the day is 23 hours long.
    expect(range('2026-03-08', '2026-03-08')).toEqual(['2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z']);
    // Clocks go back on 1 November 2026: the day is 25 hours long.
    expect(range('2026-11-01', '2026-11-01')).toEqual(['2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z']);
    // A date that does not exist is ignored, not moved to another day.
    expect(range('2026-02-30', '2026-02-30')).toEqual([undefined, undefined]);
    // So is a mistyped year.
    expect(range('0026-01-15', '9999-12-31')).toEqual([undefined, undefined]);
  });
});
