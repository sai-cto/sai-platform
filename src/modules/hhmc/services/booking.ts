/**
 * Job Days, booking and the schedule.
 *
 * - A job has 1..n Job Days (multi-day moves, ref §3.4 "Add/Edit MultiDay Move").
 * - Book (manual, ref §11 Q3) books each day through the core's bookAppointment: one
 *   appointment per truck, trucks being core resources of kind "truck". A sold-out date (a
 *   business-wide unavailability) refuses the booking. Release Booking cancels them.
 * - The schedule is one calendar (ref §10 "one calendar with day/week/month views").
 */
import { and, asc, eq, gte, inArray, isNull, lt, ne } from 'drizzle-orm';
import { z } from 'zod';
import { appointments, customers, resources, unavailability } from '@/core/db/schema/tenant';
import { withScope, type Scope } from '@/core/db/scope';
import { takeLock } from '@/core/db/lock';
import { NotFoundError, ValidationError } from '@/core/errors';
import { isUuid } from '@/core/ids';
import { authorize } from '@/core/rbac/permissions';
import { appointmentEntity, resourceEntity, unavailabilityEntity } from '@/core/records/core-entities';
import { archiveRecord, createRecord, updateRecord } from '@/core/records/records';
import { formatClock, formatDay } from '@/ui/format';
import { bookAppointment, findConflicts } from '@/core/scheduling/scheduling';
import type { BusinessContext } from '@/core/tenancy/context';
import { jobDayEntity, jobEntity, noteEntity } from '../entities';
import { CORE, P } from '../permissions';
import { addDays, isDateText, isTimeText, localDate, localTime, STAGE_LABELS } from '../rules';
import { hhmcEstimates, hhmcJobDays, hhmcJobs } from '../schema';
import { loadSettings } from '../settings';
import { cancelQueued, enqueue } from './automations';
import { loadCustomer, loadJob, personName, trucksOf } from './common';
import { optionalText, parse } from './input';
import { moveStage } from './jobs';

export const JOB_DAY_KIND = 'hhmc.job_day';

export async function jobDaysOf(s: Scope, jobId: string) {
  return s.db
    .select()
    .from(hhmcJobDays)
    .where(and(s.where(hhmcJobDays), eq(hhmcJobDays.jobId, jobId)))
    .orderBy(asc(hhmcJobDays.dayDate), asc(hhmcJobDays.startTime));
}

const dayInput = z.object({
  dayDate: z.string().refine(isDateText, 'Enter the day as a date'),
  startTime: z.string().refine(isTimeText, 'Enter the start time as HH:MM'),
  hours: z.coerce.number({ message: 'Enter the hours as a number' }).min(0.25, 'At least a quarter of an hour').max(24, 'At most 24 hours'),
  crewSize: z.coerce.number().int().min(1, 'At least one mover').max(20),
  trucks: z.coerce.number().int().min(0).max(10),
  notes: optionalText(1000),
});

function dayValues(raw: unknown) {
  const input = parse(dayInput, raw);
  return {
    dayDate: input.dayDate,
    startTime: input.startTime,
    durationMinutes: Math.round(input.hours * 60),
    crewSize: input.crewSize,
    trucks: input.trucks,
    notes: input.notes,
  };
}

async function editableDays(s: Scope, jobId: string) {
  const job = await loadJob(s, jobId);
  if (job.stage === 'booked')
    throw new ValidationError('Release the booking before changing the job days.');
  if (job.stage === 'closed' || job.stage === 'cancelled' || job.stage === 'lost')
    throw new ValidationError(`A ${STAGE_LABELS[job.stage].toLowerCase()} job cannot be changed.`);
  return job;
}

export async function addJobDay(ctx: BusinessContext, jobId: string, raw: unknown) {
  const values = dayValues(raw);
  return withScope(ctx, P.jobsWrite, async (s) => {
    await editableDays(s, jobId);
    return createRecord(s, jobDayEntity, { ...values, jobId });
  });
}

async function dayOfJob(s: Scope, jobId: string, dayId: string) {
  if (!isUuid(dayId)) throw new NotFoundError();
  const [day] = await s.db
    .select()
    .from(hhmcJobDays)
    .where(and(s.where(hhmcJobDays), eq(hhmcJobDays.id, dayId), eq(hhmcJobDays.jobId, jobId)))
    .limit(1);
  if (!day) throw new NotFoundError();
  return day;
}

