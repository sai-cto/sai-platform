/**
 * Read models for the screens: everything one page needs, loaded in one transaction.
 * Parts the person may not see are left out (null) rather than refused, so a staff member with
 * fewer permissions still gets the rest of the page.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { appointments, customers, payments, resources } from '@/core/db/schema/tenant';
import { withScope } from '@/core/db/scope';
import { listBusinessActivity } from '@/core/audit/read';
import { NotFoundError } from '@/core/errors';
import { can } from '@/core/rbac/permissions';
import type { BusinessContext } from '@/core/tenancy/context';
import { invoiceEntity, jobDayEntity } from '../entities';
import { CORE, P } from '../permissions';
import { isReadyToBook } from '../rules';
import {
  hhmcAutomationRules,
  hhmcCatalogItems,
  hhmcDiscounts,
  hhmcEstimates,
  hhmcInvoices,
  hhmcJobs,
  hhmcNotes,
  hhmcTemplates,
} from '../schema';
import { queueFor } from './automations';
import { jobDaysOf, trucksOf } from './booking';
import { estimatesOf, loadCustomer, loadJob, loadLead } from './common';
import { invoiceLines, invoicesOfJob } from './invoices';
import { jobOfLead } from './leads';
import { quoteSummary } from './quote';
import { sourceRecordsFor } from './source';

export async function jobPage(ctx: BusinessContext, jobId: string) {
  return withScope(ctx, P.jobsRead, async (s) => {
    const job = await loadJob(s, jobId);
    const customer = can(ctx, CORE.customersRead) ? await loadCustomer(s, job.customerId) : null;
    const quote = await quoteSummary(s, jobId);
    const estimates = (await estimatesOf(s, jobId)).reverse();
    const live = estimates.find((e) => e.status === 'sent' || e.status === 'viewed' || e.status === 'signed') ?? null;
    const days = await jobDaysOf(s, jobId);
    const invoices = can(ctx, P.invoicesRead) ? await invoicesOfJob(s, jobId) : null;
    const notes = await s.db
      .select()
      .from(hhmcNotes)
      .where(and(s.where(hhmcNotes), eq(hhmcNotes.jobId, jobId)))
      .orderBy(desc(hhmcNotes.createdAt));
    const queue = await queueFor(s, { jobId });
    const lead = job.leadId ? await loadLead(s, job.leadId).catch(() => null) : null;
    let jobPayments: (typeof payments.$inferSelect)[] | null = null;
    if (can(ctx, CORE.paymentsRead)) {
      // Imported payments with no estimate in force are recorded against the work request itself.
      const subjectIds = [jobId, ...estimates.map((e) => e.id), ...(invoices ?? []).map((i) => i.id)];
      jobPayments = subjectIds.length
        ? await s.db
            .select()
            .from(payments)
            .where(and(s.where(payments), inArray(payments.subjectId, subjectIds)))
            .orderBy(desc(payments.createdAt))
        : [];
    }
    let booked: { appointment: typeof appointments.$inferSelect; truck: string | null }[] = [];
    if (can(ctx, CORE.schedulingRead) && days.length) {
      const rows = await s.db
        .select({ appointment: appointments, truck: resources.name })
        .from(appointments)
        .leftJoin(resources, eq(resources.id, appointments.resourceId))
        .where(and(s.where(appointments), eq(appointments.subjectType, jobDayEntity.key), inArray(appointments.subjectId, days.map((d) => d.id))))
        .orderBy(asc(appointments.startsAt));
      booked = rows;
    }
    const catalog = can(ctx, P.catalogRead)
      ? await s.db.select().from(hhmcCatalogItems).where(and(s.where(hhmcCatalogItems), eq(hhmcCatalogItems.isActive, true))).orderBy(asc(hhmcCatalogItems.sortOrder))
      : [];
    const discounts = can(ctx, P.catalogRead)
      ? await s.db.select().from(hhmcDiscounts).where(and(s.where(hhmcDiscounts), eq(hhmcDiscounts.isActive, true)))
      : [];
    const source = await sourceRecordsFor(s, [
      jobId,
      ...estimates.map((e) => e.id),
      ...(invoices ?? []).map((i) => i.id),
      ...(jobPayments ?? []).map((p) => p.id),
    ]);
    return {
      job,
      customer,
      lead,
      source,
      quote,
      estimates,
      liveEstimate: live,
      readyToBook: isReadyToBook(job.stage, live),
      days,
      booked,
      invoices,
      payments: jobPayments,
      notes,
      queue,
      catalog,
      discounts,
    };
  });
}

/** The job's activity: the job, its estimates and invoices (what staff need to see on one page). */
export async function jobActivity(ctx: BusinessContext, jobId: string, ids: string[]) {
  if (!can(ctx, 'business.activity.read')) return null;
  const all = await Promise.all(
    [jobId, ...ids].map((id) => listBusinessActivity(ctx, { entityId: id, limit: 50 }).then((r) => r.rows).catch(() => [])),
  );
  return all.flat().sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, 60);
}

