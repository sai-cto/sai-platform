/**
 * Dashboard numbers (prompt "Dashboard widgets"; ref §3.1, §8 "metrics the rebuild needs";
 * managers: "pick a date range and see how we're doing", "click any number to see the people
 * and jobs behind it").
 *
 * Every headline number is computed from the same rows its list shows: a number is
 * `rows.length` (or a sum over the rows, `listTotals`) of `dashboardList(…)` with the same
 * range. So the table behind a number always has that many rows and adds up to that money.
 *
 * Each function takes a Scope and checks its own permission (ARCHITECTURE: "read helpers that
 * take a scope check their own permission too").
 */
import { and, Column, desc, is, eq, gte, inArray, isNotNull, lt, lte, min, ne, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { customers, payments } from '@/core/db/schema/tenant';
import type { Scope } from '@/core/db/scope';
import { authorize, can } from '@/core/rbac/permissions';
import { estimateEntity, invoiceEntity, jobEntity } from '../entities';
import { CORE, P } from '../permissions';
import { addDays, isDateText, isPastDue, localDate, localTime } from '../rules';
import {
  hhmcEstimates,
  hhmcInvoices,
  hhmcJobs,
  hhmcLeads,
  LEAD_SOURCES,
  type EstimateStatus,
  type InvoiceStatus,
  type LeadStatus,
  type Stage,
} from '../schema';
import { money, personName } from './common';
import { balanceDueCents, baseTotalCents } from './pricing';

// ---------------------------------------------------------------- the date range

/** Inclusive local days in the business's time zone ("yyyy-mm-dd"); null = open-ended. */
export type DashboardRange = { from: string | null; to: string | null };

export const RANGE_PRESETS = ['this_month', 'last_month', 'this_year', 'last_12_months', 'all'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  this_year: 'This year',
  last_12_months: 'Last 12 months',
  all: 'All time',
};

function firstOfMonth(day: string, monthsBack = 0): string {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - monthsBack, 1)).toISOString().slice(0, 10);
}

