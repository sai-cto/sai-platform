/**
 * Jobs: the one record per move (replaces Work Request + Work Order, ref §10). Creating and
 * changing a job, its notes and calls, and moving its stage through the ONE function that
 * validates every transition (rules.ts canMoveStage).
 */
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { customers } from '@/core/db/schema/tenant';
import { withScope, type Scope } from '@/core/db/scope';
import { ValidationError } from '@/core/errors';
import { nextRecordNumber } from '@/core/records/numbering';
import { createRecord, updateRecord } from '@/core/records/records';
import type { BusinessContext } from '@/core/tenancy/context';
import { jobDayEntity, jobEntity, noteEntity, quoteEntity, quoteLineEntity } from '../entities';
import { P } from '../permissions';
import { isDateText, isJobTypeFor, JOB_TYPES, stageMoveProblem, STAGE_LABELS } from '../rules';
import {
  hhmcCatalogItems,
  hhmcJobs,
  LEAD_SOURCES,
  SERVICE_TYPES,
  type Stage,
} from '../schema';
import { loadSettings } from '../settings';
import { cancelQueued } from './automations';
import { releaseAppointments } from './booking';
import { loadCustomer, loadJob, loadLead } from './common';
import { optionalText, parse, requiredId } from './input';

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

const serviceType = z.enum(SERVICE_TYPES, { message: 'Choose a service type' });
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
  extraStops: z.array(z.string().trim().max(300)).max(10).default([]).transform((list) => list.filter(Boolean)),
  moveDate: optionalDate,
  tentative: z.boolean().default(false),
  arrivalWindow: optionalText(60),
  serviceType,
  jobType: z.string().trim().min(1, 'Choose a job type').max(100),
  bedrooms: optionalText(40),
  crewSize: count('Movers', 1, 20),
  trucks: count('Trucks', 0, 10),
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

function checkJobType(details: { serviceType: (typeof SERVICE_TYPES)[number]; jobType: string }) {
  if (!isJobTypeFor(details.serviceType, details.jobType))
    throw new ValidationError(`For ${details.serviceType} moves, choose one of: ${JOB_TYPES[details.serviceType].join(', ')}.`);
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
  checkJobType(input);
  await loadCustomer(s, input.customerId);
  const settings = await loadSettings(s.ctx);
  const [jobNumber] = await nextRecordNumber(s, jobEntity, hhmcJobs.jobNumber, 'J');
  const job = await createRecord(s, jobEntity, {
    ...input,
    jobNumber,
    leadId: input.leadId ?? null,
    arrivalWindow: input.arrivalWindow ?? settings.defaultArrivalWindow,
    ownerName: input.ownerName ?? s.ctx.actor.name,
    stage: 'qualified',
  });
  const quote = await createRecord(s, quoteEntity, { jobId: job.id, serviceTaxOn: false, convenienceFeeOn: true });
  if (input.serviceType === 'local') {
    const defaults = await s.db
      .select()
      .from(hhmcCatalogItems)
      .where(and(s.where(hhmcCatalogItems), eq(hhmcCatalogItems.isDefaultForLocal, true), eq(hhmcCatalogItems.isActive, true)))
      .orderBy(asc(hhmcCatalogItems.sortOrder));
    for (const [i, item] of defaults.entries()) {
      await createRecord(s, quoteLineEntity, {
        quoteId: quote.id,
        section: item.section,
        catalogItemId: item.id,
        name: item.name,
        unit: item.unit,
        qtyHundredths: 100 * Math.max(1, input.trucks),
        rateCents: item.rateCents,
        sortOrder: i,
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

export async function createJob(ctx: BusinessContext, raw: unknown) {
  const input = parse(jobDetailsInput.extend({ customerId: requiredId('a customer') }), raw);
  return withScope(ctx, P.jobsWrite, (s) => createJobInScope(s, input));
}

export async function updateJob(ctx: BusinessContext, jobId: string, raw: unknown) {
  const input = parse(jobDetailsInput, raw);
  checkJobType(input);
  return withScope(ctx, P.jobsWrite, async (s) => {
    const job = await loadJob(s, jobId);
    if (job.stage === 'closed' || job.stage === 'cancelled')
      throw new ValidationError(`A ${STAGE_LABELS[job.stage].toLowerCase()} job cannot be changed.`);
    return updateRecord(s, jobEntity, jobId, input);
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
  return withScope(ctx, P.jobsWrite, (s) => moveStage(s, jobId, 'lost', { lostReason: reason }));
}

export async function reopenJob(ctx: BusinessContext, jobId: string) {
  return withScope(ctx, P.jobsWrite, (s) => moveStage(s, jobId, 'qualified'));
}

/** Cancelling a booked job also releases its booking (needs the booking permission). */
export async function cancelJob(ctx: BusinessContext, jobId: string, reason: string) {
  return withScope(ctx, P.jobsWrite, async (s) => {
    const job = await loadJob(s, jobId);
    if (job.stage === 'booked') {
      await releaseAppointments(s, jobId, 'Job cancelled');
    }
    return moveStage(s, jobId, 'cancelled', { cancelledReason: reason });
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
