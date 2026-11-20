/**
 * The calendar shows ONLY confirmed moves (managers' feedback round 1, Nov 2026: "Calendar
 * shows only confirmed moves"): every job day of a job that is Confirmed (stage `booked`: the
 * deposit is paid and the move is booked), and of moves done since (Completed, Closed).
 * Requests, estimates and invoices are not on it: a converted lead or a sent estimate never
 * puts a move on the calendar. Each event is shown only to someone with hhmc.jobs.read.
 *
 * Crew and truck capacity and sold-out dates stay in scheduleBetween (booking.ts).
 */
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { customers } from '@/core/db/schema/tenant';
import { withScope } from '@/core/db/scope';
import { ValidationError } from '@/core/errors';
import { can } from '@/core/rbac/permissions';
import type { BusinessContext } from '@/core/tenancy/context';
import { P } from '../permissions';
import { addDays, isDateText, localTime } from '../rules';
import { hhmcJobDays, hhmcJobs, type Stage } from '../schema';
import { personName } from './common';

export const CALENDAR_KINDS = ['booked'] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

export const CALENDAR_KIND_LABELS: Record<CalendarKind, string> = {
  booked: 'Confirmed move',
};

/** The stages whose job days are on the calendar: Confirmed, and moves done since. */
export const CALENDAR_STAGES: Stage[] = ['booked', 'completed', 'closed'];

/** The longest range one call may load (a month view is at most 6 weeks). */
export const CALENDAR_MAX_DAYS = 62;

/** Which kind of event a job shows as, from its stage: only confirmed (or done) moves show. */
export function jobEventKind(stage: Stage): CalendarKind | null {
  return CALENDAR_STAGES.includes(stage) ? 'booked' : null;
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
  return CALENDAR_KINDS.filter(() => can(ctx, P.jobsRead));
}

type EventBase = { key: string; date: string; jobId: string; jobNumber: string; customerName: string };

export type CalendarEvent = EventBase & {
  kind: 'booked';
  dayId: string;
  startsAt: Date;
  endsAt: Date;
  crewSize: number;
  trucks: number;
  stage: Stage;
};

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

/**
 * Every event between two local dates (inclusive from, exclusive to), grouped by day.
 * `kinds` limits what is loaded (the legend's toggles); kinds the person may not see are
 * always left out, never refused, so the rest of the calendar still shows.
 */
export async function calendarBetween(
  ctx: BusinessContext,
  from: string,
  to: string,
  options: { kinds?: Iterable<CalendarKind> } = {},
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

  const events = await withScope(ctx, P.jobsRead, async (s) => {
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
            inArray(hhmcJobs.stage, CALENDAR_STAGES),
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

    return out;
  });

  for (const e of events) days.get(e.date)?.events.push(e);
  for (const d of days.values()) {
    d.events.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.jobNumber.localeCompare(b.jobNumber));
  }
  return { days: [...days.values()], allowed };
}
