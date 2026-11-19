/**
 * How long each Hired Hands screen takes to load its data from the LOCAL database, as the HHMC
 * general manager (the seed user hhmc.admin@sai.example):  npm run hhmc:perf
 *
 * Run it after `npm run hhmc:import:real` (or the fake full-scale exports from
 * scripts/hhmc-import/generate-fake-exports.ts) to check every screen stays fast with all of
 * HHMC's history. Each screen is loaded 5 times; the median is printed. Reads only.
 */
import { loadEnv } from './lib/env';

const SLOW_MS = 500;

async function main() {
  loadEnv();
  const { isLocalDatabaseUrl } = await import('../src/core/demo/pilot');
  if (!isLocalDatabaseUrl(process.env.DATABASE_URL)) throw new Error('Refusing: hhmc:perf reads the local database only.');
  const { getDb, closeDb } = await import('../src/core/db/client');
  const { users } = await import('../src/core/db/schema');
  const { eq, desc, and, inArray } = await import('drizzle-orm');
  const { buildBusinessContext } = await import('../src/core/tenancy/context');
  const { withScope } = await import('../src/core/db/scope');
  const { hhmcJobs, hhmcLeads, hhmcInvoices } = await import('../src/modules/hhmc/schema');
  const { P } = await import('../src/modules/hhmc/permissions');
  const dashboard = await import('../src/modules/hhmc/services/dashboard');
  const { calendarBetween } = await import('../src/modules/hhmc/services/calendar');
  const { listContacts, listEstimates, contactPage } = await import('../src/modules/hhmc/services/directory');
  const { listJobs } = await import('../src/modules/hhmc/services/jobs');
  const { listLeads } = await import('../src/modules/hhmc/services/leads');
  const { listInvoices } = await import('../src/modules/hhmc/services/invoices');
  const { jobPage, leadPage, invoicePage } = await import('../src/modules/hhmc/services/views');
  const { scheduleBetween } = await import('../src/modules/hhmc/services/booking');
  const { searchHhmc } = await import('../src/modules/hhmc/services/search');

  const [gm] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, 'hhmc.admin@sai.example')).limit(1);
  if (!gm) throw new Error('The seed user hhmc.admin@sai.example is missing (npm run db:seed).');
  const ctx = await buildBusinessContext(gm.id, 'hhmc', 'live');
  const tz = ctx.business.timeZone;
  const now = new Date();

  // A busy month (the one with the most booked moves) and the records with the most attached.
  const sample = await withScope(ctx, P.jobsRead, async (s) => ({
    jobs: await s.db.select({ id: hhmcJobs.id, moveDate: hhmcJobs.moveDate, customerId: hhmcJobs.customerId }).from(hhmcJobs).where(and(s.where(hhmcJobs), inArray(hhmcJobs.stage, ['closed', 'completed', 'booked']))).orderBy(desc(hhmcJobs.moveDate)).limit(2000),
    lead: (await s.db.select({ id: hhmcLeads.id }).from(hhmcLeads).where(s.where(hhmcLeads)).limit(1))[0],
    invoice: (await s.db.select({ id: hhmcInvoices.id }).from(hhmcInvoices).where(s.where(hhmcInvoices)).limit(1))[0],
  }));
  const counts = new Map<string, number>();
  for (const j of sample.jobs) if (j.moveDate) counts.set(j.moveDate.slice(0, 7), (counts.get(j.moveDate.slice(0, 7)) ?? 0) + 1);
  const busiest = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? now.toISOString().slice(0, 7);
  const monthFrom = `${busiest}-01`;
  const monthTo = new Date(Date.UTC(Number(busiest.slice(0, 4)), Number(busiest.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const job = sample.jobs[0];

  const screens: [string, () => Promise<unknown>][] = [
    ['Dashboard · this month', () => withScope(ctx, P.jobsRead, (s) => dashboard.dashboardSummary(s, dashboard.presetRange('this_month', now, tz), now))],
    ['Dashboard · all time', () => withScope(ctx, P.jobsRead, (s) => dashboard.dashboardSummary(s, { from: null, to: null }, now))],
    ['Dashboard list · revenue invoiced, all time', () => withScope(ctx, P.jobsRead, (s) => dashboard.dashboardList(s, 'invoiced', { from: null, to: null }, {}, now))],
    ['Dashboard list · payments collected, all time', () => withScope(ctx, P.jobsRead, (s) => dashboard.dashboardList(s, 'collected', { from: null, to: null }, {}, now))],
    ['Leads (all)', () => listLeads(ctx, {})],
    ['Leads · search', () => listLeads(ctx, { q: 'ann' })],
    ['Estimates (all)', () => listEstimates(ctx, { status: 'all' })],
    ['Estimates · search', () => listEstimates(ctx, { status: 'all', q: 'ann' })],
    ['Work requests (open)', () => listJobs(ctx, {})],
    ['Work requests (all) · search', () => listJobs(ctx, { stage: 'all', q: 'ann' })],
    ['Contacts', () => listContacts(ctx, {})],
    ['Contacts · search', () => listContacts(ctx, { q: 'ann' })],
    ['Invoices (all)', () => listInvoices(ctx, {}, now)],
    ['Search · a name', () => searchHhmc(ctx, 'sage', '/x')],
    ['Search · a phone', () => searchHhmc(ctx, '607 555 01', '/x')],
    ['Search · a number', () => searchHhmc(ctx, 'IN70100', '/x')],
    ['Search · no match', () => searchHhmc(ctx, 'zzzz', '/x')],
    [`Calendar · busiest month (${busiest})`, () => calendarBetween(ctx, monthFrom, monthTo)],
    [`Schedule capacity · busiest month (${busiest})`, () => scheduleBetween(ctx, monthFrom, monthTo)],
    ...(job ? ([['Work request page', () => jobPage(ctx, job.id)], ['Contact page', () => contactPage(ctx, job.customerId)]] as [string, () => Promise<unknown>][]) : []),
    ...(sample.lead ? ([['Lead page', () => leadPage(ctx, sample.lead.id)]] as [string, () => Promise<unknown>][]) : []),
    ...(sample.invoice ? ([['Invoice page', () => invoicePage(ctx, sample.invoice.id)]] as [string, () => Promise<unknown>][]) : []),
  ];

  const results: { name: string; ms: number }[] = [];
  for (const [name, load] of screens) {
    await load(); // warm-up
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await load();
      times.push(performance.now() - t0);
    }
    results.push({ name, ms: times.sort((a, b) => a - b)[2] });
  }
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) console.log(`${r.name.padEnd(width)}  ${r.ms.toFixed(0).padStart(6)} ms${r.ms > SLOW_MS ? '  ⚠ slow' : ''}`);
  const slow = results.filter((r) => r.ms > SLOW_MS);
  console.log(slow.length ? `\n${slow.length} screen(s) over ${SLOW_MS} ms.` : `\nEvery screen under ${SLOW_MS} ms.`);
  await closeDb();
  if (slow.length && process.argv.includes('--strict')) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
