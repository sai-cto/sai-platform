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
  | 'sandbox_reset';

export type ActivityEntry = {
  action: ActivityAction;
  entityType: string;
  entityId?: string | null;
  summary: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

type ActorInfo = { actorUserId: string | null; actorName: string; actorRole: string };

/** Log something done inside a context (a business, or the platform). */
export async function logActivity(tx: Tx, ctx: AnyContext, entry: ActivityEntry): Promise<void> {
  await insertLog(
    tx,
    { actorUserId: ctx.actor.id, actorName: ctx.actor.name, actorRole: ctx.role ?? 'none' },
    ctx.kind === 'business' ? { businessId: ctx.business.id, environment: ctx.environment } : null,
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
