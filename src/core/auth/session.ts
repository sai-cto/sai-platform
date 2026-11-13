/**
 * Server-side sessions. The browser holds a random token in an httpOnly cookie;
 * the database holds only its SHA-256 hash, so a database leak does not leak sessions.
 */
import crypto from 'node:crypto';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { getDb, type Tx } from '../db/client';
import { sessions, users } from '../db/schema';

export const SESSION_COOKIE = 'sai_session';
/** A session ends this long after sign-in, whatever happens. */
export const SESSION_HOURS = 12;
/** ...and sooner if nobody uses it for this long (a shared office computer left signed in). */
export const SESSION_IDLE_HOURS = 8;
/** Activity is written at most this often, so most requests stay read-only. */
const TOUCH_EVERY_MS = 5 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export type NewSession = { token: string; expiresAt: Date };

export async function createSession(tx: Tx, userId: string): Promise<NewSession> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  await tx.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt };
}

/**
 * The id of the active user this token belongs to, or null if it is missing, expired, idle for
 * SESSION_IDLE_HOURS, or revoked. Using a session keeps it alive (recorded every few minutes).
 */
export async function findSessionUserId(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const now = Date.now();
  const tokenHash = hashToken(token);
  const db = getDb();
  const [row] = await db
    .select({ userId: sessions.userId, lastSeenAt: sessions.lastSeenAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date(now)),
        gt(sessions.lastSeenAt, new Date(now - SESSION_IDLE_HOURS * 60 * 60 * 1000)),
        eq(users.isActive, true),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (now - row.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(now) })
      .where(and(eq(sessions.tokenHash, tokenHash), lt(sessions.lastSeenAt, new Date(now - TOUCH_EVERY_MS))))
      .catch(() => {});
  }
  return row.userId;
}

export async function revokeSession(tx: Tx, token: string): Promise<string | null> {
  const [row] = await tx
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)))
    .returning({ userId: sessions.userId });
  return row?.userId ?? null;
}

/** Ends every session a user has, e.g. when they are deactivated. */
export async function revokeAllSessions(tx: Tx, userId: string): Promise<void> {
  await tx
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
