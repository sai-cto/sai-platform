/**
 * The executive dashboard: per-business numbers and all-SAI totals. Live data only.
 * Read-only by construction: it runs in the platform scope, which cannot write.
 */
import { asc } from 'drizzle-orm';
import { businesses } from '../db/schema';
import { withPlatformScope } from '../db/scope';
import { getModule, findEntity } from '../modules/registry';
import type { PlatformContext } from '../tenancy/context';
import {
  PLATFORM_TIME_ZONE,
  activityCountByBusiness,
  createdCountByBusiness,
  fillSeries,
  lastDays,
  revenueByBusiness,
  revenueSeriesByBusiness,
  type Bucket,
  type SeriesPoint,
} from './analytics';

export type ExecutiveRow = {
  businessId: string;
  slug: string;
  code: string;
  name: string;
  accentColor: string;
  revenueCents: number;
  refundedCents: number;
  payments: number;
  /** Null when the business's module has not defined its unit of work yet. */
  workItems: number | null;
  workItemLabel: string | null;
  activity: number;
  /** Revenue per bucket, oldest first. */
  trend: number[];
};

export type ExecutiveDashboard = {
  days: number;
  bucket: Bucket;
  rows: ExecutiveRow[];
  totals: { revenueCents: number; refundedCents: number; payments: number; workItems: number; activity: number };
  /** All-SAI revenue per bucket. */
  totalTrend: SeriesPoint[];
};

export const EXECUTIVE_RANGES = [30, 90, 365] as const;

export async function executiveDashboard(ctx: PlatformContext, days: number): Promise<ExecutiveDashboard> {
  const range = lastDays(days);
  const bucket: Bucket = days <= 30 ? 'day' : days <= 90 ? 'week' : 'month';
  return withPlatformScope(ctx, 'executive.dashboard.read', async (s) => {
    const all = await s.db.select().from(businesses).orderBy(asc(businesses.sortOrder));
    const revenue = await revenueByBusiness(s, range);
    const series = await revenueSeriesByBusiness(s, range, bucket);
    const activity = await activityCountByBusiness(s, range);

    const rows: ExecutiveRow[] = [];
    for (const b of all) {
      const mod = getModule(b.slug);
      const workEntity = mod?.workItem ? findEntity(b.slug, mod.workItem.entityKey) : undefined;
      const workCounts = workEntity ? await createdCountByBusiness(s, workEntity.table, range) : null;
      const r = revenue.get(b.id);
      const own = series.filter((p) => p.businessId === b.id).map((p) => ({ bucket: p.bucket, value: p.value }));
      rows.push({
        businessId: b.id,
        slug: b.slug,
        code: b.code,
        name: b.name,
        accentColor: b.accentColor,
        revenueCents: r?.netCents ?? 0,
        refundedCents: r?.refundedCents ?? 0,
        payments: r?.paymentCount ?? 0,
        workItems: workCounts ? (workCounts.get(b.id) ?? 0) : null,
        workItemLabel: mod?.workItem?.label ?? null,
        activity: activity.get(b.id) ?? 0,
        trend: fillSeries(own, range, bucket, PLATFORM_TIME_ZONE).map((p) => p.value),
      });
    }

    const byBucket = new Map<string, number>();
    for (const p of series) byBucket.set(p.bucket, (byBucket.get(p.bucket) ?? 0) + p.value);
    const totalTrend = fillSeries([...byBucket].map(([b, value]) => ({ bucket: b, value })), range, bucket, PLATFORM_TIME_ZONE);

    return {
      days,
      bucket,
      rows,
      totals: {
        revenueCents: rows.reduce((sum, r) => sum + r.revenueCents, 0),
        refundedCents: rows.reduce((sum, r) => sum + r.refundedCents, 0),
        payments: rows.reduce((sum, r) => sum + r.payments, 0),
        workItems: rows.reduce((sum, r) => sum + (r.workItems ?? 0), 0),
        activity: rows.reduce((sum, r) => sum + r.activity, 0),
      },
      totalTrend,
    };
  });
}
