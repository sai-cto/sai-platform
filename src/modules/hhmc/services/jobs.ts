/**
 * Jobs: the one record per move (replaces Work Request + Work Order, ref §10). Creating and
 * changing a job, its notes and calls, and moving its stage through the ONE function that
 * validates every transition (rules.ts canMoveStage).
 */
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { customers, payments } from '@/core/db/schema/tenant';
import { withScope, type Scope } from '@/core/db/scope';
import { ValidationError } from '@/core/errors';
import { takeLock } from '@/core/db/lock';
import { authorize } from '@/core/rbac/permissions';
import { nextRecordNumber } from '@/core/records/numbering';
import { createRecord, updateRecord } from '@/core/records/records';
import type { BusinessContext } from '@/core/tenancy/context';
import { estimateEntity, jobDayEntity, jobEntity, noteEntity, quoteEntity, quoteLineEntity } from '../entities';
import { P } from '../permissions';
import { isDateText, SERVICE_TYPE_LABELS, stageMoveProblem, STAGE_LABELS, truckSizeOf } from '../rules';
import { isUuid } from '@/core/ids';
import {
  AUTOMATION_TRIGGERS,
  hhmcCatalogItems,
  hhmcEstimates,
  hhmcJobDays,
  hhmcJobs,
  LEAD_SOURCES,
  SERVICE_TYPES,
  type ServiceType,
  type Stage,
} from '../schema';
import { loadSettings } from '../settings';
import { cancelQueued } from './automations';
import { releaseAppointments } from './booking';
import { isTruckLine, sameName } from './builder';
import { loadCustomer, loadJob, loadLead, money, trucksOf } from './common';
import { optionalText, parse, requiredId } from './input';
import { decideServiceType, jobTypeFor, type ServiceTypeDecision } from './service-type';

export const JOBS_PAGE_SIZE = 25;

// ---------------------------------------------------------------- the stage, in one place

/**
 * The ONLY way a job's stage changes. Refuses any move rules.ts does not allow, stamps the
 * dates that go with a stage, writes the activity log (through updateRecord) and cancels
 * the estimate drip whenever the job leaves Estimate Sent.
 */
export async function moveStage(
  s: Scope,
  jobId: string,
  to: Stage,
  extra: { lostReason?: string | null; cancelledReason?: string | null } = {},
  now: Date = new Date(),
) {
  const job = await loadJob(s, jobId);
  if (job.stage === to) return job;
  const problem = stageMoveProblem(job.stage, to);
  if (problem) throw new ValidationError(problem);
  if (to === 'lost' && !extra.lostReason?.trim()) throw new ValidationError('Give a reason the job was lost.');
  if (to === 'cancelled' && !extra.cancelledReason?.trim())
    throw new ValidationError('Give a reason the job was cancelled.');
  const updated = await updateRecord(s, jobEntity, jobId, {
    stage: to,
    lostReason: to === 'lost' ? extra.lostReason!.trim() : to === 'qualified' ? null : undefined,
    cancelledReason: to === 'cancelled' ? extra.cancelledReason!.trim() : undefined,
    bookedAt: to === 'booked' ? now : to === 'estimate_sent' ? null : undefined,
    completedAt: to === 'completed' ? now : undefined,
    closedAt: to === 'closed' ? now : undefined,
  });
  if (to === 'lost' || to === 'cancelled') {
    // The customer's link must not keep working on a dead job (review round 1).
    const open = await s.db
      .select({ id: hhmcEstimates.id })
      .from(hhmcEstimates)
      .where(and(s.where(hhmcEstimates), eq(hhmcEstimates.jobId, jobId), inArray(hhmcEstimates.status, ['sent', 'viewed'])));
    for (const e of open)
      await updateRecord(s, estimateEntity, e.id, { status: 'void', voidedAt: now, voidReason: `The job was ${STAGE_LABELS[to].toLowerCase()}.` });
  }
  if (job.stage === 'estimate_sent') {
    await cancelQueued(s, { triggers: ['estimate_sent'], jobId }, `The job moved to ${STAGE_LABELS[to]}.`);
  }
  return updated;
}

// ---------------------------------------------------------------- list

export type JobFilters = { stage?: Stage | 'open' | 'all'; q?: string; page?: number };