function lastOfMonth(day: string): string {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * The preset ranges, by the business's calendar. "This month" and "This year" run to their last
 * day (so moves booked later this month are in); "Last 12 months" is this month and the 11
 * before it, whole months.
 */
export function presetRange(preset: RangePreset, now: Date, timeZone: string): DashboardRange {
  const today = localDate(now, timeZone);
  switch (preset) {
    case 'this_month':
      return { from: firstOfMonth(today), to: lastOfMonth(today) };
    case 'last_month': {
      const from = firstOfMonth(today, 1);
      return { from, to: lastOfMonth(from) };
    }
    case 'this_year':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case 'last_12_months':
      return { from: firstOfMonth(today, 11), to: lastOfMonth(today) };
    case 'all':
      return { from: null, to: null };
  }
}

/**
 * The range from the page's query: ?from=yyyy-mm-dd&to=yyyy-mm-dd (either may be left out for
 * an open end), ?range=all for all time, nothing (or nothing valid) for this month.
 */
export function parseRange(
  query: { from?: string; to?: string; range?: string },
  now: Date,
  timeZone: string,
): { range: DashboardRange; preset: RangePreset | null } {
  if (query.range === 'all') return { range: { from: null, to: null }, preset: 'all' };
  let from = query.from && isDateText(query.from) ? query.from : null;
  let to = query.to && isDateText(query.to) ? query.to : null;
  if (!from && !to) return { range: presetRange('this_month', now, timeZone), preset: 'this_month' };
  if (from && to && from > to) [from, to] = [to, from];
  const preset = RANGE_PRESETS.find((p) => {
    const r = presetRange(p, now, timeZone);
    return r.from === from && r.to === to;
  });
  return { range: { from, to }, preset: preset ?? null };
}

/** The query values that name a range (for links). */
export function rangeQuery(range: DashboardRange): Record<string, string | undefined> {
  if (!range.from && !range.to) return { range: 'all' };
  return { from: range.from ?? undefined, to: range.to ?? undefined };
}

type Bounds = { from: string | null; to: string | null; startAt: Date | null; endAt: Date | null };

function boundsOf(range: DashboardRange, timeZone: string): Bounds {
  return {
    from: range.from,
    to: range.to,
    // Local midnight at the start of `from` up to (not including) local midnight after `to`.
    startAt: range.from ? localTime(range.from, '00:00', timeZone) : null,
    endAt: range.to ? localTime(addDays(range.to, 1), '00:00', timeZone) : null,
  };
}

/** A timestamp column (or expression) inside the range. */
function atIn(column: SQLWrapper, b: Bounds): SQL | undefined {
  // A raw SQL expression (not a table column) has no type to bind a Date with: send ISO text.
  const at = (d: Date) => (is(column, Column) ? d : sql`${d.toISOString()}::timestamptz`);
  return and(b.startAt ? gte(column, at(b.startAt)) : undefined, b.endAt ? lt(column, at(b.endAt)) : undefined);
}

/** A date column inside the range. */
function dayIn(column: SQLWrapper, b: Bounds): SQL | undefined {
  return and(b.from ? gte(column, b.from) : undefined, b.to ? lte(column, b.to) : undefined);
}

// ---------------------------------------------------------------- the rows behind the numbers

export const DASHBOARD_LISTS = [
  'leads',
  'converted',
  'sent',
  'viewed',
  'signed',
  'booked',
  'moves',
  'invoiced',
  'collected',
  'open',
  'past_due',
] as const;
export type DashboardList = (typeof DASHBOARD_LISTS)[number];

export type PaidState = 'paid' | 'partly_paid' | 'unpaid' | 'none';

export type DashboardRow = {
  id: string;
  /** Lead, estimate, invoice or payment reference shown in the table. */
  reference: string;
  /** The page the row links to. */
  href: { kind: 'lead' | 'job' | 'invoice' | 'payment'; id: string };
  jobId: string | null;
  customerName: string;
  moveDate: string | null;
  /** The local day that put the row in the range (created, sent, booked, invoiced, paid; due for open invoices). */
  date: string;
  source: string;
  /** Null when the person may not see money, or there is no price yet. */
  amountCents: number | null;
  /** Paid / partly paid / unpaid of the move (the invoice itself for invoice rows). Null without money permission. */
  paid: { state: PaidState; balanceCents: number | null } | null;
  status:
    | { kind: 'lead'; value: LeadStatus }
    | { kind: 'stage'; value: Stage }
    | { kind: 'estimate'; value: EstimateStatus }
    | { kind: 'invoice'; value: InvoiceStatus; pastDue: boolean }
    | { kind: 'payment'; label: string };
  marks?: { viewed?: boolean; signed?: boolean; pastDue?: boolean };
};

type Base = 'leads' | 'estimates' | 'booked' | 'moves' | 'invoiced' | 'collected' | 'open';

export type ListDef = {
  label: string;
  /** Heading of the date column. */
  dateLabel: string;
  /** What the headline number is: how many rows, the sum of the amounts, or the sum of the balances. */
  measure: 'count' | 'amount' | 'balance';
  /** Ignores the range: "as of today". */
  asOfToday?: boolean;
  base: Base;
  keep?: (r: DashboardRow) => boolean;
};

export const LIST_DEFS: Record<DashboardList, ListDef> = {
  leads: { label: 'Leads created', dateLabel: 'Created', measure: 'count', base: 'leads' },
  converted: { label: 'Leads converted to jobs', dateLabel: 'Created', measure: 'count', base: 'leads', keep: (r) => r.status.kind === 'lead' && r.status.value === 'converted' },
  sent: { label: 'Estimates sent', dateLabel: 'Sent', measure: 'count', base: 'estimates' },
  viewed: { label: 'Estimates viewed', dateLabel: 'Sent', measure: 'count', base: 'estimates', keep: (r) => !!r.marks?.viewed },
  signed: { label: 'Estimates signed', dateLabel: 'Sent', measure: 'count', base: 'estimates', keep: (r) => !!r.marks?.signed },
  booked: { label: 'Jobs booked', dateLabel: 'Booked', measure: 'amount', base: 'booked' },
  moves: { label: 'Booked moves', dateLabel: 'Move date', measure: 'count', base: 'moves' },
  invoiced: { label: 'Revenue invoiced', dateLabel: 'Invoiced', measure: 'amount', base: 'invoiced' },
  collected: { label: 'Payments collected', dateLabel: 'Paid', measure: 'amount', base: 'collected' },
  open: { label: 'Open balance', dateLabel: 'Due', measure: 'balance', base: 'open', asOfToday: true },
  past_due: { label: 'Past due', dateLabel: 'Due', measure: 'balance', base: 'open', asOfToday: true, keep: (r) => !!r.marks?.pastDue },
};

/** The permissions a list needs besides hhmc.jobs.read (checked by the scope). */
function listPermissions(list: DashboardList): string[] {
  const base = LIST_DEFS[list].base;
  if (base === 'leads') return [P.leadsRead];
  if (base === 'invoiced' || base === 'open') return [P.invoicesRead];
  if (base === 'collected') return [P.invoicesRead, CORE.paymentsRead];
  return [];
}

export function mayOpenList(ctx: Scope['ctx'], list: DashboardList): boolean {
  return can(ctx, P.jobsRead) && listPermissions(list).every((p) => can(ctx, p));
}

/** What the table footer shows; the headline number is one of these. */
export function listTotals(rows: DashboardRow[]) {
  return {
    count: rows.length,
    amountCents: rows.reduce((sum, r) => sum + (r.amountCents ?? 0), 0),
    balanceCents: rows.reduce((sum, r) => sum + (r.paid?.balanceCents ?? 0), 0),
  };
}

type InvoiceMoney = Pick<typeof hhmcInvoices.$inferSelect, 'subtotalCents' | 'serviceTaxCents' | 'depositReceivedCents' | 'paidCents'>;

/** An invoice's paid state. Base money (no card fee), as everywhere in the invoices. */
function invoicePaid(inv: InvoiceMoney): { state: PaidState; balanceCents: number } {
  const balance = balanceDueCents(baseTotalCents(inv), inv.depositReceivedCents, inv.paidCents);
  if (balance <= 0) return { state: 'paid', balanceCents: 0 };
  return { state: inv.paidCents > 0 || inv.depositReceivedCents > 0 ? 'partly_paid' : 'unpaid', balanceCents: balance };
}

const leadName = (l: typeof hhmcLeads.$inferSelect) => `${l.firstName} ${l.lastName}`.trim() || l.email || l.phone || l.leadNumber;

async function leadRows(s: Scope, b: Bounds): Promise<DashboardRow[]> {
  authorize(s.ctx, P.leadsRead);
  const tz = s.ctx.business.timeZone;
  const rows = await s.db
    .select()
    .from(hhmcLeads)
    .where(and(s.where(hhmcLeads), atIn(hhmcLeads.createdAt, b)))
    .orderBy(desc(hhmcLeads.createdAt));
  return rows.map((l) => ({
    id: l.id,
    reference: l.leadNumber,
    href: { kind: 'lead', id: l.id },
    jobId: null,
    customerName: leadName(l),
    moveDate: l.moveDate,
    date: localDate(l.createdAt, tz),
    source: l.source,
    amountCents: null,
    paid: null,
    status: { kind: 'lead', value: l.status },
  }));
}

/** Estimates sent in the range (any status now, void included); marked viewed / signed. */
async function estimateRows(s: Scope, b: Bounds): Promise<DashboardRow[]> {
  const tz = s.ctx.business.timeZone;
  const rows = await s.db
    .select({ e: hhmcEstimates, job: hhmcJobs, customer: customers })
    .from(hhmcEstimates)
    .innerJoin(hhmcJobs, eq(hhmcJobs.id, hhmcEstimates.jobId))
    .innerJoin(customers, eq(customers.id, hhmcJobs.customerId))
    .where(
      and(
        s.where(hhmcEstimates),
        s.where(hhmcJobs, 'include'),
        s.where(customers, 'include'),
        isNotNull(hhmcEstimates.sentAt),
        atIn(hhmcEstimates.sentAt, b),
      ),
    )
    .orderBy(desc(hhmcEstimates.sentAt));
  return rows.map(({ e, job, customer }) => ({
    id: e.id,
    reference: `${e.estimateNumber} v${e.version}`,
    href: { kind: 'job', id: job.id },
    jobId: job.id,
    customerName: personName(customer),
    moveDate: job.moveDate,
    date: localDate(e.sentAt!, tz),
    source: job.source,
    amountCents: baseTotalCents(e),
    paid: null,
    status: { kind: 'estimate', value: e.status },
    marks: { viewed: e.viewedAt !== null, signed: e.signedAt !== null },
  }));
}

const BOOKED_STAGES: Stage[] = ['booked', 'completed', 'closed'];

/**
 * Jobs booked in the range (still booked, completed or closed), at their signed estimate's base
 * total; a booked move with no signed estimate (Movegistics history booked without one) at its
 * invoice's, else unvalued. Every booked move counts.
 */
async function bookedRows(s: Scope, b: Bounds): Promise<DashboardRow[]> {
  const tz = s.ctx.business.timeZone;
  const rows = await s.db
    .select({ job: hhmcJobs, e: hhmcEstimates, customer: customers })
    .from(hhmcJobs)
    .leftJoin(hhmcEstimates, and(eq(hhmcEstimates.jobId, hhmcJobs.id), eq(hhmcEstimates.status, 'signed'), s.where(hhmcEstimates)))
    .innerJoin(customers, eq(customers.id, hhmcJobs.customerId))
    .where(
      and(
        s.where(hhmcJobs),
        s.where(customers, 'include'),
        inArray(hhmcJobs.stage, BOOKED_STAGES),
        isNotNull(hhmcJobs.bookedAt),
        atIn(hhmcJobs.bookedAt, b),
      ),
    )
    .orderBy(desc(hhmcJobs.bookedAt));
  const unvalued = rows.filter((r) => !r.e).map((r) => r.job.id);
  const fallback = unvalued.length && can(s.ctx, P.invoicesRead) ? await jobMoney(s, unvalued) : new Map<string, { valueCents: number }>();
  return rows.map(({ job, e, customer }) => ({
    id: job.id,
    reference: job.jobNumber,
    href: { kind: 'job', id: job.id },
    jobId: job.id,
    customerName: personName(customer),
    moveDate: job.moveDate,
    date: localDate(job.bookedAt!, tz),
    source: job.source,
    // Base total (no card fee): revenue is never overstated by a fee that may not be charged.
    amountCents: e ? baseTotalCents(e) : (fallback.get(job.id)?.valueCents ?? null),
    paid: null,
    status: { kind: 'stage', value: job.stage },
  }));
}

/** Booked (or since completed / closed) jobs whose move date is in the range. */
async function moveRows(s: Scope, b: Bounds): Promise<DashboardRow[]> {
  const rows = await s.db
    .select({ job: hhmcJobs, customer: customers })
    .from(hhmcJobs)
    .innerJoin(customers, eq(customers.id, hhmcJobs.customerId))
    .where(and(s.where(hhmcJobs), s.where(customers, 'include'), inArray(hhmcJobs.stage, BOOKED_STAGES), isNotNull(hhmcJobs.moveDate), dayIn(hhmcJobs.moveDate, b)))
    .orderBy(desc(hhmcJobs.moveDate));
  return rows.map(({ job, customer }) => ({
    id: job.id,
    reference: job.jobNumber,
    href: { kind: 'job', id: job.id },
    jobId: job.id,
    customerName: personName(customer),
    moveDate: job.moveDate,
    date: job.moveDate!,
    source: job.source,
    amountCents: null,
    paid: null,
    status: { kind: 'stage', value: job.stage },
  }));
}

function invoiceRow(
  { invoice, job, customer }: { invoice: typeof hhmcInvoices.$inferSelect; job: typeof hhmcJobs.$inferSelect; customer: typeof customers.$inferSelect },
  date: string,
  today: string,
): DashboardRow {
  const pastDue = isPastDue(invoice.status, invoice.dueDate, today);
  return {
    id: invoice.id,
    reference: invoice.invoiceNumber,
    href: { kind: 'invoice', id: invoice.id },
    jobId: job.id,
    customerName: personName(customer),
    moveDate: job.moveDate,
    date,
    source: job.source,
    amountCents: baseTotalCents(invoice),
    paid: invoicePaid(invoice),
    status: { kind: 'invoice', value: invoice.status, pastDue },
    marks: { pastDue },
  };
}

/** Non-void invoices (drafts included) dated in the range, at their base total (subtotal + tax). */
async function invoicedRows(s: Scope, b: Bounds, today: string): Promise<DashboardRow[]> {
  authorize(s.ctx, P.invoicesRead);
  const rows = await s.db
    .select({ invoice: hhmcInvoices, job: hhmcJobs, customer: customers })
    .from(hhmcInvoices)
    .innerJoin(hhmcJobs, eq(hhmcJobs.id, hhmcInvoices.jobId))
    .innerJoin(customers, eq(customers.id, hhmcInvoices.customerId))
    .where(and(s.where(hhmcInvoices), s.where(hhmcJobs, 'include'), s.where(customers, 'include'), ne(hhmcInvoices.status, 'void'), dayIn(hhmcInvoices.invoiceDate, b)))
    .orderBy(desc(hhmcInvoices.invoiceDate), desc(hhmcInvoices.createdAt));
  return rows.map((r) => invoiceRow(r, r.invoice.invoiceDate, today));
}

/** Non-void invoices not fully paid, as of today (drafts included); their balance in base money. */
async function openRows(s: Scope, today: string): Promise<DashboardRow[]> {
  authorize(s.ctx, P.invoicesRead);
  const rows = await s.db
    .select({ invoice: hhmcInvoices, job: hhmcJobs, customer: customers })
    .from(hhmcInvoices)
    .innerJoin(hhmcJobs, eq(hhmcJobs.id, hhmcInvoices.jobId))
    .innerJoin(customers, eq(customers.id, hhmcInvoices.customerId))
    .where(and(s.where(hhmcInvoices), s.where(hhmcJobs, 'include'), s.where(customers, 'include'), inArray(hhmcInvoices.status, ['draft', 'sent', 'partially_paid'])))
    .orderBy(hhmcInvoices.dueDate, hhmcInvoices.createdAt);
  return rows.map((r) => invoiceRow(r, r.invoice.dueDate, today)).filter((r) => (r.paid?.balanceCents ?? 0) > 0);
}

const METHOD_LABELS: Record<string, string> = { card: 'Card', cash: 'Cash', check: 'Check', other: 'Other' };

/**
 * Money received in the range: succeeded core charges for an HHMC estimate (deposit) or
 * invoice of this business and mode, dated by when they were paid, net of what was refunded on
 * them. What the customer paid, card fees included.
 */
async function collectedRows(s: Scope, b: Bounds): Promise<DashboardRow[]> {
  authorize(s.ctx, P.invoicesRead);
  authorize(s.ctx, CORE.paymentsRead);
  const tz = s.ctx.business.timeZone;
  const paidOn = sql<Date>`coalesce(${payments.paidAt}, ${payments.createdAt})`.mapWith(payments.paidAt);
  const rows = await s.db
    .select({ p: payments, paidOn, estimate: hhmcEstimates, invoice: hhmcInvoices, job: hhmcJobs, customer: customers })
    .from(payments)
    .leftJoin(
      hhmcEstimates,
      and(eq(payments.subjectType, estimateEntity.key), eq(hhmcEstimates.id, payments.subjectId), s.where(hhmcEstimates, 'include')),
    )
    .leftJoin(
      hhmcInvoices,
      and(eq(payments.subjectType, invoiceEntity.key), eq(hhmcInvoices.id, payments.subjectId), s.where(hhmcInvoices, 'include')),
    )
    // Every payment HHMC received counts, also one linked straight to a work request or to no
    // record at all (e.g. history imported from Movegistics): money in is money in.
    .leftJoin(
      hhmcJobs,
      and(
        sql`${hhmcJobs.id} = coalesce(${hhmcEstimates.jobId}, ${hhmcInvoices.jobId}, case when ${payments.subjectType} = ${jobEntity.key} then ${payments.subjectId} end)`,
        s.where(hhmcJobs, 'include'),
      ),
    )
    .leftJoin(customers, and(sql`${customers.id} = coalesce(${hhmcJobs.customerId}, ${payments.customerId})`, s.where(customers, 'include')))
    .where(and(s.where(payments), eq(payments.kind, 'charge'), eq(payments.status, 'succeeded'), atIn(paidOn, b)))
    .orderBy(desc(paidOn));
  return rows.map(({ p, paidOn: at, estimate, invoice, job, customer }) => {
    const refunded = p.refundedCents;
    const method = METHOD_LABELS[p.method] ?? p.method;
    return {
      id: p.id,
      reference: invoice ? invoice.invoiceNumber : estimate ? `Deposit ${estimate.estimateNumber}` : job ? `Payment on ${job.jobNumber}` : 'Payment (no work request)',
      href: invoice ? { kind: 'invoice', id: invoice.id } : job ? { kind: 'job', id: job.id } : { kind: 'payment', id: p.id },
      jobId: job?.id ?? null,
      customerName: customer ? personName(customer) : 'No customer',
      moveDate: job?.moveDate ?? null,
      date: localDate(new Date(at as unknown as string | Date), tz),
      source: job?.source ?? 'Other',
      amountCents: p.amountCents - refunded,
      paid: null,
      status: { kind: 'payment', label: refunded > 0 ? `${method} · ${money(refunded)} refunded` : method },
    } satisfies DashboardRow;
  });
}

async function baseRows(s: Scope, base: Base, b: Bounds, today: string): Promise<DashboardRow[]> {
  switch (base) {
    case 'leads':
      return leadRows(s, b);
    case 'estimates':
      return estimateRows(s, b);
    case 'booked':
      return bookedRows(s, b);
    case 'moves':
      return moveRows(s, b);
    case 'invoiced':
      return invoicedRows(s, b, today);
    case 'collected':
      return collectedRows(s, b);
    case 'open':
      return openRows(s, today);
  }
}

/**
 * The money state of each job: its (latest) non-void invoice; else its signed estimate less the
 * deposit received; else nothing agreed yet. Values in base money (no card fee).
 */
async function jobMoney(s: Scope, jobIds: string[]) {
  const result = new Map<string, { valueCents: number; paid: { state: PaidState; balanceCents: number | null } }>();
  if (jobIds.length === 0) return result;
  const signed = await s.db
    .select()
    .from(hhmcEstimates)
    .where(and(s.where(hhmcEstimates), inArray(hhmcEstimates.jobId, jobIds), eq(hhmcEstimates.status, 'signed')));
  for (const e of signed) {
    const value = baseTotalCents(e);
    const deposit = e.depositPaidCents > 0 ? e.depositCents : 0;
    result.set(e.jobId, { valueCents: value, paid: { state: deposit > 0 ? 'partly_paid' : 'unpaid', balanceCents: Math.max(value - deposit, 0) } });
  }
  if (can(s.ctx, P.invoicesRead)) {
    const invoices = await s.db
      .select()
      .from(hhmcInvoices)
      .where(and(s.where(hhmcInvoices), inArray(hhmcInvoices.jobId, jobIds), ne(hhmcInvoices.status, 'void')))
      .orderBy(hhmcInvoices.createdAt);
    for (const inv of invoices) result.set(inv.jobId, { valueCents: baseTotalCents(inv), paid: invoicePaid(inv) });
  }
  return result;
}

/** Adds the job, its value and paid state to the rows that do not carry them. */
async function enrich(s: Scope, list: DashboardList, rows: DashboardRow[]): Promise<DashboardRow[]> {
  const base = LIST_DEFS[list].base;
  if (base === 'leads') {
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      const jobs = await s.db
        .select({ id: hhmcJobs.id, leadId: hhmcJobs.leadId, moveDate: hhmcJobs.moveDate })
        .from(hhmcJobs)
        .where(and(s.where(hhmcJobs, 'include'), inArray(hhmcJobs.leadId, ids)))
        .orderBy(hhmcJobs.createdAt);
      const byLead = new Map<string, (typeof jobs)[number]>();
      for (const j of jobs) if (j.leadId && !byLead.has(j.leadId)) byLead.set(j.leadId, j);
      rows = rows.map((r) => {
        const job = byLead.get(r.id);
        return job ? { ...r, jobId: job.id, moveDate: job.moveDate ?? r.moveDate } : r;
      });
    }
  }
  if (base === 'invoiced' || base === 'open') return rows;
  const money = await jobMoney(s, [...new Set(rows.map((r) => r.jobId).filter((id): id is string => id !== null))]);
  return rows.map((r) => {
    const m = r.jobId ? money.get(r.jobId) : undefined;
    return {
      ...r,
      amountCents: base === 'leads' || base === 'moves' ? (m?.valueCents ?? null) : r.amountCents,
      paid: m?.paid ?? { state: 'none', balanceCents: null },
    };
  });
}

