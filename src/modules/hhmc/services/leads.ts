/**
 * Leads (ref §3.2): raw inquiries before a job exists. New → Disqualified (reason, date) or
 * Converted (into a Job, reusing the customer when email or phone matches).
 */
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { customers } from '@/core/db/schema/tenant';
import { takeLock } from '@/core/db/lock';
import { withScope, type Scope } from '@/core/db/scope';
import { ValidationError } from '@/core/errors';
import { authorize, can } from '@/core/rbac/permissions';
import { customerEntity } from '@/core/records/core-entities';
import { nextRecordNumber } from '@/core/records/numbering';
import { createRecord, updateRecord } from '@/core/records/records';
import type { BusinessContext } from '@/core/tenancy/context';
import { leadEntity } from '../entities';
import { CORE, P } from '../permissions';
import {
  findMatchingCustomer,
  isDateText,
  leadMoveProblem,
  normalizeEmail,
  normalizePhone,
  probableDuplicates,
} from '../rules';
import { hhmcJobs, hhmcLeads, LEAD_SOURCES, type LeadStatus } from '../schema';
import { cancelQueued, enqueue } from './automations';
import { loadLead } from './common';
import { optionalText, parse } from './input';
import { createJobInScope, jobDetailsInput } from './jobs';

export const LEADS_PAGE_SIZE = 25;

export const leadInput = z.object({
  firstName: z.string().trim().max(100).default(''),
  lastName: z.string().trim().max(100).default(''),
  email: z
    .union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email address')])
    .nullish()
    .transform((v) => v || null),
  phone: optionalText(40),
  source: z.enum(LEAD_SOURCES, { message: 'Choose a source' }),
  sourceDetail: optionalText(200),
  moveDate: z
    .string()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || isDateText(v), 'Enter the move date as a date'),
  moveType: z.enum(['residential', 'commercial']).default('residential'),
  storage: z.boolean().default(false),
  bedrooms: optionalText(40),
  originAddress: optionalText(300),
  destinationAddress: optionalText(300),
  ownerName: optionalText(100),
  rating: z.enum(['hot', 'warm', 'cold']).nullish().transform((v) => v ?? null),
  customerNote: optionalText(4000),
  internalNote: optionalText(4000),
  utmSource: optionalText(200),
  utmMedium: optionalText(200),
  utmCampaign: optionalText(200),
  gclid: optionalText(300),
  fbclid: optionalText(300),
});

function checkContact(input: { firstName: string; lastName: string; email: string | null; phone: string | null }) {
  if (!input.firstName && !input.lastName) throw new ValidationError('Enter a first or last name.');
  if (!input.email && !input.phone) throw new ValidationError('Enter an email address or a phone number.');
}

export type LeadFilters = { status?: LeadStatus | 'all'; source?: string; q?: string; page?: number };

