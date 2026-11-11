/**
 * The calendar: one view of everything with a date on it (managers' requirement: "only the
 * monthly calendar is useful and you can't color code it").
 *
 * Four kinds of event, each shown with its own colour AND a label (never colour alone):
 * - Booked move:  every job day of a job that is Booked, Completed or Closed.
 * - Estimate:     a job in Estimate Sent, on its move date, with its estimate's status.
 * - Work request: a job still Qualified (not estimated yet) that has a move date.
 * - Invoice due:  an invoice that is not Paid or Void, on its due date, with its balance.
 * Lost and cancelled jobs and void records never appear. Each kind is shown only to someone
 * who may see it: jobs need hhmc.jobs.read, invoices need hhmc.invoices.read.
 *
 * Crew and truck capacity and sold-out dates stay in scheduleBetween (booking.ts).
 */
import { and, asc, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm';
import { customers } from '@/core/db/schema/tenant';
import { withScope } from '@/core/db/scope';
import { ValidationError } from '@/core/errors';
import { can } from '@/core/rbac/permissions';
import type { BusinessContext } from '@/core/tenancy/context';
import { P } from '../permissions';
import { addDays, isDateText, isPastDue, localDate, localTime } from '../rules';
import { hhmcEstimates, hhmcInvoices, hhmcJobDays, hhmcJobs, type EstimateStatus, type InvoiceStatus, type Stage } from '../schema';
import { personName } from './common';
import { balanceOf } from './invoices';

export const CALENDAR_KINDS = ['booked', 'estimate', 'request', 'invoice'] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

export const CALENDAR_KIND_LABELS: Record<CalendarKind, string> = {
  booked: 'Booked move',
  estimate: 'Estimate',
  request: 'Work request',
  invoice: 'Invoice due',
};

/** The longest range one call may load (a month view is at most 6 weeks). */
export const CALENDAR_MAX_DAYS = 62;

/** Which kind of event a job shows as, from its stage. Lost and cancelled jobs show nothing. */
export function jobEventKind(stage: Stage): Exclude<CalendarKind, 'invoice'> | null {
  switch (stage) {
    case 'booked':
    case 'completed':
    case 'closed':
      return 'booked';
    case 'estimate_sent':
      return 'estimate';
    case 'qualified':
      return 'request';
    default:
      return null;
  }
}

/** An invoice is shown on its due date until it is paid (or voided). */
export function invoiceIsDue(status: InvoiceStatus): boolean {
  return status === 'draft' || status === 'sent' || status === 'partially_paid';
}

/** "estimate,invoice" → those kinds (unknown words are ignored). */
export function parseCalendarKinds(value: string | undefined): Set<CalendarKind> {
  const out = new Set<CalendarKind>();
  for (const part of (value ?? '').split(',')) {
    const kind = CALENDAR_KINDS.find((k) => k === part.trim());
    if (kind) out.add(kind);
  }
  return out;
}

/** The kinds this person may see. */
export function allowedCalendarKinds(ctx: Pick<BusinessContext, 'permissions'>): CalendarKind[] {
  return CALENDAR_KINDS.filter((k) => (k === 'invoice' ? can(ctx, P.invoicesRead) : can(ctx, P.jobsRead)));
}

type EventBase = { key: string; date: string; jobId: string; jobNumber: string; customerName: string };

export type CalendarEvent =
  | (EventBase & {
      kind: 'booked';
      dayId: string;
      startsAt: Date;
      endsAt: Date;
      crewSize: number;
      trucks: number;
      stage: Stage;
    })
  | (EventBase & { kind: 'estimate'; estimateId: string | null; estimateStatus: EstimateStatus | null; expired: boolean })
  | (EventBase & { kind: 'request' })
  | (EventBase & {
      kind: 'invoice';
      invoiceId: string;
      invoiceNumber: string;
      invoiceStatus: InvoiceStatus;
      balanceCents: number;
      pastDue: boolean;
    });

export type CalendarDay = { date: string; events: CalendarEvent[] };

// Only the columns the calendar shows, so it does not depend on every column of these tables.
const DAY_COLUMNS = {
  id: hhmcJobDays.id,
  dayDate: hhmcJobDays.dayDate,
  startTime: hhmcJobDays.startTime,
  durationMinutes: hhmcJobDays.durationMinutes,
  crewSize: hhmcJobDays.crewSize,
  trucks: hhmcJobDays.trucks,
};
const JOB_COLUMNS = { id: hhmcJobs.id, jobNumber: hhmcJobs.jobNumber, stage: hhmcJobs.stage, moveDate: hhmcJobs.moveDate };
const CUSTOMER_COLUMNS = {
  kind: customers.kind,
  firstName: customers.firstName,
  lastName: customers.lastName,
  organizationName: customers.organizationName,
  email: customers.email,
};

const INVOICE_COLUMNS = {
  id: hhmcInvoices.id,
  invoiceNumber: hhmcInvoices.invoiceNumber,
  status: hhmcInvoices.status,
  dueDate: hhmcInvoices.dueDate,
  // What balanceOf needs.
  subtotalCents: hhmcInvoices.subtotalCents,
  serviceTaxCents: hhmcInvoices.serviceTaxCents,
  depositReceivedCents: hhmcInvoices.depositReceivedCents,
  paidCents: hhmcInvoices.paidCents,
  convenienceFeeOn: hhmcInvoices.convenienceFeeOn,
  convenienceFeeBp: hhmcInvoices.convenienceFeeBp,
};

const KIND_ORDER: Record<CalendarKind, number> = { booked: 0, estimate: 1, request: 2, invoice: 3 };

/**
 * Every event between two local dates (inclusive from, exclusive to), grouped by day.
 * `kinds` limits what is loaded (the legend's toggles); kinds the person may not see are
 * always left out, never refused, so the rest of the calendar still shows.
 */
export async function calendarBetween(
  ctx: BusinessContext,
  from: string,
  to: string,
  options: { kinds?: Iterable<CalendarKind>; now?: Date } = {},
): Promise<{ days: CalendarDay[]; allowed: CalendarKind[] }> {
  if (!isDateText(from) || !isDateText(to) || to <= from) throw new ValidationError('Choose a valid date range.');
  if (addDays(from, CALENDAR_MAX_DAYS) < to) throw new ValidationError(`Choose at most ${CALENDAR_MAX_DAYS} days.`);
  const allowed = allowedCalendarKinds(ctx);
  const wanted = new Set(options.kinds ?? CALENDAR_KINDS);
  const load = new Set(allowed.filter((k) => wanted.has(k)));

  const days = new Map<string, CalendarDay>();
  for (let d = from; d < to; d = addDays(d, 1)) days.set(d, { date: d, events: [] });
  if (load.size === 0) return { days: [...days.values()], allowed };

  const tz = ctx.business.timeZone;
  const now = options.now ?? new Date();
  const today = localDate(now, tz);
  // Every kind needs one of these two; withScope checks it and scopes every query below.
  const permission = load.has('booked') || load.has('estimate') || load.has('request') ? P.jobsRead : P.invoicesRead;

  const events = await withScope(ctx, permission, async (s) => {
    const out: CalendarEvent[] = [];

    if (load.has('booked')) {
      const rows = await s.db
        .select({ day: DAY_COLUMNS, job: JOB_COLUMNS, customer: CUSTOMER_COLUMNS })
        .from(hhmcJobDays)
        .innerJoin(hhmcJobs, and(eq(hhmcJobs.id, hhmcJobDays.jobId), s.where(hhmcJobs, 'include')))
        .innerJoin(customers, and(eq(customers.id, hhmcJobs.customerId), s.where(customers, 'include')))
        .where(
          and(
            s.where(hhmcJobDays),
            s.where(hhmcJobs),
            inArray(hhmcJobs.stage, ['booked', 'completed', 'closed']),
            gte(hhmcJobDays.dayDate, from),
            lt(hhmcJobDays.dayDate, to),
          ),
        )
        .orderBy(asc(hhmcJobDays.dayDate), asc(hhmcJobDays.startTime));
      for (const r of rows) {
        const startsAt = localTime(r.day.dayDate, r.day.startTime, tz);
        out.push({
          kind: 'booked',
          key: `booked:${r.day.id}`,
          date: r.day.dayDate,
          jobId: r.job.id,
          jobNumber: r.job.jobNumber,
          customerName: personName(r.customer),
          dayId: r.day.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + r.day.durationMinutes * 60_000),
          crewSize: r.day.crewSize,
          trucks: r.day.trucks,
          stage: r.job.stage,
        });
      }
    }

    const jobStages = [...(load.has('estimate') ? (['estimate_sent'] as const) : []), ...(load.has('request') ? (['qualified'] as const) : [])];
    if (jobStages.length) {
      const rows = await s.db
        .select({
          job: JOB_COLUMNS,
          customer: CUSTOMER_COLUMNS,
          estimate: { id: hhmcEstimates.id, status: hhmcEstimates.status, expiresAt: hhmcEstimates.expiresAt },
        })
        .from(hhmcJobs)
        .innerJoin(customers, and(eq(customers.id, hhmcJobs.customerId), s.where(customers, 'include')))
        // The job's live estimate (at most one: a unique index). Void ones are never shown.
        .leftJoin(
          hhmcEstimates,
          and(s.where(hhmcEstimates), eq(hhmcEstimates.jobId, hhmcJobs.id), inArray(hhmcEstimates.status, ['sent', 'viewed', 'signed'])),
        )
        .where(
          and(
            s.where(hhmcJobs),
            inArray(hhmcJobs.stage, jobStages),
            isNotNull(hhmcJobs.moveDate),
            gte(hhmcJobs.moveDate, from),
            lt(hhmcJobs.moveDate, to),
          ),
        )
        .orderBy(asc(hhmcJobs.moveDate), asc(hhmcJobs.jobNumber));
      for (const r of rows) {
        const kind = jobEventKind(r.job.stage);
        const base = { date: r.job.moveDate!, jobId: r.job.id, jobNumber: r.job.jobNumber, customerName: personName(r.customer) };
        if (kind === 'estimate') {
          const e = r.estimate;
          out.push({
            ...base,
            kind,
            key: `estimate:${r.job.id}`,
            estimateId: e?.id ?? null,
            estimateStatus: e?.status ?? null,
            expired: !!e && e.status !== 'signed' && !!e.expiresAt && e.expiresAt < now,
          });
        } else if (kind === 'request') {
          out.push({ ...base, kind, key: `request:${r.job.id}` });
        }
      }
    }

    if (load.has('invoice')) {
      const rows = await s.db
        .select({ invoice: INVOICE_COLUMNS, job: JOB_COLUMNS, customer: CUSTOMER_COLUMNS })
        .from(hhmcInvoices)
        .innerJoin(hhmcJobs, and(eq(hhmcJobs.id, hhmcInvoices.jobId), s.where(hhmcJobs, 'include')))
        .innerJoin(customers, and(eq(customers.id, hhmcInvoices.customerId), s.where(customers, 'include')))
        .where(
          and(
            s.where(hhmcInvoices),
            inArray(hhmcInvoices.status, ['draft', 'sent', 'partially_paid']),
            gte(hhmcInvoices.dueDate, from),
            lt(hhmcInvoices.dueDate, to),
          ),
        )
        .orderBy(asc(hhmcInvoices.dueDate), asc(hhmcInvoices.invoiceNumber));
      for (const r of rows) {
        if (!invoiceIsDue(r.invoice.status)) continue;
        out.push({
          kind: 'invoice',
          key: `invoice:${r.invoice.id}`,
          date: r.invoice.dueDate,
          jobId: r.job.id,
          jobNumber: r.job.jobNumber,
          customerName: personName(r.customer),
          invoiceId: r.invoice.id,
          invoiceNumber: r.invoice.invoiceNumber,
          invoiceStatus: r.invoice.status,
          balanceCents: Math.max(balanceOf(r.invoice), 0),
          pastDue: isPastDue(r.invoice.status, r.invoice.dueDate, today),
        });
      }
    }
    return out;
  });

  for (const e of events) days.get(e.date)?.events.push(e);
  for (const d of days.values()) {
    d.events.sort((a, b) => {
      if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
      if (a.kind === 'booked' && b.kind === 'booked') return a.startsAt.getTime() - b.startsAt.getTime();
      return a.jobNumber.localeCompare(b.jobNumber);
    });
  }
  return { days: [...days.values()], allowed };
}
