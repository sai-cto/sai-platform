/**
 * What a STAFF member with the activity-log grant may see in the log: only entries about
 * kinds of records they are allowed to read, plus sandbox resets. Entries about people,
 * permissions and settings are for admins. (Admins, the tech team and executives see the
 * whole log.) Used by the log itself and by every number counted from it.
 */
import { inArray, type SQL } from 'drizzle-orm';
import { activityLog } from '../db/schema';
import { entitiesFor } from '../modules/registry';
import type { BusinessContext } from '../tenancy/context';

export function staffVisibleEntityTypes(ctx: BusinessContext): string[] {
  const readable = entitiesFor(ctx.business.moduleKey)
    .filter((e) => ctx.permissions.has(e.readPermission))
    .map((e) => e.key);
  return [...readable, ...(ctx.permissions.has('business.sandbox.use') ? ['sandbox'] : [])];
}

/** The extra condition for staff; nothing for every other role. */
export function staffActivityFilter(ctx: BusinessContext): SQL | undefined {
  if (ctx.role !== 'business_staff') return undefined;
  // "-" matches no entry: it keeps the list non-empty for someone who can read nothing.
  return inArray(activityLog.entityType, [...staffVisibleEntityTypes(ctx), '-']);
}
