/**
 * HHMC dashboard: the date range, and "click any number to see the people and jobs behind it".
 * Every headline number must equal its list: the row count for a count, the footer total for
 * money. Runs against the shared database, so it checks the lists against the numbers rather
 * than fixed totals, plus one known move whose rows it looks for.
 */
import { describe, expect, it } from 'vitest';
import { withScope } from '@/core/db/scope';
import { ForbiddenError } from '@/core/errors';
import { buildLinkContext } from '@/core/links/links';
import type { BusinessContext } from '@/core/tenancy/context';
import { P } from '@/modules/hhmc/permissions';
import { addDays, localDate } from '@/modules/hhmc/rules';
import {
  DASHBOARD_LISTS,
  dashboardList,
  dashboardSummary,
  estimateFunnel,
  invoiceTotals,
  leadsThisMonth,
  listTotals,
  parseRange,
  presetRange,
  type DashboardList,
  type DashboardRange,
} from '@/modules/hhmc/services/dashboard';
import { customerLinkFor, openEstimateByLink, payDepositByLink, sendEstimate, signEstimateByLink } from '@/modules/hhmc/services/estimates';
import { createInvoice, recordInvoicePayment, sendInvoice } from '@/modules/hhmc/services/invoices';
import { bookJob } from '@/modules/hhmc/services/booking';
import { convertLead, createLead } from '@/modules/hhmc/services/leads';
import { addQuoteLine, setQuoteOptions } from '@/modules/hhmc/services/quote';
import { USERS, ctxFor } from './helpers';

const TZ = 'America/New_York';
let counter = 0;
const tag = () => `${Date.now().toString(36)}${(counter += 1)}`;
const admin = () => ctxFor(USERS.hhmcAdmin, 'hhmc', 'live');
const today = () => localDate(new Date(), TZ);

type Summary = Awaited<ReturnType<typeof dashboardSummary>>;

/** The headline number a list stands behind: [rows it must have, money its footer must show]. */
function headline(summary: Summary, list: DashboardList): { count: number | null; amountCents?: number | null; balanceCents?: number | null } {
  switch (list) {
    case 'leads':
      return { count: summary.leads?.count ?? null };
    case 'converted':
      return { count: summary.leads?.converted ?? null };
    case 'sent':
      return { count: summary.estimates.sent };
    case 'viewed':
      return { count: summary.estimates.viewed };
    case 'signed':
      return { count: summary.estimates.signed };
    case 'booked':
      return { count: summary.booked.count, amountCents: summary.booked.amountCents };
    case 'moves':
      return { count: summary.moves };
    case 'invoiced':
      return { count: summary.invoicedCount, amountCents: summary.invoicedCents };
    case 'collected':
      return { count: summary.collectedCount, amountCents: summary.collectedCents };
    case 'open':
      return { count: summary.open?.count ?? null, balanceCents: summary.open?.cents ?? null };
    case 'past_due':
      return { count: summary.pastDue?.count ?? null, balanceCents: summary.pastDue?.cents ?? null };
  }
}

/** Summary and every list read in one transaction, so nothing lands in between. */
async function summaryAndLists(ctx: BusinessContext, range: DashboardRange) {
  return withScope(ctx, P.jobsRead, async (s) => {
    const summary = await dashboardSummary(s, range);
    const lists = {} as Record<DashboardList, Awaited<ReturnType<typeof dashboardList>>>;
    for (const list of DASHBOARD_LISTS) lists[list] = await dashboardList(s, list, range);
    return { summary, lists };
  });
}

function expectListsMatch(summary: Summary, lists: Record<DashboardList, Awaited<ReturnType<typeof dashboardList>>>) {
  for (const list of DASHBOARD_LISTS) {
    const want = headline(summary, list);
    const { rows, totals } = lists[list];
    expect(rows.length, `${list}: rows`).toBe(want.count);
    expect(totals.count, `${list}: footer count`).toBe(want.count);
    if (want.amountCents !== undefined) expect(totals.amountCents, `${list}: footer amount`).toBe(want.amountCents);
    if (want.balanceCents !== undefined) expect(totals.balanceCents, `${list}: footer balance`).toBe(want.balanceCents);
    // The footer is the sum of the rows shown.
    expect(listTotals(rows)).toEqual(totals);
  }
}

