/** Reading the activity log, for one business or for the whole platform. */
import { and, desc, eq, gte, ilike, isNotNull, isNull, lt, ne, or, type SQL } from 'drizzle-orm';
import { activityLog } from '../db/schema';
import { withPlatformScope, withScope } from '../db/scope';
import type { BusinessContext, PlatformContext } from '../tenancy/context';
import { isUuid } from '../ids';
import { staffActivityFilter } from './visibility';

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
  /**
   * Whose entries: "people" (default: people, and customers acting through a link), "system"
   * (the importer, the seed, scheduled jobs: no person behind them; the admin-only import log),
   * or "all".
   */
  actors?: 'people' | 'system' | 'all';
};

/**
 * An entry made by the system inside a business: no person (actor_user_id null) and not a
 * customer's link. Imports write thousands of these; they are not "changes" anyone made.
 */
export function systemEntry(): SQL {
  return and(isNull(activityLog.actorUserId), isNotNull(activityLog.businessId), ne(activityLog.actorRole, 'customer_link'))!;
}

/** Entries made by people (and customers through a link), and platform events such as sign-ins. */
export function peopleEntry(): SQL {
  return or(isNotNull(activityLog.actorUserId), isNull(activityLog.businessId), eq(activityLog.actorRole, 'customer_link'))!;
}

export type ActivityRow = typeof activityLog.$inferSelect;

function conditions(filters: ActivityFilters): (SQL | undefined)[] {
  const term = filters.search?.trim();
  const pattern = term ? `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const actors = filters.actors ?? 'people';
  return [
    actors === 'people' ? peopleEntry() : actors === 'system' ? systemEntry() : undefined,
    filters.action ? eq(activityLog.action, filters.action) : undefined,
    filters.entityType ? eq(activityLog.entityType, filters.entityType) : undefined,
    filters.entityId ? eq(activityLog.entityId, filters.entityId) : undefined,
    filters.actorUserId && isUuid(filters.actorUserId)
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
      staffActivityFilter(ctx),
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
      filters.businessId && isUuid(filters.businessId)
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
