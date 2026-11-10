/** Reading the activity log, for one business or for the whole platform. */
import { and, desc, eq, gte, ilike, lt, or, type SQL } from 'drizzle-orm';
import { activityLog } from '../db/schema';
import { withPlatformScope, withScope } from '../db/scope';
import type { BusinessContext, PlatformContext } from '../tenancy/context';

export type ActivityFilters = {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  search?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
};

export type ActivityRow = typeof activityLog.$inferSelect;

function conditions(filters: ActivityFilters): (SQL | undefined)[] {
  const term = filters.search?.trim();
  const pattern = term ? `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  return [
    filters.action ? eq(activityLog.action, filters.action) : undefined,
    filters.entityType ? eq(activityLog.entityType, filters.entityType) : undefined,
    filters.entityId ? eq(activityLog.entityId, filters.entityId) : undefined,
    filters.actorUserId && /^[0-9a-f-]{36}$/i.test(filters.actorUserId)
      ? eq(activityLog.actorUserId, filters.actorUserId)
      : undefined,
    filters.from ? gte(activityLog.occurredAt, filters.from) : undefined,
    filters.to ? lt(activityLog.occurredAt, filters.to) : undefined,
    pattern
      ? or(ilike(activityLog.summary, pattern), ilike(activityLog.actorName, pattern))
      : undefined,
  ];
}

const page = (filters: ActivityFilters) => ({
  limit: Math.min(filters.limit ?? 50, 5000),
  offset: filters.offset ?? 0,
});

/** One business's log, for the environment in the context (live or sandbox). */
export function listBusinessActivity(
  ctx: BusinessContext,
  filters: ActivityFilters = {},
): Promise<{ rows: ActivityRow[]; total: number }> {
  return withScope(ctx, 'business.activity.read', async (s) => {
    const where = and(
      eq(activityLog.businessId, ctx.business.id),
      eq(activityLog.environment, ctx.environment),
      ...conditions(filters),
    );
    const { limit, offset } = page(filters);
    const rows = await s.db
      .select()
      .from(activityLog)
      .where(where)
      .orderBy(desc(activityLog.occurredAt), desc(activityLog.id))
      .limit(limit)
      .offset(offset);
    return { rows, total: await s.db.$count(activityLog, where) };
  });
}

/** The whole platform's log, including sign-ins and platform changes. */
export function listPlatformActivity(
  ctx: PlatformContext,
  filters: ActivityFilters & { businessId?: string } = {},
): Promise<{ rows: ActivityRow[]; total: number }> {
  return withPlatformScope(ctx, 'platform.activity.read', async (s) => {
    const where = and(
      filters.businessId && /^[0-9a-f-]{36}$/i.test(filters.businessId)
        ? eq(activityLog.businessId, filters.businessId)
        : undefined,
      ...conditions(filters),
    );
    const { limit, offset } = page(filters);
    const rows = await s.db
      .select()
      .from(activityLog)
      .where(where)
      .orderBy(desc(activityLog.occurredAt), desc(activityLog.id))
      .limit(limit)
      .offset(offset);
    return { rows, total: await s.db.$count(activityLog, where) };
  });
}