export async function updateJobDay(ctx: BusinessContext, jobId: string, dayId: string, raw: unknown) {
  const values = dayValues(raw);
  return withScope(ctx, P.jobsWrite, async (s) => {
    await editableDays(s, jobId);
    await dayOfJob(s, jobId, dayId);
    return updateRecord(s, jobDayEntity, dayId, values);
  });
}

export async function removeJobDay(ctx: BusinessContext, jobId: string, dayId: string) {
  return withScope(ctx, P.jobsWrite, async (s) => {
    await editableDays(s, jobId);
    await dayOfJob(s, jobId, dayId);
    await archiveRecord(s, jobDayEntity, dayId);
  });
}

/** Actual time worked on a day (entered after the move; it feeds the invoice). */
export async function setActualTime(ctx: BusinessContext, jobId: string, dayId: string, hours: string) {
  const value = Number(hours);
  if (!Number.isFinite(value) || value < 0 || value > 24) throw new ValidationError('Enter the hours worked, from 0 to 24.');
  return withScope(ctx, P.jobsWrite, async (s) => {
    const job = await loadJob(s, jobId);
    if (job.stage !== 'booked' && job.stage !== 'completed')
      throw new ValidationError('Actual time is entered once the job is booked.');
    await dayOfJob(s, jobId, dayId);
    return updateRecord(s, jobDayEntity, dayId, { actualMinutes: Math.round(value * 60) });
  });
}

// ---------------------------------------------------------------- book / release

export { trucksOf };

/** The fleet, for the "Trucks for this move" checkboxes. */
export async function listTrucks(ctx: BusinessContext) {
  return withScope(ctx, P.jobsRead, async (s) => (await trucksOf(s)).map((t) => ({ id: t.id, name: t.name })));
}

export type BookingOptions = {
  /**
   * Book even when no truck is free on a day: the day is booked with "no truck yet" and the
   * calendar says so. Without it, a day that needs a truck and finds none stops the booking.
   */
  allowNoTruck?: boolean;
};

/**
 * Books one appointment per truck for each day (the picked trucks first, then the rest of the
 * fleet). A picked truck that is busy stops the booking, so the office decides; it is never
 * swapped silently. A day that needs a truck and finds none free stops it too, unless the
 * office chose to book without a truck for now.
 */
async function bookDays(s: Scope, job: typeof hhmcJobs.$inferSelect, days: (typeof hhmcJobDays.$inferSelect)[], options: BookingOptions) {
  // One booking at a time per business: two moves booked at the same moment must not both
  // take the same free truck (the conflict check below reads, then writes).
  await takeLock(s, `hhmc-booking-trucks:${s.ctx.business.id}`);
  const fleet = await trucksOf(s);
  const picked = job.truckIds.map((id) => fleet.find((t) => t.id === id)).filter((t) => t !== undefined);
  if (picked.length < job.truckIds.length)
    throw new ValidationError('A truck picked on this work request has been retired in Settings › Trucks. Pick the trucks again under "Change details".');
  const trucks = [...picked, ...fleet.filter((t) => !job.truckIds.includes(t.id))];
  const tz = s.ctx.business.timeZone;
  for (const day of days) {
    const startsAt = localTime(day.dayDate, day.startTime, tz);
    const endsAt = new Date(startsAt.getTime() + day.durationMinutes * 60_000);
    // Every picked truck goes, even if the day was set up for fewer.
    const needed = Math.max(day.trucks, picked.length);
    const count = Math.max(1, needed);
    const taken = new Set<string>();
    for (const truck of picked) {
      if ((await findConflicts(s, { startsAt, endsAt, resourceId: truck.id })).length > 0)
        throw new ValidationError(`${truck.name} is already booked on ${day.dayDate}. Pick another truck on the work request, or change the day.`);
    }
    for (let i = 0; i < count; i++) {
      let resourceId: string | null = null;
      for (const truck of trucks) {
        if (taken.has(truck.id)) continue;
        if ((await findConflicts(s, { startsAt, endsAt, resourceId: truck.id })).length === 0) {
          resourceId = truck.id;
          break;
        }
      }
      // A labor-only day (no truck needed) is fine without one; a day that needs one is not.
      if (!resourceId && i < needed && fleet.length > 0 && !options.allowNoTruck) {
        const free = i === 0 ? 'No truck is free' : `Only ${i} of the ${needed} trucks needed ${i === 1 ? 'is' : 'are'} free`;
        throw new ValidationError(`${free} on ${day.dayDate} at that time. Change the day or time, free a truck, or book it without a truck for now.`);
      }
      if (resourceId) taken.add(resourceId);
      await bookAppointment(s, {
        customerId: job.customerId,
        kind: JOB_DAY_KIND,
        startsAt,
        endsAt,
        status: 'confirmed',
        resourceId,
        subjectType: jobDayEntity.key,
        subjectId: day.id,
        notes: `${job.jobNumber} · M:${day.crewSize} / T:${day.trucks}${resourceId ? '' : ' · no truck yet'}`,
      });
    }
  }
}

