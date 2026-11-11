/**
 * Dashboard numbers (prompt "Dashboard widgets"; ref §3.1, §8 "metrics the rebuild needs").
 * Each function takes a Scope and checks its own permission (ARCHITECTURE: "read helpers that
 * take a scope check their own permission too").
 */
import { and, eq, gte, inArray, isNotNull, lt, min } from 'drizzle-orm';
import type { Scope } from '@/core/db/scope';
import { authorize } from '@/core/rbac/permissions';
import { P } from '../permissions';
import { addDays, localDate, localTime } from '../rules';
import { hhmcEstimates, hhmcInvoices, hhmcJobs, hhmcLeads, LEAD_SOURCES } from '../schema';
import { balanceDueCents } from './pricing';

function monthStart(now: Date, tz: string, monthsBack = 0): Date {
  const today = localDate(now, tz);
  const [y, m] = today.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - monthsBack, 1));
  return localTime(d.toISOString().slice(0, 10), '00:00', tz);
}

export async function leadsThisMonth(s: Scope, now: Date = new Date()) {
  authorize(s.ctx, P.leadsRead);
  const from = monthStart(now, s.ctx.business.timeZone);
  const rows = await s.db
    .select({ status: hhmcLeads.status })
    .from(hhmcLeads)
    .where(and(s.where(hhmcLeads), gte(hhmcLeads.createdAt, from)));
  const converted = rows.filter((r) => r.status === 'converted').length;
  return { leads: rows.length, converted, conversionPercent: rows.length ? Math.round((converted / rows.length) * 100) : 0 };
}

export async function estimateFunnel(s: Scope, now: Date = new Date()) {
  authorize(s.ctx, P.jobsRead);
  const from = monthStart(now, s.ctx.business.timeZone);
  const rows = await s.db
    .select({ status: hhmcEstimates.status, viewedAt: hhmcEstimates.viewedAt, signedAt: hhmcEstimates.signedAt })
    .from(hhmcEstimates)
    .where(and(s.where(hhmcEstimates), gte(hhmcEstimates.sentAt, from)));
  return {
    sent: rows.length,
    viewed: rows.filter((r) => r.viewedAt !== null).length,
    signed: rows.filter((r) => r.signedAt !== null).length,
  };
}

/** Booked revenue = the signed estimate's total of every job booked, by month of booking and by source. */
export async function bookedRevenue(s: Scope, months = 6, now: Date = new Date()) {
  authorize(s.ctx, P.jobsRead);
  const tz = s.ctx.business.timeZone;
  const from = monthStart(now, tz, months - 1);
  const rows = await s.db
    .select({ bookedAt: hhmcJobs.bookedAt, source: hhmcJobs.source, total: hhmcEstimates.totalCents })
    .from(hhmcJobs)
    .innerJoin(hhmcEstimates, and(eq(hhmcEstimates.jobId, hhmcJobs.id), eq(hhmcEstimates.status, 'signed')))
    .where(
      and(
        s.where(hhmcJobs),
        s.where(hhmcEstimates),
        inArray(hhmcJobs.stage, ['booked', 'completed', 'closed']),
        isNotNull(hhmcJobs.bookedAt),
        gte(hhmcJobs.bookedAt, from),
      ),
    );
  const byMonth = new Map<string, number>();
  for (let i = months - 1; i >= 0; i--) byMonth.set(localDate(monthStart(now, tz, i), tz).slice(0, 7), 0);
  const bySource = new Map<string, number>(LEAD_SOURCES.map((src) => [src, 0]));
  for (const r of rows) {
    const month = localDate(r.bookedAt!, tz).slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + r.total);
    bySource.set(r.source, (bySource.get(r.source) ?? 0) + r.total);
  }
  return {
    byMonth: [...byMonth.entries()].map(([bucket, value]) => ({ bucket: `${bucket}-01`, value })),
    bySource: [...bySource.entries()].map(([label, value]) => ({ label, value })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value),
    totalCents: rows.reduce((sum, r) => sum + r.total, 0),
  };
}

export async function invoiceTotals(s: Scope, now: Date = new Date()) {
  authorize(s.ctx, P.invoicesRead);
  const tz = s.ctx.business.timeZone;
  const today = localDate(now, tz);
  const rows = await s.db
    .select()
    .from(hhmcInvoices)
    .where(and(s.where(hhmcInvoices), inArray(hhmcInvoices.status, ['sent', 'partially_paid', 'paid'])));
  const from = monthStart(now, tz);
  let openCents = 0;
  let pastDueCents = 0;
  let paidThisMonthCents = 0;
  let pastDueCount = 0;
  for (const inv of rows) {
    const balance = balanceDueCents(inv.totalCents, inv.depositReceivedCents, inv.paidCents);
    if (inv.status === 'paid') {
      if (inv.paidAt && inv.paidAt >= from) paidThisMonthCents += inv.totalCents;
      continue;
    }
    openCents += balance;
    if (inv.dueDate < today) {
      pastDueCents += balance;
      pastDueCount++;
    }
  }
  return { openCents, pastDueCents, pastDueCount, paidThisMonthCents };
}

/** Median hours from a lead arriving to its job's first estimate being sent (last 90 days of leads). */
export async function medianLeadToEstimateHours(s: Scope, now: Date = new Date()): Promise<number | null> {
  authorize(s.ctx, P.leadsRead);
  authorize(s.ctx, P.jobsRead);
  const since = new Date(now.getTime() - 90 * 24 * 3600 * 1000);
  const rows = await s.db
    .select({ leadAt: hhmcLeads.createdAt, firstSent: min(hhmcEstimates.sentAt) })
    .from(hhmcLeads)
    .innerJoin(hhmcJobs, eq(hhmcJobs.leadId, hhmcLeads.id))
    .innerJoin(hhmcEstimates, eq(hhmcEstimates.jobId, hhmcJobs.id))
    .where(and(s.where(hhmcLeads), s.where(hhmcJobs), s.where(hhmcEstimates, 'include'), gte(hhmcLeads.createdAt, since), isNotNull(hhmcEstimates.sentAt)))
    .groupBy(hhmcLeads.id, hhmcLeads.createdAt);
  const hours = rows
    .filter((r) => r.firstSent)
    .map((r) => (new Date(r.firstSent as unknown as string).getTime() - r.leadAt.getTime()) / 3_600_000)
    .sort((a, b) => a - b);
  if (hours.length === 0) return null;
  const mid = Math.floor(hours.length / 2);
  return hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2;
}

/** Jobs moving in the next 7 days (for the overview). */
export async function upcomingMoves(s: Scope, now: Date = new Date()) {
  authorize(s.ctx, P.jobsRead);
  const today = localDate(now, s.ctx.business.timeZone);
  return s.db.$count(
    hhmcJobs,
    and(s.where(hhmcJobs), eq(hhmcJobs.stage, 'booked'), gte(hhmcJobs.moveDate, today), lt(hhmcJobs.moveDate, addDays(today, 7))),
  );
}


