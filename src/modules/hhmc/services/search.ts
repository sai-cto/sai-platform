/**
 * One search across Hired Hands: customers, leads, work requests, estimates and invoices, by name,
 * email, phone (any formatting) or number. Each kind is searched only when the person may read
 * it, at most 6 hits each, newest first. Used by the console's search box (Ctrl/Cmd-K).
 */
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { customers } from '@/core/db/schema/tenant';
import { withScope } from '@/core/db/scope';
import type { SearchHit } from '@/core/modules/contract';
import { can } from '@/core/rbac/permissions';
import { formatDay, formatPhone } from '@/ui/format';
import type { BusinessContext } from '@/core/tenancy/context';
import { CORE, P } from '../permissions';
import { hhmcEstimates, hhmcInvoices, hhmcJobs, hhmcLeads } from '../schema';
import { ESTIMATE_STATUS_LABELS, INVOICE_STATUS_LABELS, LEAD_STATUS_LABELS, STAGE_LABELS } from '../rules';
import { personName } from './common';

const PER_KIND = 6;

/** "%term%" with the LIKE wildcards in the term itself escaped. */
const contains = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function searchHhmc(ctx: BusinessContext, raw: string, basePath: string): Promise<SearchHit[]> {
  const term = raw.trim().slice(0, 100);
  if (term.length < 2) return [];
  const pattern = contains(term);
  const digits = term.replace(/\D/g, '');
  // A phone is matched on its digits alone, so "607 555-0101", "(607) 5550101" all find it.
  const phoneMatch = (column: typeof customers.phone | typeof hhmcLeads.phone): SQL | undefined =>
    digits.length >= 4 ? sql`regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g') like ${contains(digits)}` : undefined;
  const nameOf = (t: typeof customers | typeof hhmcLeads) => sql`coalesce(${t.firstName}, '') || ' ' || coalesce(${t.lastName}, '')`;

  return withScope(ctx, P.jobsRead, async (s) => {
    const hits: SearchHit[] = [];
    const seesCustomers = can(ctx, CORE.customersRead);
    const customerMatch = or(ilike(nameOf(customers), pattern), ilike(customers.email, pattern), ilike(customers.organizationName, pattern), phoneMatch(customers.phone));
    const matchedCustomers = seesCustomers
      ? await s.db
          .select({ id: customers.id, kind: customers.kind, firstName: customers.firstName, lastName: customers.lastName, organizationName: customers.organizationName, email: customers.email, phone: customers.phone })
          .from(customers)
          .where(and(s.where(customers), customerMatch))
          .orderBy(desc(customers.createdAt))
          .limit(50)
      : [];
    for (const c of matchedCustomers.slice(0, PER_KIND))
      hits.push({ group: 'Contacts', label: personName(c), detail: [c.email, c.phone ? formatPhone(c.phone) : null].filter(Boolean).join(' · '), href: `${basePath}/contacts/${c.id}` });
    const customerIds = matchedCustomers.map((c) => c.id);

    if (can(ctx, P.leadsRead)) {
      const leads = await s.db
        .select({ id: hhmcLeads.id, leadNumber: hhmcLeads.leadNumber, firstName: hhmcLeads.firstName, lastName: hhmcLeads.lastName, email: hhmcLeads.email, status: hhmcLeads.status })
        .from(hhmcLeads)
        .where(and(s.where(hhmcLeads), or(ilike(hhmcLeads.leadNumber, pattern), ilike(nameOf(hhmcLeads), pattern), ilike(hhmcLeads.email, pattern), phoneMatch(hhmcLeads.phone))))
        .orderBy(desc(hhmcLeads.createdAt))
        .limit(PER_KIND);
      for (const l of leads)
        hits.push({ group: 'Leads', label: `${l.leadNumber} · ${`${l.firstName} ${l.lastName}`.trim() || l.email || 'No name'}`, detail: LEAD_STATUS_LABELS[l.status], href: `${basePath}/leads/${l.id}` });
    }

    const jobs = await s.db
      .select({ id: hhmcJobs.id, jobNumber: hhmcJobs.jobNumber, moveDate: hhmcJobs.moveDate, stage: hhmcJobs.stage, customer: { kind: customers.kind, firstName: customers.firstName, lastName: customers.lastName, organizationName: customers.organizationName, email: customers.email } })
      .from(hhmcJobs)
      .innerJoin(customers, eq(customers.id, hhmcJobs.customerId))
      .where(and(s.where(hhmcJobs), or(ilike(hhmcJobs.jobNumber, pattern), customerIds.length ? inArray(hhmcJobs.customerId, customerIds) : undefined)))
      .orderBy(desc(sql`coalesce(${hhmcJobs.moveDate}, '0001-01-01')`))
      .limit(PER_KIND);
    for (const j of jobs)
      hits.push({ group: 'Work requests', label: `${j.jobNumber} · ${seesCustomers ? personName(j.customer) : ''}`.replace(/ · $/, ''), detail: [j.moveDate ? formatDay(j.moveDate) : null, STAGE_LABELS[j.stage]].filter(Boolean).join(' · '), href: `${basePath}/jobs/${j.id}` });

    const estimates = await s.db
      .select({ id: hhmcEstimates.id, number: hhmcEstimates.estimateNumber, version: hhmcEstimates.version, status: hhmcEstimates.status, jobId: hhmcEstimates.jobId, customer: { kind: customers.kind, firstName: customers.firstName, lastName: customers.lastName, organizationName: customers.organizationName, email: customers.email } })
      .from(hhmcEstimates)
      .innerJoin(hhmcJobs, eq(hhmcJobs.id, hhmcEstimates.jobId))
      .innerJoin(customers, eq(customers.id, hhmcJobs.customerId))
      .where(and(s.where(hhmcEstimates), or(ilike(hhmcEstimates.estimateNumber, pattern), customerIds.length ? inArray(hhmcJobs.customerId, customerIds) : undefined)))
      .orderBy(desc(hhmcEstimates.createdAt))
      .limit(PER_KIND);
    for (const e of estimates) hits.push({ group: 'Estimates', label: `${e.number} v${e.version}${seesCustomers ? ` · ${personName(e.customer)}` : ''}`, detail: ESTIMATE_STATUS_LABELS[e.status], href: `${basePath}/jobs/${e.jobId}` });

    if (can(ctx, P.invoicesRead)) {
      const invoices = await s.db
        .select({ id: hhmcInvoices.id, number: hhmcInvoices.invoiceNumber, status: hhmcInvoices.status, date: hhmcInvoices.invoiceDate, customer: { kind: customers.kind, firstName: customers.firstName, lastName: customers.lastName, organizationName: customers.organizationName, email: customers.email } })
        .from(hhmcInvoices)
        .innerJoin(customers, eq(customers.id, hhmcInvoices.customerId))
        .where(and(s.where(hhmcInvoices), or(ilike(hhmcInvoices.invoiceNumber, pattern), customerIds.length ? inArray(hhmcInvoices.customerId, customerIds) : undefined)))
        .orderBy(desc(hhmcInvoices.invoiceDate))
        .limit(PER_KIND);
      for (const i of invoices) hits.push({ group: 'Invoices', label: `${i.number}${seesCustomers ? ` · ${personName(i.customer)}` : ''}`, detail: `${formatDay(i.date)} · ${INVOICE_STATUS_LABELS[i.status]}`, href: `${basePath}/invoices/${i.id}` });
    }
    return hits;
  });
}
