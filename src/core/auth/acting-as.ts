/**
 * "Act as": a super admin sees and uses the site exactly as another person does, to check
 * what they see. The choice is stored on the super admin's own session (one browser), lasts
 * at most ACTING_AS_MINUTES, and every change made meanwhile is logged with the super admin's
 * id and "Person (acting: Super admin)" as the name (DECISIONS P5-39).
 *
 * Never: acting as another super admin, as oneself, as a switched-off account, or by anyone
 * who is not (or is no longer) an active super admin. Any of those makes the session fall back
 * to the super admin's own view.
 */
import crypto from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { logAuthEvent } from '../audit/log';
import { getDb } from '../db/client';
import { sessions, users } from '../db/schema';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { isUuid } from '../ids';
import type { PlatformContext } from '../tenancy/context';

export const ACTING_AS_MINUTES = 60;

/** Who a request is for: the person whose view it is, and the super admin behind it, if any. */
export type Principal = { userId: string; actingBy?: { id: string; name: string } };

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function liveSession(token: string) {
  const [row] = await getDb()
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      actingAsUserId: sessions.actingAsUserId,
      actingAsSince: sessions.actingAsSince,
      realName: users.name,
      realRole: users.platformRole,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(users.isActive, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The principal of a session token, or null when it is missing, expired or revoked. */
export async function findSessionPrincipal(token: string | undefined, now = new Date()): Promise<Principal | null> {
  if (!token) return null;
  const row = await liveSession(token);
  if (!row) return null;
  const own: Principal = { userId: row.userId };
  if (!row.actingAsUserId || !row.actingAsSince) return own;
  if (row.realRole !== 'super_admin') return own;
  if (now.getTime() - row.actingAsSince.getTime() > ACTING_AS_MINUTES * 60_000) return own;
  const [target] = await getDb()
    .select({ id: users.id, isActive: users.isActive, platformRole: users.platformRole })
    .from(users)
    .where(eq(users.id, row.actingAsUserId))
    .limit(1);
  if (!target || !target.isActive || target.platformRole === 'super_admin' || target.id === row.userId) return own;
  return { userId: target.id, actingBy: { id: row.userId, name: row.realName } };
}

/** Starts acting as someone. `ctx` must be the super admin's OWN context (not while acting). */
export async function startActingAs(ctx: PlatformContext, token: string, targetUserId: string): Promise<{ name: string }> {
  if (ctx.role !== 'super_admin' || ctx.actor.actingBy) throw new ForbiddenError('platform.act_as');
  if (!isUuid(targetUserId)) throw new NotFoundError();
  const [target] = await getDb().select().from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!target) throw new NotFoundError();
  if (target.id === ctx.actor.id) throw new ValidationError('You are already yourself.');
  if (!target.isActive) throw new ValidationError('This account is switched off: switch it on first.');
  if (target.platformRole === 'super_admin') throw new ValidationError('You cannot act as another super admin.');
  await getDb().transaction(async (tx) => {
    const [updated] = await tx
      .update(sessions)
      .set({ actingAsUserId: target.id, actingAsSince: new Date() })
      .where(and(eq(sessions.tokenHash, hashToken(token)), eq(sessions.userId, ctx.actor.id as string), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (!updated) throw new ForbiddenError('platform.act_as');
    await logAuthEvent(
      tx,
      { id: ctx.actor.id, name: ctx.actor.name, role: 'super_admin' },
      {
        action: 'act_as_start',
        entityType: 'user',
        entityId: target.id,
        summary: `Started acting as ${target.name} (${target.email}) for up to ${ACTING_AS_MINUTES} minutes`,
      },
    );
  });
  return { name: target.name };
}

/** Back to one's own view. Does nothing when the session is not acting as anyone. */
export async function stopActingAs(token: string): Promise<void> {
  const row = await liveSession(token);
  if (!row?.actingAsUserId) return;
  const [target] = await getDb().select({ name: users.name }).from(users).where(eq(users.id, row.actingAsUserId)).limit(1);
  await getDb().transaction(async (tx) => {
    await tx.update(sessions).set({ actingAsUserId: null, actingAsSince: null }).where(eq(sessions.id, row.sessionId));
    await logAuthEvent(
      tx,
      { id: row.userId, name: row.realName, role: row.realRole ?? 'none' },
      { action: 'act_as_stop', entityType: 'user', entityId: row.actingAsUserId, summary: `Stopped acting as ${target?.name ?? 'someone'}` },
    );
  });
}
