/**
 * Contacts and the Estimates list (managers' requirements, Nov 2026: the sidebar is "Leads,
 * Estimates, Work Requests, Contacts" plus a calendar and invoices; repeat customers get a
 * "New estimate / work request" button on their contact).
 */
import { and, asc, count, desc, eq, ilike, inArray, max, or, sql } from 'drizzle-orm';
import { withScope } from '@/core/db/scope';
import { customers } from '@/core/db/schema/tenant';
import { NotFoundError } from '@/core/errors';
import { isUuid } from '@/core/ids';
import { can } from '@/core/rbac/permissions';
import type { BusinessContext } from '@/core/tenancy/context';
import { CORE, P } from '../permissions';
import { hhmcEstimates, hhmcInvoices, hhmcJobs, hhmcLeads, type EstimateStatus } from '../schema';
import { balanceOf } from './invoices';

export const CONTACTS_PAGE_SIZE = 50;
export const ESTIMATES_PAGE_SIZE = 50;

function like(q: string | undefined) {
  const term = q?.trim();
  return term ? `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
}

/** HHMC's contacts (the business's core customers) with how many work requests each has. */
export async function listContacts(ctx: BusinessContext, options: { q?: string; page?: number }) {
  return withScope(ctx, CORE.customersRead, async (s) => {
    const page = Math.max(1, options.page ?? 1);
    const term = like(options.q);
    const filter = and(
      s.where(customers),
      term
        ? or(
            ilike(customers.firstName, term),
            ilike(customers.lastName, term),
            ilike(sql`${customers.firstName} || ' ' || ${customers.lastName}`, term),
            ilike(customers.email, term),
            ilike(customers.phone, term),
            ilike(customers.organizationName, term),
          )
        : undefined,
    );
    const jobs = s.db
      .select({ customerId: hhmcJobs.customerId, jobs: count().as('jobs'), lastMove: max(hhmcJobs.moveDate).as('last_move') })
      .from(hhmcJobs)
      .where(s.where(hhmcJobs))
      .groupBy(hhmcJobs.customerId)
      .as('j');
    const [{ total }] = await s.db.select({ total: count() }).from(customers).where(filter);
    const rows = await s.db
      .select({ customer: customers, jobs: jobs.jobs, lastMove: jobs.lastMove })
      .from(customers)
      .leftJoin(jobs, eq(jobs.customerId, customers.id))
      .where(filter)
      .orderBy(desc(sql`coalesce(${jobs.lastMove}, '0001-01-01')`), asc(customers.lastName), asc(customers.firstName))
      .limit(CONTACTS_PAGE_SIZE)
      .offset((page - 1) * CONTACTS_PAGE_SIZE);
    // Work-request numbers only for people who may see work requests.
    const seesJobs = can(ctx, P.jobsRead);
    return { rows: rows.map((r) => ({ ...r, jobs: seesJobs ? Number(r.jobs ?? 0) : null, lastMove: seesJobs ? r.lastMove : null })), total: Number(total) };
  });
}

/** One contact with their leads, work requests and invoices (newest first). */
export async function contactPage(ctx: BusinessContext, customerId: string) {
  return withScope(ctx, CORE.customersRead, async (s) => {
    if (!isUuid(customerId)) throw new NotFoundError();
    const [customer] = await s.db.select().from(customers).where(and(s.where(customers), eq(customers.id, customerId))).limit(1);
    if (!customer) throw new NotFoundError();
    const leads = can(ctx, P.leadsRead)
      ? await s.db.select().from(hhmcLeads).where(and(s.where(hhmcLeads), eq(hhmcLeads.customerId, customerId))).orderBy(desc(hhmcLeads.createdAt))
      : null;
    const jobs = can(ctx, P.jobsRead)
      ? await s.db.select().from(hhmcJobs).where(and(s.where(hhmcJobs), eq(hhmcJobs.customerId, customerId))).orderBy(desc(sql`coalesce(${hhmcJobs.moveDate}, '9999-12-31')`), desc(hhmcJobs.createdAt))
      : null;
    const estimates =
      jobs && jobs.length
        ? await s.db
            .select()
            .from(hhmcEstimates)
            .where(and(s.where(hhmcEstimates), inArray(hhmcEstimates.jobId, jobs.map((j) => j.id))))
            .orderBy(desc(hhmcEstimates.sentAt))
        : [];
    const invoices = can(ctx, P.invoicesRead)
      ? (await s.db.select().from(hhmcInvoices).where(and(s.where(hhmcInvoices), eq(hhmcInvoices.customerId, customerId))).orderBy(desc(hhmcInvoices.invoiceDate))).map((i) => ({ ...i, balanceCents: i.status === 'void' ? 0 : Math.max(balanceOf(i), 0) }))
      : null;
    return { customer, leads, jobs, estimates, invoices, lastJob: jobs?.[0] ?? null };
  });
}

export type EstimateFilter = EstimateStatus | 'open' | 'all';

/** Every estimate version, newest first, with its work request and customer. */
export async function listEstimates(ctx: BusinessContext, options: { status?: EstimateFilter; q?: string; page?: number }) {
  return withScope(ctx, P.jobsRead, async (s) => {
    const page = Math.max(1, options.page ?? 1);
    const status = options.status ?? 'open';
    const term = like(options.q);
    const filter = and(
      s.where(hhmcEstimates),
      status === 'all' ? undefined : status === 'open' ? inArray(hhmcEstimates.status, ['sent', 'viewed', 'signed']) : eq(hhmcEstimates.status, status),
      term
        ? or(
            ilike(hhmcEstimates.estimateNumber, term),
            ilike(hhmcJobs.jobNumber, term),
            ilike(sql`${customers.firstName} || ' ' || ${customers.lastName}`, term),
            ilike(customers.email, term),
            ilike(hhmcEstimates.createdByName, term),
          )
        : undefined,
    );
    const base = s.db
      .select({ estimate: hhmcEstimates, job: hhmcJobs, customer: customers })
      .from(hhmcEstimates)
      .innerJoin(hhmcJobs, and(eq(hhmcJobs.id, hhmcEstimates.jobId), s.where(hhmcJobs, 'include')))
      .innerJoin(customers, and(eq(customers.id, hhmcJobs.customerId), s.where(customers, 'include')))
      .where(filter);
    const [{ total }] = await s.db
      .select({ total: count() })
      .from(hhmcEstimates)
      .innerJoin(hhmcJobs, and(eq(hhmcJobs.id, hhmcEstimates.jobId), s.where(hhmcJobs, 'include')))
      .innerJoin(customers, and(eq(customers.id, hhmcJobs.customerId), s.where(customers, 'include')))
      .where(filter);
    const rows = await base.orderBy(desc(hhmcEstimates.sentAt), desc(hhmcEstimates.version)).limit(ESTIMATES_PAGE_SIZE).offset((page - 1) * ESTIMATES_PAGE_SIZE);
    return { rows, total: Number(total) };
  });
}