export async function listLeads(ctx: BusinessContext, filters: LeadFilters = {}) {
  return withScope(ctx, P.leadsRead, async (s) => {
    const term = filters.q?.trim();
    const pattern = term ? `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const status = filters.status ?? 'new';
    const where = and(
      s.where(hhmcLeads),
      status === 'all' ? undefined : eq(hhmcLeads.status, status),
      filters.source && (LEAD_SOURCES as readonly string[]).includes(filters.source)
        ? eq(hhmcLeads.source, filters.source as (typeof LEAD_SOURCES)[number])
        : undefined,
      pattern
        ? or(
            ilike(hhmcLeads.leadNumber, pattern),
            ilike(sql`${hhmcLeads.firstName} || ' ' || ${hhmcLeads.lastName}`, pattern),
            ilike(hhmcLeads.email, pattern),
            ilike(hhmcLeads.phone, pattern),
          )
        : undefined,
    );
    const page = Math.max(1, filters.page ?? 1);
    const rows = await s.db
      .select()
      .from(hhmcLeads)
      .where(where)
      .orderBy(desc(hhmcLeads.createdAt))
      .limit(LEADS_PAGE_SIZE)
      .offset((page - 1) * LEADS_PAGE_SIZE);
    return { rows, total: await s.db.$count(hhmcLeads, where), page };
  });
}

export async function createLead(ctx: BusinessContext, raw: unknown) {
  const input = parse(leadInput, raw);
  checkContact(input);
  return withScope(ctx, P.leadsWrite, async (s) => {
    const [leadNumber] = await nextRecordNumber(s, leadEntity, hhmcLeads.leadNumber, 'L');
    return createRecord(s, leadEntity, {
      ...input,
      leadNumber,
      ownerName: input.ownerName ?? ctx.actor.name,
      status: 'new',
    });
  });
}

export async function updateLead(ctx: BusinessContext, id: string, raw: unknown) {
  const input = parse(leadInput, raw);
  checkContact(input);
  return withScope(ctx, P.leadsWrite, async (s) => {
    const lead = await loadLead(s, id);
    if (lead.status === 'converted') throw new ValidationError('A converted lead cannot be changed; change its job instead.');
    return updateRecord(s, leadEntity, id, input);
  });
}

export async function disqualifyLead(ctx: BusinessContext, id: string, reason: string, now: Date = new Date()) {
  const why = reason.trim();
  if (!why) throw new ValidationError('Give a reason the lead is disqualified.');
  if (why.length > 500) throw new ValidationError('Use at most 500 characters.');
  return withScope(ctx, P.leadsWrite, async (s) => {
    await takeLock(s, `hhmc-lead:${id}`);
    const lead = await loadLead(s, id);
    const problem = leadMoveProblem(lead.status, 'disqualified');
    if (problem) throw new ValidationError(problem);
    await updateRecord(s, leadEntity, id, { status: 'disqualified', disqualifiedReason: why, disqualifiedAt: now });
    if (can(ctx, P.jobsWrite))
      await cancelQueued(s, { triggers: ['lead_no_contact'], leadId: id }, 'The lead was disqualified.');
  });
}

export async function reopenLead(ctx: BusinessContext, id: string) {
  return withScope(ctx, P.leadsWrite, async (s) => {
    const lead = await loadLead(s, id);
    const problem = leadMoveProblem(lead.status, 'new');
    if (problem) throw new ValidationError(problem);
    await updateRecord(s, leadEntity, id, { status: 'new', disqualifiedReason: null, disqualifiedAt: null });
  });
}

/** "Couldn't reach": starts the no-contact emails at 0 / +24 h / +2 days (ref §9.2). */
export async function startNoContactEmails(ctx: BusinessContext, id: string, now: Date = new Date()) {
  return withScope(ctx, P.leadsWrite, async (s) => {
    authorize(ctx, P.jobsWrite);
    const lead = await loadLead(s, id);
    if (lead.status !== 'new') throw new ValidationError('Only a new lead gets these emails.');
    if (!lead.email) throw new ValidationError('This lead has no email address.');
    if (lead.noContactStartedAt) throw new ValidationError('These emails were already started for this lead.');
    await updateRecord(s, leadEntity, id, { noContactStartedAt: now });
    return enqueue(s, 'lead_no_contact', { leadId: id, recipient: lead.email }, now);
  });
}

async function candidateCustomers(s: Scope, lead: { email: string | null; phone: string | null; firstName: string; lastName: string }) {
  const email = normalizeEmail(lead.email);
  const phoneDigits = normalizePhone(lead.phone);
  const name = `${lead.firstName} ${lead.lastName}`.trim().toLowerCase();
  return s.db
    .select()
    .from(customers)
    .where(
      and(
        s.where(customers),
        or(
          email ? eq(sql`lower(${customers.email})`, email) : undefined,
          phoneDigits.length >= 7 ? sql`regexp_replace(coalesce(${customers.phone}, ''), '\\D', '', 'g') like ${'%' + phoneDigits}` : undefined,
          name ? eq(sql`lower(trim(${customers.firstName} || ' ' || ${customers.lastName}))`, name) : undefined,
        ),
      ),
    )
    .limit(50);
}

/** What converting would do: reuse this customer, or create one; and any probable duplicates. */
export async function conversionPreview(ctx: BusinessContext, id: string) {
  return withScope(ctx, P.leadsRead, async (s) => {
    authorize(ctx, CORE.customersRead);
    const lead = await loadLead(s, id);
    const candidates = await candidateCustomers(s, lead);
    const match = findMatchingCustomer(lead, candidates);
    const duplicates = match ? [] : probableDuplicates(lead, candidates);
    return { lead, match, duplicates };
  });
}

/**
 * Converts a lead into a job (ref §2.1 step 2). Reuses the customer whose email or phone
 * matches; otherwise creates one. A probable duplicate (same name, different details) is only
 * created when `confirmNewCustomer` is set, so staff see the warning first.
 */
export async function convertLead(
  ctx: BusinessContext,
  id: string,
  raw: unknown,
  options: { confirmNewCustomer?: boolean } = {},
  now: Date = new Date(),
) {
  const details = parse(jobDetailsInput.partial({ crewSize: true, trucks: true, jobType: true, serviceType: true }), raw);
  return withScope(ctx, P.leadsWrite, async (s) => {
    authorize(ctx, P.jobsWrite);
    authorize(ctx, CORE.customersRead);
    await takeLock(s, `hhmc-lead:${id}`); // a double click must not convert twice
    const lead = await loadLead(s, id);
    if (lead.status === 'converted') throw new ValidationError('This lead has already been converted.');
    const problem = leadMoveProblem(lead.status, 'converted');
    if (problem) throw new ValidationError(problem);
    const candidates = await candidateCustomers(s, lead);
    let customer = findMatchingCustomer(lead, candidates);
    if (!customer) {
      const duplicates = probableDuplicates(lead, candidates);
      if (duplicates.length > 0 && !options.confirmNewCustomer)
        throw new ValidationError(
          `A customer named ${lead.firstName} ${lead.lastName} already exists with different contact details. Check it is not the same person, then confirm to create a new customer.`,
        );
      authorize(ctx, CORE.customersWrite);
      customer = await createRecord(s, customerEntity, {
        kind: 'person',
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        phone: lead.phone,
        notes: null,
      });
    }
    const serviceType = details.serviceType ?? 'local';
    const job = await createJobInScope(s, {
      companyName: details.companyName ?? null,
      poNumber: details.poNumber ?? null,
      originAddress: details.originAddress ?? lead.originAddress,
      destinationAddress: details.destinationAddress ?? lead.destinationAddress,
      extraStops: details.extraStops ?? [],
      moveDate: details.moveDate ?? lead.moveDate,
      tentative: details.tentative ?? false,
      arrivalWindow: details.arrivalWindow ?? null,
      serviceType,
      jobType: details.jobType ?? (serviceType === 'local' ? 'Local Full Service Move' : serviceType === 'intrastate' ? 'Intrastate Move' : 'Interstate Move'),
      bedrooms: details.bedrooms ?? lead.bedrooms,
      crewSize: details.crewSize ?? 2,
      trucks: details.trucks ?? 1,
      truckIds: details.truckIds ?? [],
      customerComments: details.customerComments ?? lead.customerNote,
      scopeOfWork: details.scopeOfWork ?? null,
      internalNotes: details.internalNotes ?? lead.internalNote,
      ownerName: details.ownerName ?? lead.ownerName,
      coordinators: details.coordinators ?? [],
      rating: details.rating ?? lead.rating,
      source: lead.source,
      sourceDetail: lead.sourceDetail,
      customerId: customer.id,
      leadId: lead.id,
    });
    await updateRecord(s, leadEntity, id, { status: 'converted', convertedAt: now, customerId: customer.id });
    if (can(ctx, P.jobsWrite))
      await cancelQueued(s, { triggers: ['lead_no_contact'], leadId: id }, 'The lead was converted into a job.');
    return { job, customerId: customer.id, reusedCustomer: candidates.some((c) => c.id === customer!.id) };
  });
}

/** The job a converted lead became. */
export async function jobOfLead(s: Scope, leadId: string) {
  const [row] = await s.db.select().from(hhmcJobs).where(and(s.where(hhmcJobs), eq(hhmcJobs.leadId, leadId))).limit(1);
  return row ?? null;
}
