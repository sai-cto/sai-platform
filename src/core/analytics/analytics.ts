/**
 * Analytics query helpers. Two families:
 *   - inside one business (take a Scope): used by Overview tabs and module widgets;
 *   - across businesses (take a PlatformScope): used by the executive dashboard.
 * Cross-business numbers ALWAYS use live data only; sandbox data never reaches them.
 */
import { and, count, eq, gte, isNull, lt, sql, sum, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { staffActivityFilter } from '../audit/visibility';
import { activityLog, payments, refunds } from '../db/schema';
import type { PlatformScope, Scope } from '../db/scope';
import type { EntityDef } from '../modules/contract';
import { authorize } from '../rbac/permissions';
import type { TenantTable } from '../records/types';

export type DateRange = { from: Date; to: Date };
export type Bucket = 'day' | 'week' | 'month';
export type SeriesPoint = { bucket: string; value: number };
export type Revenue = {
  grossCents: number;
  refundedCents: number;
  netCents: number;
  paymentCount: number;
};

/** All SAI businesses are in Ithaca, so cross-business charts use one time zone. */
export const PLATFORM_TIME_ZONE = 'America/New_York';

function bucketExpr(column: AnyPgColumn, bucket: Bucket, timeZone: string): SQL<string> {
  // The unit and time zone are written into the SQL text (not sent as parameters) so the
  // same expression can be used in both SELECT and GROUP BY. Both are checked first:
  // bucket is a closed union, and the time zone must look like "Area/City".
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(timeZone))
    throw new Error(`Invalid time zone: ${timeZone}`);
  const unit = sql.raw(`'${bucket}'`);
  const zone = sql.raw(`'${timeZone}'`);
  return sql<string>`to_char(date_trunc(${unit}, ${column} at time zone ${zone}), 'YYYY-MM-DD')`;
}

const inRange = (column: AnyPgColumn, range: DateRange) =>
  and(gte(column, range.from), lt(column, range.to));
// (Refunds are counted even when their row is archived: archiving hides a row, it does not un-send money.)
const liveOnly = (table: TenantTable) =>
  and(eq(table.environment, 'live'), isNull(table.archivedAt));
const paidCharge = and(eq(payments.status, 'succeeded'), eq(payments.kind, 'charge'));
const num = (value: unknown) => Number(value ?? 0);

// ---------------------------------------------------------------- one business

export async function revenueSummary(s: Scope, range: DateRange): Promise<Revenue> {
  authorize(s.ctx, 'payments.read');
  const [paid] = await s.db
    .select({ total: sum(payments.amountCents), n: count() })
    .from(payments)
    .where(and(s.where(payments), paidCharge, inRange(payments.paidAt, range)));
  const [refunded] = await s.db
    .select({ total: sum(refunds.amountCents) })
    .from(refunds)
    .where(
      and(
        s.where(refunds, 'include'),
        eq(refunds.status, 'succeeded'),
        inRange(refunds.createdAt, range),
      ),
    );
  const grossCents = num(paid?.total);
  const refundedCents = num(refunded?.total);
  return {
    grossCents,
    refundedCents,
    netCents: grossCents - refundedCents,
    paymentCount: num(paid?.n),
  };
}

export async function revenueSeries(
  s: Scope,
  range: DateRange,
  bucket: Bucket,
): Promise<SeriesPoint[]> {
  authorize(s.ctx, 'payments.read');
  const b = bucketExpr(payments.paidAt, bucket, s.ctx.business.timeZone);
  const rows = await s.db
    .select({ bucket: b, value: sum(payments.amountCents) })
    .from(payments)
    .where(and(s.where(payments), paidCharge, inRange(payments.paidAt, range)))
    .groupBy(b)
    .orderBy(b);
  return rows.map((r) => ({ bucket: r.bucket, value: num(r.value) }));
}

/** How many records of an entity were created in the range. Needs the entity's read permission. */
export async function createdCount(s: Scope, entity: EntityDef, range: DateRange): Promise<number> {
  authorize(s.ctx, entity.readPermission);
  return s.db.$count(
    entity.table,
    and(s.where(entity.table), inRange(entity.table.createdAt, range)),
  );
}

export async function createdSeries(
  s: Scope,
  entity: EntityDef,
  range: DateRange,
  bucket: Bucket,
): Promise<SeriesPoint[]> {
  authorize(s.ctx, entity.readPermission);
  const table = entity.table;
  const b = bucketExpr(table.createdAt, bucket, s.ctx.business.timeZone);
  const rows = await s.db
    .select({ bucket: b, value: count() })
    .from(table)
    .where(and(s.where(table), inRange(table.createdAt, range)))
    .groupBy(b)
    .orderBy(b);
  return rows.map((r) => ({ bucket: r.bucket, value: num(r.value) }));
}

