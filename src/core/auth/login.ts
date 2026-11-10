/**
 * Signing in and out. Every outcome — success, failure, sign-out — is written to the
 * activity log.
 *
 * People are never created by signing in: an account must already exist (created by the
 * tech team or a business admin). A provider identity is linked to that account by its
 * verified email address the first time it is used.
 */
import { and, asc, eq } from 'drizzle-orm';
import { logAuthEvent } from '../audit/log';
import { getDb } from '../db/client';
import { authIdentities, users } from '../db/schema';
import { ForbiddenError, UnauthenticatedError } from '../errors';
import { googleProvider } from './providers/google';
import { microsoftProvider } from './providers/microsoft';
import type { ExternalIdentity, OAuthProvider } from './providers/types';
import { createSession, revokeSession, type NewSession } from './session';
import { isUuid } from '../ids';

export const OAUTH_PROVIDERS: OAuthProvider[] = [microsoftProvider, googleProvider];

export function getOAuthProvider(id: string): OAuthProvider | undefined {
  return OAUTH_PROVIDERS.find((p) => p.id === id && p.isEnabled());
}

/** The pick-a-user login exists for local development only. It can never be on in production. */
export function isDevLoginEnabled(): boolean {
  return process.env.AUTH_DEV_LOGIN === 'true' && process.env.NODE_ENV !== 'production';
}

export type DevLoginUser = { id: string; name: string; email: string; platformRole: string | null };

export async function listDevLoginUsers(): Promise<DevLoginUser[]> {
  if (!isDevLoginEnabled()) return [];
  return getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      platformRole: users.platformRole,
    })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(asc(users.createdAt), asc(users.email));
}

async function startSession(userId: string, provider: string): Promise<NewSession> {
  return getDb()
    .transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user || !user.isActive) {
        await logAuthEvent(
          tx,
          { id: null, name: 'Unknown', role: 'none' },
          {
            action: 'login_failed',
            entityType: 'user',
            entityId: userId,
            summary: `Sign-in refused (${provider}): no active account`,
          },
        );
        return null;
      }
      const session = await createSession(tx, user.id);
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await logAuthEvent(
        tx,
        { id: user.id, name: user.name, role: user.platformRole ?? 'business' },
        {
          action: 'login',
          entityType: 'user',
          entityId: user.id,
          summary: `${user.name} signed in (${provider})`,
        },
      );
      return session;
    })
    .then((session) => {
      if (!session) throw new UnauthenticatedError('No active account matches this sign-in.');
      return session;
    });
}

/** Logs a sign-in attempt that failed before any account was identified. */
export async function recordFailedSignIn(provider: string, reason: string): Promise<void> {
  await getDb().transaction((tx) =>
    logAuthEvent(
      tx,
      { id: null, name: 'Unknown', role: 'none' },
      {
        action: 'login_failed',
        entityType: 'user',
        summary: `Sign-in refused (${provider}): ${reason}`,
      },
    ),
  );
}

export async function loginWithDev(userId: string): Promise<NewSession> {
  if (!isDevLoginEnabled()) throw new ForbiddenError('auth.dev_login', 'Dev login is disabled.');
  if (!isUuid(userId)) {
    await recordFailedSignIn('dev', 'malformed user id');
    throw new UnauthenticatedError();
  }
  return startSession(userId, 'dev');
}

/** Completes a Microsoft or Google sign-in. */
export async function loginWithIdentity(identity: ExternalIdentity): Promise<NewSession> {
  const db = getDb();
  const refuse = async (reason: string): Promise<never> => {
    await db.transaction((tx) =>
      logAuthEvent(
        tx,
        { id: null, name: identity.email || 'Unknown', role: 'none' },
        {
          action: 'login_failed',
          entityType: 'user',
          summary: `Sign-in refused (${identity.provider}): ${reason}`,
        },
      ),
    );
    throw new UnauthenticatedError('No active account matches this sign-in.');
  };
  if (!identity.subject) return refuse('provider returned no id');

  const [linked] = await db
    .select({ userId: authIdentities.userId })
    .from(authIdentities)
    .where(
      and(
        eq(authIdentities.provider, identity.provider),
        eq(authIdentities.providerSubject, identity.subject),
      ),
    )
    .limit(1);
  if (linked) return startSession(linked.userId, identity.provider);

  if (!identity.emailVerified || !identity.email)
    return refuse('email address not verified by provider');
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, identity.email.toLowerCase()))
    .limit(1);
  if (!user || !user.isActive) return refuse('no active account with that email');
  // First sign-in with this provider: remember the link, and log that it was made.
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(authIdentities)
      .values({ userId: user.id, provider: identity.provider, providerSubject: identity.subject })
      .onConflictDoNothing()
      .returning({ id: authIdentities.id });
    if (inserted.length === 0) return;
    await logAuthEvent(
      tx,
      { id: user.id, name: user.name, role: user.platformRole ?? 'business' },
      {
        action: 'permission_change',
        entityType: 'user',
        entityId: user.id,
        summary: `Linked ${identity.provider} sign-in to ${user.name}`,
        after: { provider: identity.provider },
      },
    );
  });
  return startSession(user.id, identity.provider);
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  await getDb().transaction(async (tx) => {
    const userId = await revokeSession(tx, token);
    if (!userId) return;
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    await logAuthEvent(
      tx,
      { id: userId, name: user?.name ?? 'Unknown', role: user?.platformRole ?? 'business' },
      {
        action: 'logout',
        entityType: 'user',
        entityId: userId,
        summary: `${user?.name ?? 'Someone'} signed out`,
      },
    );
  });
}