export async function leadPage(ctx: BusinessContext, leadId: string) {
  return withScope(ctx, P.leadsRead, async (s) => {
    const lead = await loadLead(s, leadId);
    const job = can(ctx, P.jobsRead) ? await jobOfLead(s, leadId) : null;
    const notes = await s.db
      .select()
      .from(hhmcNotes)
      .where(and(s.where(hhmcNotes), eq(hhmcNotes.leadId, leadId)))
      .orderBy(desc(hhmcNotes.createdAt));
    const queue = can(ctx, P.jobsRead) ? await queueFor(s, { leadId }) : [];
    return { lead, job, notes, queue, source: await sourceRecordsFor(s, [leadId]) };
  });
}

export async function invoicePage(ctx: BusinessContext, invoiceId: string) {
  return withScope(ctx, P.invoicesRead, async (s) => {
    const [row] = await s.db
      .select({ invoice: hhmcInvoices, job: hhmcJobs, customer: customers })
      .from(hhmcInvoices)
      .innerJoin(hhmcJobs, eq(hhmcJobs.id, hhmcInvoices.jobId))
      .innerJoin(customers, eq(customers.id, hhmcInvoices.customerId))
      .where(and(s.where(hhmcInvoices), eq(hhmcInvoices.id, invoiceId)))
      .limit(1);
    if (!row) throw new NotFoundError();
    const lines = await invoiceLines(s, invoiceId);
    const invoicePayments = can(ctx, CORE.paymentsRead)
      ? await s.db
          .select()
          .from(payments)
          .where(and(s.where(payments), eq(payments.subjectType, invoiceEntity.key), eq(payments.subjectId, invoiceId)))
          .orderBy(desc(payments.createdAt))
      : null;
    const estimate = row.invoice.estimateId
      ? (
          await s.db
            .select()
            .from(hhmcEstimates)
            .where(and(s.where(hhmcEstimates, 'include'), eq(hhmcEstimates.id, row.invoice.estimateId)))
            .limit(1)
        )[0] ?? null
      : null;
    const source = await sourceRecordsFor(s, [invoiceId, ...(invoicePayments ?? []).map((p) => p.id)]);
    return { ...row, lines, payments: invoicePayments, estimate, source };
  });
}

export async function settingsPage(ctx: BusinessContext) {
  return withScope(ctx, P.catalogRead, async (s) => ({
    catalog: await s.db.select().from(hhmcCatalogItems).where(s.where(hhmcCatalogItems)).orderBy(asc(hhmcCatalogItems.sortOrder)),
    discounts: await s.db.select().from(hhmcDiscounts).where(s.where(hhmcDiscounts)).orderBy(asc(hhmcDiscounts.name)),
    templates: await s.db.select().from(hhmcTemplates).where(s.where(hhmcTemplates)).orderBy(asc(hhmcTemplates.kind), asc(hhmcTemplates.name)),
    rules: await s.db.select().from(hhmcAutomationRules).where(s.where(hhmcAutomationRules)).orderBy(asc(hhmcAutomationRules.trigger), asc(hhmcAutomationRules.delayMinutes)),
    trucks: can(ctx, CORE.schedulingRead) ? await trucksOf(s) : [],
  }));
}