/** Book This Move (ref §2.1 step 9): staff only, needs a signed estimate. */
export async function bookJob(ctx: BusinessContext, jobId: string, now: Date = new Date(), options: BookingOptions = {}) {
  return withScope(ctx, P.jobsBook, async (s) => {
    authorize(ctx, P.jobsWrite);
    authorize(ctx, CORE.schedulingWrite);
    authorize(ctx, CORE.schedulingRead);
    await takeLock(s, `hhmc-estimates:${jobId}`);
    await takeLock(s, `hhmc-booking:${jobId}`);
    const job = await loadJob(s, jobId);
    if (job.stage !== 'estimate_sent')
      throw new ValidationError(`A job that is ${STAGE_LABELS[job.stage]} cannot be booked.`);
    const [signed] = await s.db
      .select({ id: hhmcEstimates.id })
      .from(hhmcEstimates)
      // An archived (Data tab) signed estimate still counts.
      .where(and(s.where(hhmcEstimates, 'include'), eq(hhmcEstimates.jobId, jobId), eq(hhmcEstimates.status, 'signed')))
      .limit(1);
    if (!signed) throw new ValidationError('The customer must sign the estimate before the job is booked.');
    const days = await jobDaysOf(s, jobId);
    if (days.length === 0) throw new ValidationError('Add at least one job day before booking.');
    await bookDays(s, job, days, options);
    // The move date is the first booked day (lists, dashboard and calendar must agree).
    if (job.moveDate !== days[0].dayDate) await updateRecord(s, jobEntity, jobId, { moveDate: days[0].dayDate });
    await moveStage(s, jobId, 'booked', {}, now);
    const customer = await loadCustomer(s, job.customerId);
    await enqueue(s, 'job_booked', { jobId, recipient: customer.email, optIn: job.automationOptIn }, now);
  });
}

const rescheduleInput = z.object({
  date: z.string().refine(isDateText, 'Enter the new move date'),
  startTime: z.string().refine((v) => v === '' || isTimeText(v), 'Enter the start time as HH:MM').optional(),
  reason: optionalText(300),
  allowNoTruck: z.boolean().optional(),
});

/**
 * Reschedule a booked move in one step: every day moves by the same number of days (the first
 * day lands on the new date; a multi-day move keeps its shape), optionally at a new start time.
 * The trucks are checked again for the new days and the job's move date follows. Everything is
 * one transaction: if the new days cannot be booked, nothing changes.
 */
