/** Sessions and sign-in providers. */
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getOAuthProvider,
  isDevLoginEnabled,
  listDevLoginUsers,
  loginWithDev,
  loginWithIdentity,
  logout,
  OAUTH_PROVIDERS,
} from '@/core/auth/login';
import { findSessionUserId } from '@/core/auth/session';
import { getDb } from '@/core/db/client';
import { authIdentities, sessions } from '@/core/db/schema';
import { ForbiddenError, UnauthenticatedError } from '@/core/errors';
import { createUser, setUserActive } from '@/core/people/users';
import { USERS, asOwner, platformCtxFor, userId } from './helpers';

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe('sessions', () => {
  it('a dev login creates a session that resolves to the user; logout ends it', async () => {
    const id = await userId(USERS.brssAdmin);
    const session = await loginWithDev(id);
    expect(await findSessionUserId(session.token)).toBe(id);
    await logout(session.token);
    expect(await findSessionUserId(session.token)).toBeNull();
  });

  it('only a hash of the token is stored', async () => {
    const session = await loginWithDev(await userId(USERS.brssAdmin));
    const rows = await getDb().select().from(sessions);
    expect(rows.some((r) => r.tokenHash === session.token)).toBe(false);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.tokenHash))).toBe(true);
  });

  it('unknown, empty and expired tokens are rejected', async () => {
    expect(await findSessionUserId(undefined)).toBeNull();
    expect(await findSessionUserId('not-a-real-token')).toBeNull();
    const session = await loginWithDev(await userId(USERS.brssAdmin));
    await asOwner(
      (q) =>
        q`update sessions set expires_at = now() - interval '1 minute' where expires_at = ${session.expiresAt}`,
    );
    expect(await findSessionUserId(session.token)).toBeNull();
  });

  it('deactivating a user signs them out everywhere and blocks sign-in', async () => {
    const sa = await platformCtxFor(USERS.superAdmin);
    const id = await createUser(sa, { name: 'Soon Gone', email: `gone.${Date.now()}@sai.example` });
    const session = await loginWithDev(id);
    await setUserActive(sa, id, false);
    expect(await findSessionUserId(session.token)).toBeNull();
    await expect(loginWithDev(id)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe('dev login is for local development only', () => {
  it('is off unless AUTH_DEV_LOGIN=true', async () => {
    process.env.AUTH_DEV_LOGIN = '';
    expect(isDevLoginEnabled()).toBe(false);
    expect(await listDevLoginUsers()).toEqual([]);
    await expect(loginWithDev(await userId(USERS.superAdmin))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('is off in production even if the variable is set', async () => {
    process.env.AUTH_DEV_LOGIN = 'true';
    (process.env as Record<string, string>).NODE_ENV = 'production';
    expect(isDevLoginEnabled()).toBe(false);
    await expect(loginWithDev(await userId(USERS.superAdmin))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe('Microsoft and Google adapters: present, not configured', () => {
  it('both exist and report disabled when their settings are empty', () => {
    for (const name of [
      'MICROSOFT_CLIENT_ID',
      'MICROSOFT_CLIENT_SECRET',
      'MICROSOFT_TENANT_ID',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_WORKSPACE_DOMAIN',
    ])
      delete process.env[name];
    expect(OAUTH_PROVIDERS.map((p) => p.id)).toEqual(['microsoft', 'google']);
    expect(OAUTH_PROVIDERS.every((p) => !p.isEnabled())).toBe(true);
    expect(getOAuthProvider('microsoft')).toBeUndefined();
    expect(getOAuthProvider('google')).toBeUndefined();
  });

  it('become enabled when configured, and build an authorization URL', () => {
    Object.assign(process.env, {
      APP_URL: 'http://localhost:3000',
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      MICROSOFT_CLIENT_ID: 'test-client-id',
      MICROSOFT_CLIENT_SECRET: 'test-client-secret',
      MICROSOFT_TENANT_ID: '11111111-2222-4333-8444-555555555555',
      GOOGLE_WORKSPACE_DOMAIN: 'sai.example',
    });
    const google = getOAuthProvider('google')!;
    const url = google.createAuthorizationUrl(
      'state123',
      'verifier-verifier-verifier-verifier-verifier-1',
    );
    expect(url.hostname).toBe('accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/auth/google/callback',
    );
    expect(
      getOAuthProvider('microsoft')!.createAuthorizationUrl(
        's',
        'verifier-verifier-verifier-verifier-verifier-1',
      ).hostname,
    ).toBe('login.microsoftonline.com');
  });
});

describe('signing in with an external identity', () => {
  it('links to an existing account by verified email, then by provider id', async () => {
    const id = await userId(USERS.hhmcStaff);
    const subject = `google-sub-${Date.now()}`;
    const first = await loginWithIdentity({
      provider: 'google',
      subject,
      email: USERS.hhmcStaff.toUpperCase(),
      emailVerified: true,
    });
    expect(await findSessionUserId(first.token)).toBe(id);
    const linked = await getDb()
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.providerSubject, subject));
    expect(linked).toHaveLength(1);
    // Second time the email is irrelevant: the provider id is what matches.
    const second = await loginWithIdentity({
      provider: 'google',
      subject,
      email: 'changed@elsewhere.example',
      emailVerified: false,
    });
    expect(await findSessionUserId(second.token)).toBe(id);
  });

  it('never creates an account, and refuses unverified email', async () => {
    await expect(
      loginWithIdentity({
        provider: 'google',
        subject: `s-${Date.now()}`,
        email: 'stranger@elsewhere.example',
        emailVerified: true,
      }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      loginWithIdentity({
        provider: 'microsoft',
        subject: `s2-${Date.now()}`,
        email: USERS.superAdmin,
        emailVerified: false,
      }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      loginWithIdentity({
        provider: 'microsoft',
        subject: '',
        email: USERS.superAdmin,
        emailVerified: true,
      }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
