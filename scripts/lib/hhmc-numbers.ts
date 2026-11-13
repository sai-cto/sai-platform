/**
 * Every HHMC dashboard number computed a second way: straight SQL over the tables, written
 * independently of src/modules/hhmc/services/dashboard.ts. Used by the integration test and by
 * `npm run hhmc:numbers` (any database: the laptop's, or the pilot's), so a number the managers
 * see can always be checked against the data itself. "All time" range; open and past due as of
 * today in the business's time zone. Totals only: no names.
 */
import type postgres from 'postgres';
import { dashboardSummary, upcomingMoves } from '../../src/modules/hhmc/services/dashboard';
import type { Scope } from '../../src/core/db/scope';

export type NumberCheck = { name: string; dashboard: number | null; sql: number };

/** The numbers straight from SQL (owner connection, explicit business and mode filters). */
export async function sqlNumbers(sql: postgres.Sql, businessId: string, environment: 'live' | 'sandbox', today: string) {
  const one = async (q: Promise<{ n: string | number | null }[]>) => Number((await q)[0]?.n ?? 0);
  const live = (t: string) => sql`${sql(t)}.business_id = ${businessId} and ${sql(t)}.environment = ${environment} and ${sql(t)}.archived_at is null`;
  const leads = await one(sql`select count(*) as n from hhmc_leads where ${live('hhmc_leads')}`);
  const direct = await one(sql`select count(*) as n from hhmc_jobs where ${live('hhmc_jobs')} and lead_id is null and job_number not like '%-job:%'`);
  const convertedLeads = await one(sql`select count(*) as n from hhmc_leads where ${live('hhmc_leads')} and status = 'converted'`);
  return {
    leads,
    enquiries: leads + direct,
    converted: convertedLeads + direct,
    estimatesSent: await one(sql`select count(*) as n from hhmc_estimates where ${live('hhmc_estimates')} and sent_at is not null`),
    estimatesSigned: await one(sql`select count(*) as n from hhmc_estimates where ${live('hhmc_estimates')} and sent_at is not null and signed_at is not null`),
    jobsBooked: await one(sql`select count(*) as n from hhmc_jobs where ${live('hhmc_jobs')} and stage in ('booked','completed','closed') and booked_at is not null`),
    bookedMoves: await one(sql`select count(*) as n from hhmc_jobs where ${live('hhmc_jobs')} and stage in ('booked','completed','closed') and move_date is not null`),
    upcomingMoves: await one(sql`select count(*) as n from hhmc_jobs where ${live('hhmc_jobs')} and stage in ('booked','completed','closed') and move_date >= ${today}`),
    invoicedCount: await one(sql`select count(*) as n from hhmc_invoices where ${live('hhmc_invoices')} and status <> 'void'`),
    invoicedCents: await one(sql`select coalesce(sum(subtotal_cents + service_tax_cents), 0) as n from hhmc_invoices where ${live('hhmc_invoices')} and status <> 'void'`),
    collectedCents: await one(sql`select coalesce(sum(amount_cents - refunded_cents), 0) as n from payments where ${live('payments')} and kind = 'charge' and status = 'succeeded'`),
    openCents: await one(sql`select coalesce(sum(subtotal_cents + service_tax_cents - deposit_received_cents - paid_cents), 0) as n from hhmc_invoices
      where ${live('hhmc_invoices')} and status in ('draft','sent','partially_paid') and subtotal_cents + service_tax_cents - deposit_received_cents - paid_cents > 0`),
    openCount: await one(sql`select count(*) as n from hhmc_invoices
      where ${live('hhmc_invoices')} and status in ('draft','sent','partially_paid') and subtotal_cents + service_tax_cents - deposit_received_cents - paid_cents > 0`),
    pastDueCents: await one(sql`select coalesce(sum(subtotal_cents + service_tax_cents - deposit_received_cents - paid_cents), 0) as n from hhmc_invoices
      where ${live('hhmc_invoices')} and status in ('sent','partially_paid') and due_date < ${today} and subtotal_cents + service_tax_cents - deposit_received_cents - paid_cents > 0`),
  };
}

/** The dashboard's own numbers for the same range ("All time"). */
export async function dashboardNumbers(s: Scope, now: Date) {
  const d = await dashboardSummary(s, { from: null, to: null }, now);
  return {
    leads: d.leads?.count ?? null,
    enquiries: d.leads?.enquiries ?? null,
    converted: d.leads?.converted ?? null,
    estimatesSent: d.estimates.sent,
    estimatesSigned: d.estimates.signed,
    jobsBooked: d.booked.count,
    bookedMoves: d.moves,
    upcomingMoves: await upcomingMoves(s, now),
    invoicedCount: d.invoicedCount,
    invoicedCents: d.invoicedCents,
    collectedCents: d.collectedCents,
    openCents: d.open?.cents ?? null,
    openCount: d.open?.count ?? null,
    pastDueCents: d.pastDue?.cents ?? null,
  };
}

export function compareNumbers(dashboard: Record<string, number | null>, direct: Record<string, number>): NumberCheck[] {
  return Object.keys(direct).map((name) => ({ name, dashboard: dashboard[name] ?? null, sql: direct[name] }));
}