export async function rescheduleJob(ctx: BusinessContext, jobId: string, raw: unknown, now: Date = new Date()) {
  const input = parse(rescheduleInput, raw);
  return withScope(ctx, P.jobsBook, async (s) => {
    authorize(ctx, P.jobsWrite);
    authorize(ctx, CORE.schedulingWrite);
    authorize(ctx, CORE.schedulingRead);
    await takeLock(s, `hhmc-estimates:${jobId}`);
    await takeLock(s, `hhmc-booking:${jobId}`);
    const job = await loadJob(s, jobId);
    if (job.stage !== 'booked') throw new ValidationError('Only a booked move can be rescheduled. Change the job days instead.');
    const days = await jobDaysOf(s, jobId);
    if (days.length === 0) throw new ValidationError('This move has no job days to move.');
    const today = localDate(now, ctx.business.timeZone);
    if (input.date < today) throw new ValidationError('The new move date cannot be in the past.');
    const shift = Math.round((Date.parse(`${input.date}T12:00:00Z`) - Date.parse(`${days[0].dayDate}T12:00:00Z`)) / 86_400_000);
    const startTime = input.startTime || null;
    if (shift === 0 && (!startTime || days.every((d) => d.startTime === startTime))) throw new ValidationError('That is the date and time the move already has.');
    const from = days.map((d) => `${formatDay(d.dayDate)}, ${formatClock(d.startTime)}`).join(', ');
    await releaseAppointments(s, jobId, 'Rescheduled');
    const moved = [];
    for (const d of days) moved.push(await updateRecord(s, jobDayEntity, d.id, { dayDate: addDays(d.dayDate, shift), ...(startTime ? { startTime } : {}) }));
    await bookDays(s, job, moved, { allowNoTruck: input.allowNoTruck });
    await updateRecord(s, jobEntity, jobId, { moveDate: moved[0].dayDate });
    const to = moved.map((d) => `${formatDay(d.dayDate)}, ${formatClock(d.startTime)}`).join(', ');
    await createRecord(s, noteEntity, {
      jobId,
      kind: 'note',
      body: `Rescheduled from ${from} to ${to}.${input.reason ? ` Reason: ${input.reason}` : ''}`,
      authorName: ctx.actor.name,
    });
  });
}

/** Cancels the booked appointments of a job (used by Release Booking and Cancel job). */
export async function releaseAppointments(s: Scope, jobId: string, reason: string) {
  authorize(s.ctx, CORE.schedulingWrite);
  const days = await jobDaysOf(s, jobId);
  if (days.length === 0) return;
  const booked = await s.db
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        s.where(appointments),
        eq(appointments.subjectType, jobDayEntity.key),
        inArray(appointments.subjectId, days.map((d) => d.id)),
        ne(appointments.status, 'canceled'),
      ),
    );
  for (const a of booked) {
    await updateRecord(s, appointmentEntity, a.id, { status: 'canceled', notes: reason });
  }
}

/** Release Booking (ref §3.3 header): back to Estimate Sent, appointments cancelled. */
export async function releaseBooking(ctx: BusinessContext, jobId: string, now: Date = new Date()) {
  return withScope(ctx, P.jobsBook, async (s) => {
    authorize(ctx, P.jobsWrite);
    await takeLock(s, `hhmc-estimates:${jobId}`); // same order as createInvoice: estimates, then booking
    await takeLock(s, `hhmc-booking:${jobId}`);
    const job = await loadJob(s, jobId);
    if (job.stage !== 'booked') throw new ValidationError('Only a booked job can be released.');
    await releaseAppointments(s, jobId, 'Booking released');
    await moveStage(s, jobId, 'estimate_sent', {}, now);
    await cancelQueued(s, { triggers: ['job_booked'], jobId }, 'The booking was released.');
  });
}

// ---------------------------------------------------------------- schedule

export type ScheduleEntry = {
  dayId: string;
  jobId: string;
  jobNumber: string;
  customerName: string;
  startsAt: Date;
  endsAt: Date;
  crewSize: number;
  trucks: number;
  truckNames: string[];
  unassignedTrucks: number;
};

export type ScheduleDay = {
  date: string;
  entries: ScheduleEntry[];
  crewBooked: number;
  trucksBooked: number;
  soldOut: { id: string; reason: string } | null;
};

