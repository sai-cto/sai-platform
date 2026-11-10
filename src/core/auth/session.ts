/**
 * Server-side sessions. The browser holds a random token in an httpOnly cookie;
 * the database holds only its SHA-256 hash, so a database leak does not leak sessions.
 */
import crypto from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb, type Tx } from '../db/client';
import { sessions, users } from '../db/schema';

export const SESSION_COOKIE = 'sai_session';
export const SESSION_HOURS = 12;

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

/** The id of the active user this token belongs to, or null if it is missing, expired or revoked. */
export async function findSessionUserId(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const [row] = await getDb()
    .select({ userId: sessions.userId })
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
  return row?.userId ?? null;
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
