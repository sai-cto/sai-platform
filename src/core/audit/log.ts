/**
 * The activity log writer. Always called with the SAME transaction as the change it
 * records, so a change and its log entry succeed or fail together.
 */
import type { Tx } from '../db/client';
import { activityLog } from '../db/schema';
import type { AnyContext } from '../tenancy/context';

export type ActivityAction =
  | 'create'
  | 'update'
  | 'archive'
  | 'restore'
  | 'purge'
  | 'permission_change'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'settings_change'
  | 'export'
  | 'import'
  | 'sandbox_reset'
  | 'act_as_start'
  | 'act_as_stop';

export type ActivityEntry = {
  action: ActivityAction;
  entityType: string;
  entityId?: string | null;
  summary: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

/**
 * People, module settings and portal switches are the same in live and test mode, so a
 * change to them is always filed under the LIVE log, whichever mode the person was in.
 */
export function asLive<T extends AnyContext>(ctx: T): T {
  return ctx.kind === 'business' ? { ...ctx, environment: 'live' } : ctx;
}

type ActorInfo = { actorUserId: string | null; actorName: string; actorRole: string };

/**
 * Log something done inside a context (a business, or the platform).
 * `aboutBusinessId` files a PLATFORM action under one business (for example a feature flag
 * set for that business), so it also appears in that business's own log.
 */
export async function logActivity(
  tx: Tx,
  ctx: AnyContext,
  entry: ActivityEntry,
  aboutBusinessId?: string | null,
): Promise<void> {
  const where =
    ctx.kind === 'business'
      ? { businessId: ctx.business.id, environment: ctx.environment }
      : aboutBusinessId
        ? { businessId: aboutBusinessId, environment: 'live' as const }
        : null;
  await insertLog(
    tx,
    // While a super admin acts as someone, the log keeps the super admin's id (the name says both).
    {
      actorUserId: ctx.actor.actingBy?.id ?? ctx.actor.id,
      actorName: ctx.actor.actingBy ? `${ctx.actor.name} (acting: ${ctx.actor.actingBy.name})` : ctx.actor.name,
      actorRole: ctx.role ?? 'none',
    },
    where,
    entry,
  );
}

/** Log an event that happens before there is a context (logins, failed logins). */
export async function logAuthEvent(
  tx: Tx,
  actor: { id: string | null; name: string; role: string },
  entry: ActivityEntry,
): Promise<void> {
  await insertLog(
    tx,
    { actorUserId: actor.id, actorName: actor.name, actorRole: actor.role },
    null,
    entry,
  );
}

async function insertLog(
  tx: Tx,
  actor: ActorInfo,
  where: { businessId: string; environment: 'live' | 'sandbox' } | null,
  entry: ActivityEntry,
): Promise<void> {
  await tx.insert(activityLog).values({
    ...actor,
    businessId: where?.businessId ?? null,
    environment: where?.environment ?? 'live',
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    summary: entry.summary,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