export type ListFilters = { source?: string; month?: string };

function applyFilters(rows: DashboardRow[], filters: ListFilters): DashboardRow[] {
  return rows.filter((r) => (!filters.source || r.source === filters.source) && (!filters.month || r.date.startsWith(`${filters.month}-`)));
}

/** The records behind one number, newest first (open invoices: oldest due first). */
export async function dashboardList(s: Scope, list: DashboardList, range: DashboardRange, filters: ListFilters = {}, now: Date = new Date()) {
  authorize(s.ctx, P.jobsRead);
  for (const p of listPermissions(list)) authorize(s.ctx, p);
  const def = LIST_DEFS[list];
  const tz = s.ctx.business.timeZone;
  const today = localDate(now, tz);
  const all = await baseRows(s, def.base, boundsOf(range, tz), today);
  const kept = applyFilters(def.keep ? all.filter(def.keep) : all, filters);
  let rows = await enrich(s, list, kept);
  if (!can(s.ctx, P.invoicesRead)) rows = rows.map((r) => ({ ...r, amountCents: null, paid: null }));
  return { def, rows, totals: listTotals(rows), today };
}

// ---------------------------------------------------------------- the headline numbers

export type MonthRow = { month: string; leads: number | null; booked: number; bookedCents: number | null; invoicedCents: number | null; collectedCents: number | null };
export type SourceRow = { source: string; leads: number | null; booked: number; bookedCents: number | null };

