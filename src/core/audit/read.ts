/** Reading the activity log, for one business or for the whole platform. */
import { and, desc, eq, gte, ilike, inArray, lt, or, type SQL } from 'drizzle-orm';
import { activityLog } from '../db/schema';
import { withPlatformScope, withScope } from '../db/scope';
import { entitiesFor } from '../modules/registry';
import type { BusinessContext, PlatformContext } from '../tenancy/context';
import { isUuid } from '../ids';

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

/**
 * What a STAFF member with the activity-log grant may see in it: only entries about kinds of
 * records they are allowed to read, plus sandbox resets. Entries about people, permissions
 * and settings are for admins. (Admins, the tech team and executives see the whole log.)
 */
export function staffVisibleEntityTypes(ctx: BusinessContext): string[] {
  const readable = entitiesFor(ctx.business.moduleKey)
    .filter((e) => ctx.permissions.has(e.readPermission))
    .map((e) => e.key);
  return [...readable, ...(ctx.permissions.has('business.sandbox.use') ? ['sandbox'] : [])];
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
      ctx.role === 'business_staff'
        ? inArray(activityLog.entityType, [...staffVisibleEntityTypes(ctx), '-'])
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