export async function activityCount(s: Scope, range: DateRange): Promise<number> {
  authorize(s.ctx, 'business.activity.read');
  return s.db.$count(
    activityLog,
    and(
      eq(activityLog.businessId, s.ctx.business.id),
      eq(activityLog.environment, s.ctx.environment),
      inRange(activityLog.occurredAt, range),
      // Staff are counted only what they could open in the log itself.
      staffActivityFilter(s.ctx),
    ),
  );
}

// ------------------------------------------------------------ across businesses

export async function revenueByBusiness(
  s: PlatformScope,
  range: DateRange,
): Promise<Map<string, Revenue>> {
  authorize(s.ctx, 'executive.dashboard.read');
  const paid = await s.db
    .select({ businessId: payments.businessId, total: sum(payments.amountCents), n: count() })
    .from(payments)
    .where(and(liveOnly(payments), paidCharge, inRange(payments.paidAt, range)))
    .groupBy(payments.businessId);
  const refunded = await s.db
    .select({ businessId: refunds.businessId, total: sum(refunds.amountCents) })
    .from(refunds)
    .where(
      and(
        eq(refunds.environment, 'live'),
        eq(refunds.status, 'succeeded'),
        inRange(refunds.createdAt, range),
      ),
    )
    .groupBy(refunds.businessId);
  const result = new Map<string, Revenue>();
  for (const row of paid) {
    result.set(row.businessId, {
      grossCents: num(row.total),
      refundedCents: 0,
      netCents: num(row.total),
      paymentCount: num(row.n),
    });
  }
  for (const row of refunded) {
    const entry = result.get(row.businessId) ?? {
      grossCents: 0,
      refundedCents: 0,
      netCents: 0,
      paymentCount: 0,
    };
    entry.refundedCents = num(row.total);
    entry.netCents = entry.grossCents - entry.refundedCents;
    result.set(row.businessId, entry);
  }
  return result;
}

export type BusinessSeriesPoint = SeriesPoint & { businessId: string };

export async function revenueSeriesByBusiness(
  s: PlatformScope,
  range: DateRange,
  bucket: Bucket,
): Promise<BusinessSeriesPoint[]> {
  authorize(s.ctx, 'executive.dashboard.read');
  const b = bucketExpr(payments.paidAt, bucket, PLATFORM_TIME_ZONE);
  const rows = await s.db
    .select({ businessId: payments.businessId, bucket: b, value: sum(payments.amountCents) })
    .from(payments)
    .where(and(liveOnly(payments), paidCharge, inRange(payments.paidAt, range)))
    .groupBy(payments.businessId, b)
    .orderBy(b);
  return rows.map((r) => ({ businessId: r.businessId, bucket: r.bucket, value: num(r.value) }));
}

export async function createdCountByBusiness(
  s: PlatformScope,
  table: TenantTable,
  range: DateRange,
): Promise<Map<string, number>> {
  authorize(s.ctx, 'executive.dashboard.read');
  const rows = await s.db
    .select({ businessId: table.businessId, n: count() })
    .from(table)
    .where(and(liveOnly(table), inRange(table.createdAt, range)))
    .groupBy(table.businessId);
  return new Map(rows.map((r) => [String(r.businessId), num(r.n)]));
}

export async function activityCountByBusiness(
  s: PlatformScope,
  range: DateRange,
): Promise<Map<string, number>> {
  authorize(s.ctx, 'executive.dashboard.read');
  const rows = await s.db
    .select({ businessId: activityLog.businessId, n: count() })
    .from(activityLog)
    .where(and(eq(activityLog.environment, 'live'), inRange(activityLog.occurredAt, range)))
    .groupBy(activityLog.businessId);
  return new Map(rows.filter((r) => r.businessId).map((r) => [String(r.businessId), num(r.n)]));
}

// ---------------------------------------------------------------------- helpers

/** Turns sparse query results into one point per bucket, with zeros where nothing happened. */
export function fillSeries(
  points: SeriesPoint[],
  range: DateRange,
  bucket: Bucket,
  timeZone = PLATFORM_TIME_ZONE,
): SeriesPoint[] {
  const byBucket = new Map(points.map((p) => [p.bucket, p.value]));
  const keys = new Set<string>();
  const cursor = new Date(range.from);
  while (cursor < range.to) {
    keys.add(bucketKey(cursor, bucket, timeZone));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  // The range usually ends "now", part-way through a day: include that last bucket too.
  keys.add(bucketKey(new Date(range.to.getTime() - 1), bucket, timeZone));
  return [...keys].sort().map((key) => ({ bucket: key, value: byBucket.get(key) ?? 0 }));
}

/** The bucket a moment falls in, as YYYY-MM-DD of the bucket's first day (weeks start Monday). */
export function bucketKey(moment: Date, bucket: Bucket, timeZone = PLATFORM_TIME_ZONE): string {
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(moment);
  if (bucket === 'day') return local;
  if (bucket === 'month') return `${local.slice(0, 7)}-01`;
  const date = new Date(`${local}T00:00:00Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

/** The last N days up to now, as a range. */
export function lastDays(days: number, now = new Date()): DateRange {
  return { from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000), to: now };
}
