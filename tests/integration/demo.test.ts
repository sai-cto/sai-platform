/**
 * Demo mode (src/core/demo, the hosted test site) and scheduled tasks. Environment variables
 * are changed for one test at a time and always put back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isDevLoginEnabled, loginWithDemoPassword, loginWithDev } from '@/core/auth/login';
import { appDatabaseUrl, derivedAppPassword } from '@/core/db/client';
import {
  accessCookieValid,
  accessCookieValue,
  accessGateEnabled,
  accessPasswordMatches,
  bypassesAccessGate,
  checkDemoPassword,
  parseDemoAccounts,
} from '@/core/demo/demo';
import { ForbiddenError, UnauthenticatedError } from '@/core/errors';
import { updateModuleSettings } from '@/core/modules/config';
import { runScheduledTasks } from '@/core/modules/scheduled';
import { providerFor } from '@/core/payments/payments';
import { upsertDemoAccounts } from '@/seed/demo-accounts';
import { USERS, ctxFor } from './helpers';

const saved = { ...process.env };
afterEach(() => {
  for (const key of ['DEMO_MODE', 'DEMO_ACCESS_PASSWORD', 'DEMO_ACCOUNTS', 'DATABASE_OWNER_URL', 'DATABASE_URL', 'PAYMENT_PROVIDER', 'AUTH_DEV_LOGIN', 'CRON_SECRET'])
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
});

const ACCOUNTS = 'gm.test@example.com|Gina Manager|gm|correct-horse-battery;staff.test@example.com|Sam Staff|staff|another-long-password;bad|x|gm|short';

describe('demo accounts', () => {
  it('are parsed from DEMO_ACCOUNTS; short passwords and bad lines are refused, with a reason', () => {
    const { accounts, problems } = parseDemoAccounts(ACCOUNTS);
    expect(accounts.map((a) => [a.email, a.role])).toEqual([
      ['gm.test@example.com', 'gm'],
      ['staff.test@example.com', 'staff'],
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Account 3/);
  });

  it('a password signs in only in demo mode, only with the right password', async () => {
    process.env.DEMO_ACCOUNTS = ACCOUNTS;
    await expect(loginWithDemoPassword('gm.test@example.com', 'correct-horse-battery')).rejects.toBeInstanceOf(ForbiddenError);
    process.env.DEMO_MODE = 'true';
    expect(checkDemoPassword('GM.test@example.com', 'correct-horse-battery')?.role).toBe('gm');
    expect(checkDemoPassword('gm.test@example.com', 'wrong-password-here')).toBeNull();
    expect(checkDemoPassword('staff.test@example.com', 'correct-horse-battery')).toBeNull();
    await upsertDemoAccounts(parseDemoAccounts(ACCOUNTS).accounts);
    await expect(loginWithDemoPassword('gm.test@example.com', 'nope-nope-nope')).rejects.toBeInstanceOf(UnauthenticatedError);
    const session = await loginWithDemoPassword('gm.test@example.com', 'correct-horse-battery');
    expect(session.token).toBeTruthy();
    // The GM is HHMC's business admin; staff got the grants a move needs.
    const { userId } = await import('./helpers');
    const gm = await ctxFor('gm.test@example.com', 'hhmc');
    expect(gm.role).toBe('business_admin');
    const staff = await ctxFor('staff.test@example.com', 'hhmc');
    expect(staff.permissions.has('hhmc.jobs.book')).toBe(true);
    expect(staff.permissions.has('business.people.manage')).toBe(false);
    expect(await userId('gm.test@example.com')).toBeTruthy();
  });

  it('in demo mode the dev login is off even with AUTH_DEV_LOGIN=true', async () => {
    process.env.AUTH_DEV_LOGIN = 'true';
    expect(isDevLoginEnabled()).toBe(true);
    process.env.DEMO_MODE = 'true';
    expect(isDevLoginEnabled()).toBe(false);
    const { userId } = await import('./helpers');
    await expect(loginWithDev(await userId(USERS.superAdmin))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('in demo mode payments always use the mock provider', () => {
    process.env.PAYMENT_PROVIDER = 'stripe';
    process.env.DEMO_MODE = 'true';
    expect(providerFor('live').name).toBe('mock');
  });
});

describe('the access gate', () => {
  it('is on only in demo mode with a password; the cookie is tied to the password', () => {
    process.env.DEMO_ACCESS_PASSWORD = 'shared-access-password';
    expect(accessGateEnabled()).toBe(false);
    expect(accessCookieValid(undefined)).toBe(true);
    process.env.DEMO_MODE = 'true';
    expect(accessGateEnabled()).toBe(true);
    expect(accessCookieValid(undefined)).toBe(false);
    expect(accessCookieValid('forged')).toBe(false);
    const cookie = accessCookieValue();
    expect(accessCookieValid(cookie)).toBe(true);
    expect(accessPasswordMatches('shared-access-password')).toBe(true);
    expect(accessPasswordMatches('shared-access-passwor')).toBe(false);
    process.env.DEMO_ACCESS_PASSWORD = 'a-new-password-12';
    expect(accessCookieValid(cookie)).toBe(false); // changing the password signs everyone out
    expect(bypassesAccessGate('/api/health')).toBe(true);
    expect(bypassesAccessGate('/login')).toBe(false);
    expect(bypassesAccessGate('/l/abc')).toBe(false);
  });
});

describe('the demo database connection', () => {
  it('without DATABASE_URL, the app connects as sai_app with a derived password (demo only)', () => {
    delete process.env.DATABASE_URL;
    process.env.DATABASE_OWNER_URL = 'postgres://owner:secret@ep-x-pooler.example.net/db?sslmode=require';
    expect(appDatabaseUrl()).toBeUndefined();
    process.env.DEMO_MODE = 'true';
    const url = new URL(appDatabaseUrl()!);
    expect(url.username).toBe('sai_app');
    expect(url.password).toBe(derivedAppPassword(process.env.DATABASE_OWNER_URL));
    expect(url.hostname).toBe('ep-x.example.net');
    expect(url.searchParams.get('sslmode')).toBe('require');
    expect(derivedAppPassword('a')).not.toBe(derivedAppPassword('b'));
  });
});

describe('scheduled tasks', () => {
  it('HHMC due emails run only where the manager switched them on; the cron route needs its secret', async () => {
    const off = await runScheduledTasks(new Date());
    expect(off.filter((r) => r.task === 'hhmc.due-emails').every((r) => r.result === 'switched off')).toBe(true);
    const tech = await ctxFor(USERS.tech, 'hhmc');
    await updateModuleSettings(tech, { autoSendDueEmails: true });
    try {
      const on = await runScheduledTasks(new Date());
      expect(on.filter((r) => r.task === 'hhmc.due-emails').every((r) => /^sent \d+/.test(r.result))).toBe(true);
    } finally {
      await updateModuleSettings(tech, { autoSendDueEmails: false });
    }
    const { GET } = await import('@/app/api/cron/scheduled/route');
    delete process.env.CRON_SECRET;
    expect((await GET(new Request('http://x/api/cron/scheduled'))).status).toBe(404);
    process.env.CRON_SECRET = 'a-cron-secret-of-length';
    expect((await GET(new Request('http://x/api/cron/scheduled', { headers: { authorization: 'Bearer wrong' } }))).status).toBe(404);
    expect((await GET(new Request('http://x/api/cron/scheduled', { headers: { authorization: 'Bearer a-cron-secret-of-length' } }))).status).toBe(200);
  });
});