function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let day = `${first}-01`;
  while (day.slice(0, 7) <= last && out.length < 600) {
    out.push(day.slice(0, 7));
    day = firstOfMonth(addDays(lastOfMonth(day), 1));
  }
  return out;
}

/**
 * Every headline number for a range, plus the by-source and by-month breakdowns. Money is
 * only computed for people who may see invoices (payments: and payments).
 */
export async function dashboardSummary(s: Scope, range: DashboardRange, now: Date = new Date()) {
  authorize(s.ctx, P.jobsRead);
  const tz = s.ctx.business.timeZone;
  const today = localDate(now, tz);
  const b = boundsOf(range, tz);
  const seesLeads = can(s.ctx, P.leadsRead);
  const seesMoney = can(s.ctx, P.invoicesRead);
  const seesPayments = seesMoney && can(s.ctx, CORE.paymentsRead);

  const leads = seesLeads ? await leadRows(s, b) : null;
  const estimates = await estimateRows(s, b);
  const booked = await bookedRows(s, b);
  const moves = await moveRows(s, b);
  const invoiced = seesMoney ? await invoicedRows(s, b, today) : null;
  const collected = seesPayments ? await collectedRows(s, b) : null;
  const open = seesMoney ? await openRows(s, today) : null;
  const keep = (list: DashboardList, rows: DashboardRow[]) => (LIST_DEFS[list].keep ? rows.filter(LIST_DEFS[list].keep!) : rows);

  const leadCount = leads?.length ?? 0;
  const converted = leads ? keep('converted', leads).length : 0;

  const sources = new Map<string, SourceRow>(LEAD_SOURCES.map((src) => [src, { source: src, leads: seesLeads ? 0 : null, booked: 0, bookedCents: seesMoney ? 0 : null }]));
  const sourceRow = (src: string) => {
    if (!sources.has(src)) sources.set(src, { source: src, leads: seesLeads ? 0 : null, booked: 0, bookedCents: seesMoney ? 0 : null });
    return sources.get(src)!;
  };
  for (const r of leads ?? []) {
    const row = sourceRow(r.source);
    row.leads = (row.leads ?? 0) + 1;
  }
  for (const r of booked) {
    const row = sourceRow(r.source);
    row.booked += 1;
    if (row.bookedCents !== null) row.bookedCents += r.amountCents ?? 0;
  }

  const dated = [...(leads ?? []), ...booked, ...(invoiced ?? []), ...(collected ?? [])].map((r) => r.date).sort();
  const firstMonth = (range.from ?? dated[0] ?? today).slice(0, 7);
  const lastMonth = (range.to ?? [dated.at(-1) ?? today, today].sort().at(-1)!).slice(0, 7);
  const months = new Map<string, MonthRow>(
    monthsBetween(firstMonth, lastMonth).map((m) => [
      m,
      { month: m, leads: seesLeads ? 0 : null, booked: 0, bookedCents: seesMoney ? 0 : null, invoicedCents: seesMoney ? 0 : null, collectedCents: seesPayments ? 0 : null },
    ]),
  );
  // Every row's date is inside the range, so its month is always in the list.
  const add = (rows: DashboardRow[] | null, fn: (m: MonthRow, r: DashboardRow) => void) => {
    for (const r of rows ?? []) {
      const m = months.get(r.date.slice(0, 7));
      if (m) fn(m, r);
    }
  };
  add(leads, (m) => (m.leads = (m.leads ?? 0) + 1));
  add(booked, (m, r) => {
    m.booked += 1;
    if (m.bookedCents !== null) m.bookedCents += r.amountCents ?? 0;
  });
  add(invoiced, (m, r) => (m.invoicedCents = (m.invoicedCents ?? 0) + (r.amountCents ?? 0)));
  add(collected, (m, r) => (m.collectedCents = (m.collectedCents ?? 0) + (r.amountCents ?? 0)));

  return {
    today,
    leads: leads ? { count: leadCount, converted, conversionPercent: leadCount ? Math.round((converted / leadCount) * 100) : 0 } : null,
    estimates: { sent: estimates.length, viewed: keep('viewed', estimates).length, signed: keep('signed', estimates).length },
    booked: { count: booked.length, amountCents: seesMoney ? listTotals(booked).amountCents : null },
    moves: moves.length,
    invoicedCents: invoiced ? listTotals(invoiced).amountCents : null,
    invoicedCount: invoiced?.length ?? null,
    collectedCents: collected ? listTotals(collected).amountCents : null,
    collectedCount: collected?.length ?? null,
    open: open ? { cents: listTotals(open).balanceCents, count: open.length } : null,
    pastDue: open ? { cents: listTotals(keep('past_due', open)).balanceCents, count: keep('past_due', open).length } : null,
    bySource: [...sources.values()].filter((r) => (r.leads ?? 0) > 0 || r.booked > 0).sort((x, y) => (y.bookedCents ?? y.booked) - (x.bookedCents ?? x.booked) || (y.leads ?? 0) - (x.leads ?? 0)),
    byMonth: [...months.values()],
    medianHours: seesLeads ? await medianLeadToEstimateHours(s, now, range) : null,
  };
}