/**
 * One known move, all today: lead → job (Example A, $682.50 base, card fee on) → estimate sent,
 * viewed, signed → $141.96 card deposit ($136.50 base + fee) → booked → invoice sent ($682.50)
 * → $100 cash. Balance left: $682.50 − $136.50 − $100 = $446.00.
 */
async function knownMove(ctx: BusinessContext) {
  const t = tag();
  // Spread over many days so repeated runs do not run out of trucks on one date.
  const moveDate = addDays(today(), 10 + Math.floor(Math.random() * 40));
  const lead = await createLead(ctx, {
    firstName: 'Dana',
    lastName: `Dashboard${t}`,
    email: `dana.${t}@example.com`,
    source: 'Cornellian',
    moveDate,
    originAddress: '1 Test St, Ithaca, NY',
    destinationAddress: '2 Test St, Ithaca, NY',
  });
  const { job } = await convertLead(ctx, lead.id, { serviceType: 'local', jobType: 'Local Full Service Move', crewSize: 2, trucks: 1 });
  const catalog = await withScope(ctx, P.catalogRead, async (s) => {
    const { hhmcCatalogItems } = await import('@/modules/hhmc/schema');
    return s.db.select().from(hhmcCatalogItems).where(s.where(hhmcCatalogItems));
  });
  const men = catalog.find((c) => c.name === '2 Men')!;
  await addQuoteLine(ctx, job.id, { section: 'transportation_labor', catalogItemId: men.id, qty: '2.5' });
  await setQuoteOptions(ctx, job.id, { serviceTaxOn: false, convenienceFeeOn: true });
  const estimate = await sendEstimate(ctx, job.id);
  const customer = await buildLinkContext((await customerLinkFor(ctx, estimate.id)).split('/l/')[1]);
  await openEstimateByLink(customer);
  await signEstimateByLink(customer, { valuationInitials: 'DD', signatureName: 'Dana Dashboard', agree: true, ip: null, userAgent: null });
  const deposit = await payDepositByLink(customer, { attemptKey: `d${tag()}x` });
  if (!deposit.ok) throw new Error(deposit.message);
  await bookJob(ctx, job.id);
  const invoice = await createInvoice(ctx, job.id);
  await sendInvoice(ctx, invoice.id);
  const cash = await recordInvoicePayment(ctx, invoice.id, { amount: '100', method: 'cash', attemptKey: `c${tag()}x` });
  if (!cash.ok) throw new Error(cash.message);
  return { lead, job, estimate, invoice, depositPayment: deposit.payment, cashPayment: cash.payment, moveDate };
}