/** Booked job days between two local dates (inclusive from, exclusive to), with daily capacity. */
export async function scheduleBetween(ctx: BusinessContext, from: string, to: string) {
  if (!isDateText(from) || !isDateText(to) || to <= from) throw new ValidationError('Choose a valid date range.');
  return withScope(ctx, CORE.schedulingRead, async (s) => {
    authorize(ctx, P.jobsRead);
    const tz = ctx.business.timeZone;
    const start = localTime(from, '00:00', tz);
    const end = localTime(to, '00:00', tz);
    const rows = await s.db
      .select({ appointment: appointments, day: hhmcJobDays, job: hhmcJobs, customer: customers, truck: resources })
      .from(appointments)
      .innerJoin(hhmcJobDays, eq(hhmcJobDays.id, appointments.subjectId))
      .innerJoin(hhmcJobs, eq(hhmcJobs.id, hhmcJobDays.jobId))
      .innerJoin(customers, eq(customers.id, hhmcJobs.customerId))
      .leftJoin(resources, eq(resources.id, appointments.resourceId))
      .where(
        and(
          s.where(appointments),
          eq(appointments.kind, JOB_DAY_KIND),
          ne(appointments.status, 'canceled'),
          gte(appointments.startsAt, start),
          lt(appointments.startsAt, end),
        ),
      )
      .orderBy(asc(appointments.startsAt));
    const blocks = await s.db
      .select()
      .from(unavailability)
      .where(and(s.where(unavailability), isNull(unavailability.resourceId), lt(unavailability.startsAt, end), gte(unavailability.endsAt, start)));
    const settings = await loadSettings(ctx);
    const trucks = await trucksOf(s);

    const days = new Map<string, ScheduleDay>();
    for (let d = from; d < to; d = addDays(d, 1)) {
      const dayStart = localTime(d, '00:00', tz);
      const dayEnd = localTime(addDays(d, 1), '00:00', tz);
      const block = blocks.find((b) => b.startsAt < dayEnd && b.endsAt > dayStart);
      days.set(d, { date: d, entries: [], crewBooked: 0, trucksBooked: 0, soldOut: block ? { id: block.id, reason: block.reason } : null });
    }
    const byDay = new Map<string, ScheduleEntry>();
    for (const r of rows) {
      let entry = byDay.get(r.day.id);
      if (!entry) {
        entry = {
          dayId: r.day.id,
          jobId: r.job.id,
          jobNumber: r.job.jobNumber,
          customerName: personName(r.customer),
          startsAt: r.appointment.startsAt,
          endsAt: r.appointment.endsAt,
          crewSize: r.day.crewSize,
          trucks: r.day.trucks,
          truckNames: [],
          unassignedTrucks: 0,
        };
        byDay.set(r.day.id, entry);
        const date = localDate(r.appointment.startsAt, tz);
        const day = days.get(date);
        if (day) {
          day.entries.push(entry);
          day.crewBooked += r.day.crewSize;
          day.trucksBooked += r.day.trucks;
        }
      }
      if (r.truck) entry.truckNames.push(r.truck.name);
      else if (r.day.trucks > 0) entry.unassignedTrucks++;
    }
    return {
      days: [...days.values()],
      crewCapacity: settings.crewCapacityPerDay,
      truckCapacity: trucks.length > 0 ? trucks.length : settings.truckCapacityPerDay,
      trucks,
    };
  });
}

/** "Mark as Sold Out" (ref §3.13): a business-wide unavailability for the whole local day. */
export async function markSoldOut(ctx: BusinessContext, date: string, reason: string) {
  if (!isDateText(date)) throw new ValidationError('Choose a date.');
  return withScope(ctx, CORE.schedulingWrite, async (s) => {
    authorize(ctx, CORE.schedulingRead);
    const tz = ctx.business.timeZone;
    const startsAt = localTime(date, '00:00', tz);
    const endsAt = localTime(addDays(date, 1), '00:00', tz);
    const [existing] = await s.db
      .select({ id: unavailability.id })
      .from(unavailability)
      .where(and(s.where(unavailability), isNull(unavailability.resourceId), lt(unavailability.startsAt, endsAt), gte(unavailability.endsAt, endsAt)))
      .limit(1);
    if (existing) throw new ValidationError('That date is already sold out.');
    return createRecord(s, unavailabilityEntity, { resourceId: null, startsAt, endsAt, reason: reason.trim().slice(0, 200) || 'Sold out' });
  });
}

export async function unmarkSoldOut(ctx: BusinessContext, unavailabilityId: string) {
  return withScope(ctx, CORE.schedulingWrite, async (s) => {
    if (!isUuid(unavailabilityId)) throw new NotFoundError();
    const [row] = await s.db
      .select()
      .from(unavailability)
      .where(and(s.where(unavailability), eq(unavailability.id, unavailabilityId), isNull(unavailability.resourceId)))
      .limit(1);
    if (!row) throw new NotFoundError();
    await archiveRecord(s, unavailabilityEntity, unavailabilityId);
  });
}

export async function addTruck(ctx: BusinessContext, name: string) {
  const clean = name.trim();
  if (!clean || clean.length > 80) throw new ValidationError('Give the truck a name (up to 80 characters).');
  return withScope(ctx, CORE.schedulingWrite, (s) => createRecord(s, resourceEntity, { kind: 'truck', name: clean, isActive: true }));
}