// ---------------------------------------------------------------- the Overview widgets (manifest.ts)

function thisMonth(s: Scope, now: Date) {
  return boundsOf(presetRange('this_month', now, s.ctx.business.timeZone), s.ctx.business.timeZone);
}

export async function leadsThisMonth(s: Scope, now: Date = new Date()) {
  authorize(s.ctx, P.leadsRead);
  const rows = await leadRows(s, thisMonth(s, now));
  const converted = rows.filter(LIST_DEFS.converted.keep!).length;
  return { leads: rows.length, converted, conversionPercent: rows.length ? Math.round((converted / rows.length) * 100) : 0 };
}

export async function estimateFunnel(s: Scope, now: Date = new Date()) {
  authorize(s.ctx, P.jobsRead);
  const rows = await estimateRows(s, thisMonth(s, now));
  return { sent: rows.length, viewed: rows.filter(LIST_DEFS.viewed.keep!).length, signed: rows.filter(LIST_DEFS.signed.keep!).length };
}

/** Open balance and past due as of today (the dashboard's definitions); paid this month = invoices paid in full this month. */
export async function invoiceTotals(s: Scope, now: Date = new Date()) {
  authorize(s.ctx, P.invoicesRead);
  const today = localDate(now, s.ctx.business.timeZone);
  const open = await openRows(s, today);
  const pastDue = open.filter(LIST_DEFS.past_due.keep!);
  const from = thisMonth(s, now).startAt!;
  const paid = await s.db
    .select()
    .from(hhmcInvoices)
    .where(and(s.where(hhmcInvoices), eq(hhmcInvoices.status, 'paid'), isNotNull(hhmcInvoices.paidAt), gte(hhmcInvoices.paidAt, from)));
  return {
    openCents: listTotals(open).balanceCents,
    pastDueCents: listTotals(pastDue).balanceCents,
    pastDueCount: pastDue.length,
    paidThisMonthCents: paid.reduce((sum, inv) => sum + baseTotalCents(inv), 0),
  };
}