const OPEN_STAGES: Stage[] = ['qualified', 'estimate_sent', 'booked', 'completed'];

export async function listJobs(ctx: BusinessContext, filters: JobFilters = {}) {
  return withScope(ctx, P.jobsRead, async (s) => {
    const stage = filters.stage ?? 'open';
    const term = filters.q?.trim();
    const pattern = term ? `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const where = and(
      s.where(hhmcJobs),
      stage === 'all' ? undefined : stage === 'open' ? inArray(hhmcJobs.stage, OPEN_STAGES) : eq(hhmcJobs.stage, stage),
      pattern
        ? or(
            ilike(hhmcJobs.jobNumber, pattern),
            ilike(hhmcJobs.originAddress, pattern),
            ilike(hhmcJobs.destinationAddress, pattern),
            inArray(
              hhmcJobs.customerId,
              s.db
                .select({ id: customers.id })
                .from(customers)
                .where(
                  and(
                    s.where(customers, 'include'),
                    or(
                      ilike(sql`${customers.firstName} || ' ' || ${customers.lastName}`, pattern),
                      ilike(customers.email, pattern),
                      ilike(customers.phone, pattern),
                    ),
                  ),
                ),
            ),
          )
        : undefined,
    );
    const page = Math.max(1, filters.page ?? 1);
    const rows = await s.db
      .select({ job: hhmcJobs, customer: customers })
      .from(hhmcJobs)
      .innerJoin(customers, eq(customers.id, hhmcJobs.customerId))
      .where(where)
      .orderBy(sql`${hhmcJobs.moveDate} asc nulls last`, desc(hhmcJobs.createdAt))
      .limit(JOBS_PAGE_SIZE)
      .offset((page - 1) * JOBS_PAGE_SIZE);
    const total = await s.db.$count(hhmcJobs, where);
    return { rows, total, page };
  });
}

// ---------------------------------------------------------------- create and change

/** 'auto' (the default): the service type follows the addresses. A type chosen by staff is an override. */
const serviceType = z.enum(['auto', ...SERVICE_TYPES] as const, { message: 'Choose a service type' }).default('auto');
const optionalDate = z
  .string()
  .nullish()
  .transform((v) => v || null)
  .refine((v) => v === null || isDateText(v), 'Enter the move date as a date');
const count = (label: string, min: number, max: number) =>
  z.coerce.number({ message: `Enter ${label} as a number` }).int().min(min, `${label} must be at least ${min}`).max(max, `${label} must be at most ${max}`);

export const jobDetailsInput = z.object({
  companyName: optionalText(200),
  poNumber: optionalText(100),
  originAddress: optionalText(300),
  destinationAddress: optionalText(300),
  // Google's route lookup takes at most 10 stops: pick-up, 8 extra stops, drop-off.
  extraStops: z.array(z.string().trim().max(300)).max(8, 'At most 8 extra stops').default([]).transform((list) => list.filter(Boolean)),
  moveDate: optionalDate,
  tentative: z.boolean().default(false),
  arrivalWindow: optionalText(60),
  serviceType,
  /** Blank, "-" or one of another service type: the service type's own job type is used. */
  jobType: z.string().trim().max(100).default(''),
  bedrooms: optionalText(40),
  crewSize: count('Movers', 1, 20),
  trucks: count('Trucks', 0, 10),
  /** Specific trucks picked for the move (Settings › Trucks); empty = any free truck. */
  truckIds: z
    .array(z.string().refine(isUuid, 'Choose trucks from the list'))
    .max(10)
    .default([])
    .transform((ids) => [...new Set(ids)]),
  customerComments: optionalText(4000),
  scopeOfWork: optionalText(8000),
  internalNotes: optionalText(4000),
  ownerName: optionalText(100),
  coordinators: z.array(z.string().trim().max(100)).max(10).default([]).transform((list) => list.filter(Boolean)),
  rating: z.enum(['hot', 'warm', 'cold']).nullish().transform((v) => v ?? null),
  source: z.enum(LEAD_SOURCES).default('Other'),
  sourceDetail: optionalText(200),
});

export type JobDetails = z.infer<typeof jobDetailsInput>;

/** The picked trucks, in the business's truck order; refuses one that is unknown or retired. */
async function pickedTrucks(s: Scope, ids: string[]) {
  if (!ids.length) return [];
  const active = await trucksOf(s);
  const picked = active.filter((t) => ids.includes(t.id));
  if (picked.length !== ids.length) throw new ValidationError('A chosen truck is no longer in Settings › Trucks. Reload the page and choose again.');
  return picked;
}

// ---------------------------------------------------------------- service type from the addresses

type Stops = { originAddress: string | null; extraStops: string[]; destinationAddress: string | null };

/**
 * The service-type columns of a job: decided from its addresses (and the checked route, when
 * there is one) unless staff chose a type. `override` is set when staff's choice is a change
 * that differs from what the addresses say: the caller logs it as a note.
 */
export async function serviceTypeColumns(
  s: Scope,
  input: Stops & { serviceType: ServiceType | 'auto'; jobType: string | null; distanceTenths: number | null; routeStates: string[] | null },
) {
  const settings = await loadSettings(s.ctx);
  const decision = decideServiceType({
    stops: [input.originAddress, ...input.extraStops, input.destinationAddress],
    routeStates: input.routeStates,
    distanceTenths: input.distanceTenths,
    localMaxMiles: settings.localServiceMaxMiles,
  });
  const auto = input.serviceType === 'auto';
  const type: ServiceType = auto ? (decision.serviceType ?? 'local') : (input.serviceType as ServiceType);
  return {
    decision,
    values: {
      serviceType: type,
      jobType: jobTypeFor(type, input.jobType),
      serviceTypeSource: auto ? ('auto' as const) : ('manual' as const),
      suggestedServiceType: decision.serviceType,
      routeStates: input.routeStates ?? [],
      routeChecked: input.routeStates !== null,
    },
  };
}

/** The note that records a manager overriding the service type (managers: "log every override"). */
export async function logServiceTypeOverride(s: Scope, jobId: string, from: ServiceType | null, to: ServiceType, decision: ServiceTypeDecision) {
  const says = decision.serviceType ? `the addresses say ${SERVICE_TYPE_LABELS[decision.serviceType]} (${decision.reason})` : decision.reason;
  await createRecord(s, noteEntity, {
    jobId,
    kind: 'note',
    body: `Service type overridden${from ? ` from ${SERVICE_TYPE_LABELS[from]}` : ''} to ${SERVICE_TYPE_LABELS[to]}; ${says}${decision.routeChecked ? '' : ' Route not checked.'}`,
    authorName: s.ctx.actor.name,
  });
}

/**
 * Decides the service type again after the mileage or the route changed, for a job whose type
 * follows its addresses. A type chosen by staff is never changed. Returns whether it changed.
 */
export async function refreshServiceType(s: Scope, jobId: string): Promise<boolean> {
  const job = await loadJob(s, jobId);
  if (job.serviceTypeSource !== 'auto' || !quoteEditableStage(job.stage)) return false;
  const { values } = await serviceTypeColumns(s, { ...job, serviceType: 'auto', routeStates: job.routeChecked ? job.routeStates : null });
  if (values.serviceType === job.serviceType && values.jobType === job.jobType && values.suggestedServiceType === job.suggestedServiceType) return false;
  await updateRecord(s, jobEntity, jobId, { serviceType: values.serviceType, jobType: values.jobType, suggestedServiceType: values.suggestedServiceType });
  return true;
}

function quoteEditableStage(stage: Stage) {
  return stage === 'qualified' || stage === 'estimate_sent';
}

/**
 * Creates a job inside an open scope: the job, its one quote (with the default line for local
 * moves, ref §4.1) and a first job day when the move date is known. Used by "New job" and by
 * converting a lead.
 */
export async function createJobInScope(
  s: Scope,
  input: JobDetails & { customerId: string; leadId?: string | null },
) {
  await loadCustomer(s, input.customerId);
  const { decision, values: typeValues } = await serviceTypeColumns(s, { ...input, distanceTenths: null, routeStates: null });
  const picked = await pickedTrucks(s, input.truckIds ?? []);
  // Picking trucks sets how many the move needs.
  if (picked.length) input = { ...input, trucks: picked.length };
  const settings = await loadSettings(s.ctx);
  const [jobNumber] = await nextRecordNumber(s, jobEntity, hhmcJobs.jobNumber, 'J');
  const job = await createRecord(s, jobEntity, {
    ...input,
    ...typeValues,
    jobNumber,
    leadId: input.leadId ?? null,
    arrivalWindow: input.arrivalWindow ?? settings.defaultArrivalWindow,
    ownerName: input.ownerName ?? s.ctx.actor.name,
    stage: 'qualified',
  });
  if (typeValues.serviceTypeSource === 'manual' && decision.serviceType && decision.serviceType !== typeValues.serviceType)
    await logServiceTypeOverride(s, job.id, null, typeValues.serviceType, decision);
  const quote = await createRecord(s, quoteEntity, { jobId: job.id, serviceTaxOn: settings.serviceTaxOnByDefault, convenienceFeeOn: settings.cardFeeOnByDefault });
  if (typeValues.serviceType === 'local') {
    const defaults = await s.db
      .select()
      .from(hhmcCatalogItems)
      .where(and(s.where(hhmcCatalogItems), eq(hhmcCatalogItems.isDefaultForLocal, true), eq(hhmcCatalogItems.isActive, true)))
      .orderBy(asc(hhmcCatalogItems.sortOrder));
    // Picked trucks put in their own truck line ("26' Truck Local" for a 26' truck), one line
    // per size; a truck whose size is not in its name (e.g. "Van") uses the default truck line.
    const truckLines = picked.length ? await truckLinesFor(s, picked) : null;
    let order = 0;
    for (const item of defaults) {
      if (truckLines && isTruckLine(item.name)) continue;
      await createRecord(s, quoteLineEntity, {
        quoteId: quote.id,
        section: item.section,
        catalogItemId: item.id,
        name: item.name,
        unit: item.unit,
        qtyHundredths: 100 * Math.max(1, input.trucks),
        rateCents: item.rateCents,
        sortOrder: order++,
      });
    }
    for (const t of truckLines ?? []) {
      const item = t.item ?? defaults.find((d) => isTruckLine(d.name));
      if (!item) continue;
      await createRecord(s, quoteLineEntity, {
        quoteId: quote.id,
        section: item.section,
        catalogItemId: item.id,
        name: item.name,
        unit: item.unit,
        qtyHundredths: 100 * t.trucks.length,
        rateCents: item.rateCents,
        description: t.trucks.join(', '),
        sortOrder: order++,
      });
    }
  }
  if (input.moveDate) {
    await createRecord(s, jobDayEntity, {
      jobId: job.id,
      dayDate: input.moveDate,
      startTime: '08:00',
      durationMinutes: Math.round(settings.defaultJobHours * 60),
      crewSize: input.crewSize,
      trucks: input.trucks,
    });
  }
  return job;
}

/** The local truck line for each size among the picked trucks (null item = size unknown). */
async function truckLinesFor(s: Scope, picked: { name: string }[]) {
  const catalog = await s.db
    .select()
    .from(hhmcCatalogItems)
    .where(and(s.where(hhmcCatalogItems), eq(hhmcCatalogItems.isActive, true)));
  const groups = new Map<string, { item: (typeof catalog)[number] | null; trucks: string[] }>();
  for (const truck of picked) {
    const size = truckSizeOf(truck.name);
    const item = size ? (catalog.find((c) => sameName(c.name, `${size}' Truck Local`)) ?? null) : null;
    const key = item?.id ?? 'default';
    const group = groups.get(key) ?? { item, trucks: [] };
    group.trucks.push(truck.name);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export async function createJob(ctx: BusinessContext, raw: unknown) {
  const input = parse(jobDetailsInput.extend({ customerId: requiredId('a customer') }), raw);
  return withScope(ctx, P.jobsWrite, (s) => createJobInScope(s, input));
}

export async function updateJob(ctx: BusinessContext, jobId: string, raw: unknown) {
  const input = parse(jobDetailsInput, raw);
  return withScope(ctx, P.jobsWrite, async (s) => {
    const job = await loadJob(s, jobId);
    if (job.stage === 'closed' || job.stage === 'cancelled')
      throw new ValidationError(`A ${STAGE_LABELS[job.stage].toLowerCase()} job cannot be changed.`);
    // The move date of a booked (or done) move is its first booked day: it changes only by
    // rescheduling, so the calendar, the lists and the booking can never disagree.
    const newDate = input.moveDate ?? null;
    if (newDate !== job.moveDate && (job.stage === 'booked' || job.stage === 'completed'))
      throw new ValidationError(job.stage === 'booked' ? 'This move is booked: use "Reschedule" to change its date.' : 'This move is done: its date can no longer change.');
    const picked = await pickedTrucks(s, input.truckIds);
    // New addresses make the old mileage wrong: clear it, so it is looked up again (or retyped).
    const stops = (j: { originAddress: string | null; extraStops: string[]; destinationAddress: string | null }) =>
      [j.originAddress ?? '', ...j.extraStops, j.destinationAddress ?? ''].join('\n');
    const routeChanged = stops(job) !== stops(input);
    // Picked trucks also set the truck count of the move days (until the move is booked; a booked
    // move's days are changed by releasing the booking first).
    if (picked.length && job.stage !== 'booked' && job.stage !== 'completed') {
      const days = await s.db.select().from(hhmcJobDays).where(and(s.where(hhmcJobDays), eq(hhmcJobDays.jobId, jobId)));
      for (const d of days) if (d.trucks !== picked.length) await updateRecord(s, jobDayEntity, d.id, { trucks: picked.length });
    }
    // Not booked yet: the day on the old move date moves with it (or one is added).
    if (newDate && newDate !== job.moveDate && (job.stage === 'qualified' || job.stage === 'estimate_sent')) {
      const days = await s.db.select().from(hhmcJobDays).where(and(s.where(hhmcJobDays), eq(hhmcJobDays.jobId, jobId))).orderBy(hhmcJobDays.dayDate);
      const onOld = days.find((d) => d.dayDate === job.moveDate);
      if (onOld) await updateRecord(s, jobDayEntity, onOld.id, { dayDate: newDate });
      else if (days.length === 0) {
        const settings = await loadSettings(ctx);
        await createRecord(s, jobDayEntity, { jobId, dayDate: newDate, startTime: '08:00', durationMinutes: Math.round(settings.defaultJobHours * 60), crewSize: input.crewSize ?? job.crewSize, trucks: picked.length || (input.trucks ?? job.trucks) });
      }
    }
    // The route's states and the distance only stay while the addresses are the same.
    const { decision, values: typeValues } = await serviceTypeColumns(s, {
      ...input,
      distanceTenths: routeChanged ? null : job.distanceTenths,
      routeStates: !routeChanged && job.routeChecked ? job.routeStates : null,
    });
    const updated = await updateRecord(s, jobEntity, jobId, {
      ...input,
      ...typeValues,
      ...(picked.length ? { trucks: picked.length } : {}),
      ...(routeChanged ? { distanceTenths: null, driveMinutes: null, distanceSource: null } : {}),
    });
    const overridden = typeValues.serviceTypeSource === 'manual' && (job.serviceTypeSource !== 'manual' || job.serviceType !== typeValues.serviceType);
    if (overridden) await logServiceTypeOverride(s, jobId, job.serviceType, typeValues.serviceType, decision);
    return updated;
  });
}

/** Turns the drip emails on or off for this job. Off also cancels anything queued. */
export async function setAutomationOptIn(ctx: BusinessContext, jobId: string, on: boolean) {
  return withScope(ctx, P.jobsWrite, async (s) => {
    await loadJob(s, jobId);
    await updateRecord(s, jobEntity, jobId, { automationOptIn: on });
    if (!on) {
      await cancelQueued(s, { triggers: ['estimate_sent', 'invoice_paid'], jobId }, 'Automation opt-in was turned off.');
    }
  });
}

export async function markLost(ctx: BusinessContext, jobId: string, reason: string) {
  return withScope(ctx, P.jobsWrite, async (s) => {
    // Same lock as signing and deposits: a customer cannot sign or pay while the job is lost.
    await takeLock(s, `hhmc-estimates:${jobId}`);
    return moveStage(s, jobId, 'lost', { lostReason: reason });
  });
}

export async function reopenJob(ctx: BusinessContext, jobId: string) {
  return withScope(ctx, P.jobsWrite, (s) => moveStage(s, jobId, 'qualified'));
}

export type DepositOutcome = 'kept' | 'refund';
export const DEPOSIT_OUTCOME_LABELS: Record<DepositOutcome, string> = {
  kept: 'kept (not refunded)',
  refund: 'to be refunded outside the software',
};

/** Money received for this move before an invoice: deposits on its estimates, and payments on the job itself. */
export async function depositsReceived(s: Scope, jobId: string): Promise<number> {
  const estimates = await s.db.select({ id: hhmcEstimates.id }).from(hhmcEstimates).where(and(s.where(hhmcEstimates, 'include'), eq(hhmcEstimates.jobId, jobId)));
  const rows = await s.db
    .select({ amount: payments.amountCents, refunded: payments.refundedCents })
    .from(payments)
    .where(
      and(
        s.where(payments),
        eq(payments.status, 'succeeded'),
        or(
          and(eq(payments.subjectType, jobEntity.key), eq(payments.subjectId, jobId)),
          estimates.length ? and(eq(payments.subjectType, estimateEntity.key), inArray(payments.subjectId, estimates.map((e) => e.id))) : undefined,
        ),
      ),
    );
  return rows.reduce((t, r) => t + r.amount - r.refunded, 0);
}

/**
 * Cancel (ref §2.1 step 14): records why and, when a deposit was paid, what happens to it. The
 * software takes no refund itself: a refund is made where the money was taken (Shopify, check)
 * and recorded here as "to be refunded". Cancelling a booked job releases its booking (needs the
 * booking permission).
 */
export async function cancelJob(ctx: BusinessContext, jobId: string, reason: string, options: { deposit?: DepositOutcome } = {}) {
  return withScope(ctx, P.jobsWrite, async (s) => {
    await takeLock(s, `hhmc-estimates:${jobId}`);
    await takeLock(s, `hhmc-booking:${jobId}`);
    const job = await loadJob(s, jobId);
    if (job.stage === 'booked') authorize(ctx, P.jobsBook); // cancelling a booked job releases its booking
    const why = reason.trim();
    if (!why) throw new ValidationError('Give a reason the job was cancelled.');
    const deposit = await depositsReceived(s, jobId);
    if (deposit > 0 && !options.deposit) throw new ValidationError(`A deposit of ${money(deposit)} was paid: say whether it is kept or to be refunded.`);
    if (options.deposit && !(options.deposit in DEPOSIT_OUTCOME_LABELS)) throw new ValidationError('Choose what happens to the deposit.');
    if (job.stage === 'booked') await releaseAppointments(s, jobId, 'Job cancelled');
    const depositNote = deposit > 0 && options.deposit ? ` · Deposit ${money(deposit)}: ${DEPOSIT_OUTCOME_LABELS[options.deposit]}` : '';
    const updated = await moveStage(s, jobId, 'cancelled', { cancelledReason: `${why}${depositNote}` });
    // Every email still waiting for this job stops (reminders, follow-ups, invoice reminders).
    await cancelQueued(s, { triggers: [...AUTOMATION_TRIGGERS], jobId }, 'The job was cancelled.');
    await createRecord(s, noteEntity, { jobId, kind: 'note', body: `Cancelled: ${why}${depositNote}.`, authorName: ctx.actor.name });
    return updated;
  });
}

// ---------------------------------------------------------------- notes and calls

export const noteInput = z.object({
  kind: z.enum(['note', 'call']),
  callOutcome: z.enum(['spoke', 'voicemail', 'ringcentral']).nullish().transform((v) => v ?? null),
  body: z.string().trim().max(4000, 'Use at most 4000 characters'),
});

export async function addNote(ctx: BusinessContext, target: { jobId?: string; leadId?: string }, raw: unknown) {
  const input = parse(noteInput, raw);
  if (input.kind === 'call' && !input.callOutcome) throw new ValidationError('Choose how the call went.');
  if (input.kind === 'note' && !input.body) throw new ValidationError('Write the note.');
  return withScope(ctx, target.jobId ? P.jobsWrite : P.leadsWrite, async (s) => {
    if (target.jobId) await loadJob(s, target.jobId);
    if (target.leadId) {
      await loadLead(s, target.leadId);
    }
    return createRecord(s, noteEntity, {
      jobId: target.jobId ?? null,
      leadId: target.leadId ?? null,
      kind: input.kind,
      callOutcome: input.kind === 'call' ? input.callOutcome : null,
      body: input.body,
      authorName: ctx.actor.name,
    });
  });
}