describe('dashboard date range', () => {
  it('presets follow the business calendar in America/New_York', () => {
    // 03:00 UTC on Dec 1 is still Nov 30 in New York.
    const now = new Date('2026-12-01T03:00:00Z');
    expect(presetRange('this_month', now, TZ)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(presetRange('last_month', now, TZ)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('this_year', now, TZ)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(presetRange('last_12_months', now, TZ)).toEqual({ from: '2025-12-01', to: '2026-11-30' });
    expect(presetRange('all', now, TZ)).toEqual({ from: null, to: null });
    // January: last month is December of the year before.
    expect(presetRange('last_month', new Date('2026-01-15T12:00:00Z'), TZ)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('reads ?from&to, defaults to this month, swaps a backwards range and names a matching preset', () => {
    const now = new Date('2026-11-11T15:00:00Z');
    expect(parseRange({}, now, TZ)).toEqual({ range: { from: '2026-11-01', to: '2026-11-30' }, preset: 'this_month' });
    expect(parseRange({ from: 'nonsense', to: '2026-02-30' }, now, TZ).preset).toBe('this_month');
    expect(parseRange({ range: 'all' }, now, TZ)).toEqual({ range: { from: null, to: null }, preset: 'all' });
    expect(parseRange({ from: '2026-10-01', to: '2026-10-31' }, now, TZ).preset).toBe('last_month');
    expect(parseRange({ from: '2026-10-20', to: '2026-10-05' }, now, TZ)).toEqual({ range: { from: '2026-10-05', to: '2026-10-20' }, preset: null });
    expect(parseRange({ from: '2026-10-05' }, now, TZ)).toEqual({ range: { from: '2026-10-05', to: null }, preset: null });
  });
});

describe('dashboard: every number opens the records behind it', () => {
  it('each list has exactly as many rows as its number, and its footer adds up to its money', async () => {
    const ctx = await admin();
    await knownMove(ctx);
    const ranges: DashboardRange[] = [
      { from: today(), to: addDays(today(), 60) },
      presetRange('this_month', new Date(), TZ),
      presetRange('last_12_months', new Date(), TZ),
      { from: null, to: null },
    ];
    for (const range of ranges) {
      const { summary, lists } = await summaryAndLists(ctx, range);
      expectListsMatch(summary, lists);
    }
  });

  it('the known move shows up with its name, move date, amount and paid state in every list', async () => {
    const ctx = await admin();
    const move = await knownMove(ctx);
    const range = { from: today(), to: addDays(today(), 60) };
    const { summary, lists } = await summaryAndLists(ctx, range);
    expectListsMatch(summary, lists);
    const name = `Dana ${move.lead.lastName}`;
    const partly = { state: 'partly_paid', balanceCents: 44600 };

    const lead = lists.leads.rows.find((r) => r.id === move.lead.id)!;
    expect(lead).toMatchObject({ customerName: name, moveDate: move.moveDate, jobId: move.job.id, amountCents: 68250, paid: partly, href: { kind: 'lead', id: move.lead.id } });
    expect(lists.converted.rows.some((r) => r.id === move.lead.id)).toBe(true);

    for (const list of ['sent', 'viewed', 'signed'] as const) {
      const row = lists[list].rows.find((r) => r.id === move.estimate.id);
      expect(row, list).toMatchObject({ customerName: name, amountCents: 68250, paid: partly, href: { kind: 'job', id: move.job.id } });
    }

    const booked = lists.booked.rows.find((r) => r.id === move.job.id)!;
    expect(booked).toMatchObject({ customerName: name, moveDate: move.moveDate, amountCents: 68250, paid: partly, date: today() });
    expect(lists.moves.rows.find((r) => r.id === move.job.id)).toMatchObject({ amountCents: 68250, paid: partly });

    expect(lists.invoiced.rows.find((r) => r.id === move.invoice.id)).toMatchObject({
      customerName: name,
      amountCents: 68250,
      paid: partly,
      href: { kind: 'invoice', id: move.invoice.id },
    });
    expect(lists.open.rows.find((r) => r.id === move.invoice.id)).toMatchObject({ paid: partly });
    // Due on receipt today: open, not yet past due.
    expect(lists.past_due.rows.some((r) => r.id === move.invoice.id)).toBe(false);

    // Collected: what the customer paid, card fee included.
    const payments = lists.collected.rows.filter((r) => r.jobId === move.job.id);
    expect(payments.map((r) => r.amountCents).sort((a, b) => a! - b!)).toEqual([10000, 14196]);
    expect(payments.find((r) => r.id === move.cashPayment.id)).toMatchObject({ href: { kind: 'invoice', id: move.invoice.id }, status: { kind: 'payment', label: 'Cash' } });
    expect(payments.find((r) => r.id === move.depositPayment.id)).toMatchObject({ href: { kind: 'job', id: move.job.id } });

    // Source and month filters narrow a list; the by-source row matches its filtered list.
    const bySource = summary.bySource.find((r) => r.source === 'Cornellian')!;
    const filtered = await withScope(ctx, P.jobsRead, (s) => dashboardList(s, 'booked', range, { source: 'Cornellian' }));
    expect(filtered.rows.length).toBe(bySource.booked);
    expect(filtered.totals.amountCents).toBe(bySource.bookedCents);
    expect(filtered.rows.every((r) => r.source === 'Cornellian')).toBe(true);
    const month = today().slice(0, 7);
    const byMonth = summary.byMonth.find((m) => m.month === month)!;
    const inMonth = await withScope(ctx, P.jobsRead, async (s) => ({
      leads: await dashboardList(s, 'leads', range, { month }),
      collected: await dashboardList(s, 'collected', range, { month }),
    }));
    expect(inMonth.leads.rows.length).toBe(byMonth.leads);
    expect(inMonth.collected.totals.amountCents).toBe(byMonth.collectedCents);
  });

  it('a range ending yesterday leaves out what happened today (business time zone)', async () => {
    const ctx = await admin();
    const move = await knownMove(ctx);
    const range = { from: addDays(today(), -30), to: addDays(today(), -1) };
    const { summary, lists } = await summaryAndLists(ctx, range);
    expectListsMatch(summary, lists);
    expect(lists.leads.rows.some((r) => r.id === move.lead.id)).toBe(false);
    expect(lists.invoiced.rows.some((r) => r.id === move.invoice.id)).toBe(false);
    expect(lists.collected.rows.some((r) => r.jobId === move.job.id)).toBe(false);
    // Open balance is "as of today", whatever the range.
    expect(lists.open.rows.some((r) => r.id === move.invoice.id)).toBe(true);
  });

  it('the Overview widgets agree with the dashboard for this month', async () => {
    const ctx = await admin();
    const range = presetRange('this_month', new Date(), TZ);
    const r = await withScope(ctx, P.jobsRead, async (s) => ({
      summary: await dashboardSummary(s, range),
      leads: await leadsThisMonth(s),
      funnel: await estimateFunnel(s),
      invoices: await invoiceTotals(s),
    }));
    expect(r.leads.leads).toBe(r.summary.leads!.count);
    expect(r.leads.converted).toBe(r.summary.leads!.converted);
    expect(r.funnel).toEqual(r.summary.estimates);
    expect(r.invoices.openCents).toBe(r.summary.open!.cents);
    expect(r.invoices.pastDueCents).toBe(r.summary.pastDue!.cents);
    expect(r.invoices.pastDueCount).toBe(r.summary.pastDue!.count);
  });
});

describe('dashboard permissions', () => {
  it('money needs the invoice permission, payments collected also the payments permission', async () => {
    const ctx = await admin();
    const without = (ctx: BusinessContext, ...remove: string[]): BusinessContext => ({
      ...ctx,
      permissions: new Set([...ctx.permissions].filter((p) => !remove.includes(p))),
    });
    const range = presetRange('this_month', new Date(), TZ);

    const noPayments = without(ctx, 'payments.read');
    const a = await withScope(noPayments, P.jobsRead, (s) => dashboardSummary(s, range));
    expect(a.collectedCents).toBeNull();
    expect(a.invoicedCents).not.toBeNull();
    await expect(withScope(noPayments, P.jobsRead, (s) => dashboardList(s, 'collected', range))).rejects.toBeInstanceOf(ForbiddenError);

    const noMoney = without(ctx, P.invoicesRead);
    const b = await withScope(noMoney, P.jobsRead, (s) => dashboardSummary(s, range));
    expect(b.invoicedCents).toBeNull();
    expect(b.open).toBeNull();
    expect(b.booked.amountCents).toBeNull();
    expect(b.bySource.every((r) => r.bookedCents === null)).toBe(true);
    await expect(withScope(noMoney, P.jobsRead, (s) => dashboardList(s, 'open', range))).rejects.toBeInstanceOf(ForbiddenError);
    // Lists without money still open, with the amounts and paid state left out.
    const booked = await withScope(noMoney, P.jobsRead, (s) => dashboardList(s, 'booked', range));
    expect(booked.rows.every((r) => r.amountCents === null && r.paid === null)).toBe(true);

    const noLeads = without(ctx, P.leadsRead);
    const c = await withScope(noLeads, P.jobsRead, (s) => dashboardSummary(s, range));
    expect(c.leads).toBeNull();
    await expect(withScope(noLeads, P.jobsRead, (s) => dashboardList(s, 'leads', range))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('another mode sees none of the known move', async () => {
    const live = await admin();
    const move = await knownMove(live);
    const sandbox = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'sandbox');
    const range = { from: addDays(today(), -1), to: addDays(today(), 60) };
    const { lists } = await summaryAndLists(sandbox, range);
    for (const list of DASHBOARD_LISTS) expect(lists[list].rows.some((r) => r.jobId === move.job.id || r.id === move.lead.id)).toBe(false);
  });
});