/**
 * Median hours from a lead arriving to its job's first estimate being sent, for leads created
 * in the range (no range: the last 90 days of leads).
 */
export async function medianLeadToEstimateHours(s: Scope, now: Date = new Date(), range?: DashboardRange): Promise<number | null> {
  authorize(s.ctx, P.leadsRead);
  authorize(s.ctx, P.jobsRead);
  const since = new Date(now.getTime() - 90 * 24 * 3600 * 1000);
  const leadFilter = range ? atIn(hhmcLeads.createdAt, boundsOf(range, s.ctx.business.timeZone)) : gte(hhmcLeads.createdAt, since);
  const rows = await s.db
    .select({ leadAt: hhmcLeads.createdAt, firstSent: min(hhmcEstimates.sentAt) })
    .from(hhmcLeads)
    .innerJoin(hhmcJobs, eq(hhmcJobs.leadId, hhmcLeads.id))
    .innerJoin(hhmcEstimates, eq(hhmcEstimates.jobId, hhmcJobs.id))
    .where(and(s.where(hhmcLeads), s.where(hhmcJobs), s.where(hhmcEstimates, 'include'), leadFilter, isNotNull(hhmcEstimates.sentAt)))
    .groupBy(hhmcLeads.id, hhmcLeads.createdAt);
  const hours = rows
    .filter((r) => r.firstSent)
    .map((r) => (new Date(r.firstSent as unknown as string).getTime() - r.leadAt.getTime()) / 3_600_000)
    .sort((a, b) => a - b);
  if (hours.length === 0) return null;
  const mid = Math.floor(hours.length / 2);
  return hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2;
}

/** Jobs moving in the next 7 days (for the overview). */
export async function upcomingMoves(s: Scope, now: Date = new Date()) {
  authorize(s.ctx, P.jobsRead);
  const today = localDate(now, s.ctx.business.timeZone);
  return s.db.$count(
    hhmcJobs,
    and(s.where(hhmcJobs), eq(hhmcJobs.stage, 'booked'), gte(hhmcJobs.moveDate, today), lt(hhmcJobs.moveDate, addDays(today, 7))),
  );
}
