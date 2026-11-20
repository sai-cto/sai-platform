/**
 * Pilot mode (src/core/demo/pilot.ts): the hosted site with real data before it is fully live.
 * Environment variables are changed per test and always put back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isDevLoginEnabled, loginWithIdentity } from '@/core/auth/login';
import { microsoftIdentityFromClaims } from '@/core/auth/providers/microsoft';
import { withScope } from '@/core/db/scope';
import { parsePilotAccounts, requestHost, siteUrl } from '@/core/demo/pilot';
import { ValidationError } from '@/core/errors';
import { sendNotification, setEmailChannel, consoleEmailChannel } from '@/core/notifications/notifications';
import { takePayment } from '@/core/payments/payments';
import { upsertPilotAccounts } from '@/seed/demo-accounts';
import { USERS, ctxFor } from './helpers';

const saved = { ...process.env };
const LOCAL_DATABASE_URL = process.env.DATABASE_URL;

afterEach(() => {
  process.env.DATABASE_URL = LOCAL_DATABASE_URL;
  for (const key of ['PILOT_MODE', 'AUTH_DEV_LOGIN', 'APP_URL', 'VERCEL_PROJECT_PRODUCTION_URL'])
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  setEmailChannel(consoleEmailChannel);
});

const TENANT = '11111111-2222-4333-8444-555555555555';
let n = 0;
const key = () => `pilot-${Date.now()}-${(n += 1)}`;

describe('pilot accounts', () => {
  it('are parsed from PILOT_ACCOUNTS (no passwords); bad lines are reported', () => {
    const { accounts, problems } = parsePilotAccounts('jai@sai.example|Jai|cto;Pat@Hhmc.example|Pat GM|gm;x|y|boss');
    expect(accounts).toEqual([
      { email: 'jai@sai.example', name: 'Jai', role: 'cto' },
      { email: 'pat@hhmc.example', name: 'Pat GM', role: 'gm' },
    ]);
    expect(problems).toHaveLength(1);
  });

  it('are created with the right roles and sign in with a Microsoft identity from our directory only', async () => {
    const t = Date.now().toString(36);
    await upsertPilotAccounts([
      { email: `cto.${t}@sai.example`, name: 'Pilot CTO', role: 'cto' },
      { email: `gm.${t}@sai.example`, name: 'Pilot GM', role: 'gm' },
      { email: `staff.${t}@sai.example`, name: 'Pilot Staff', role: 'staff' },
    ]);
    const gm = await ctxFor(`gm.${t}@sai.example`, 'hhmc');
    expect(gm.role).toBe('business_admin');
    const staff = await ctxFor(`staff.${t}@sai.example`, 'hhmc');
    // The same starting access as someone added in People and access: no booking, export or catalog.
    expect(staff.permissions.has('hhmc.jobs.write')).toBe(true);
    expect(staff.permissions.has('hhmc.jobs.book')).toBe(false);
    expect(staff.permissions.has('business.data.export')).toBe(false);
    // An account that already exists is never changed by the list.
    await upsertPilotAccounts([{ email: `gm.${t}@sai.example`, name: 'Renamed', role: 'cto' }]);
    const stillGm = await ctxFor(`gm.${t}@sai.example`, 'hhmc');
    expect(stillGm.role).toBe('business_admin');
    const cto = await ctxFor(`cto.${t}@sai.example`, 'brss');
    expect(cto.role).toBe('super_admin');

    const ours = microsoftIdentityFromClaims({ tid: TENANT, oid: `oid-${t}`, preferred_username: `GM.${t}@sai.example` }, TENANT);
    expect((await loginWithIdentity(ours)).token).toBeTruthy();
    const foreign = microsoftIdentityFromClaims({ tid: '99999999-2222-4333-8444-555555555555', oid: `x-${t}`, preferred_username: `gm.${t}@sai.example` }, TENANT);
    await expect(loginWithIdentity(foreign)).rejects.toThrow();
  });
});

describe('pilot safety', () => {
  it('the dev login is off', () => {
    process.env.AUTH_DEV_LOGIN = 'true';
    expect(isDevLoginEnabled()).toBe(true);
    process.env.PILOT_MODE = 'true';
    expect(isDevLoginEnabled()).toBe(false);
    delete process.env.PILOT_MODE;
    process.env.DATABASE_URL = 'postgres://u:p@ep-x.us-east-1.aws.neon.tech/neondb';
    expect(isDevLoginEnabled()).toBe(false);
  });

  it('live card payments are refused before anything is recorded; cash works; test mode keeps test cards', async () => {
    process.env.PILOT_MODE = 'true';
    const live = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'live');
    await expect(withScope(live, 'payments.write', (s) => takePayment(s, { amountCents: 1000, description: 'x', idempotencyKey: key(), method: 'card' }))).rejects.toBeInstanceOf(ValidationError);
    const cash = await withScope(live, 'payments.write', (s) => takePayment(s, { amountCents: 1000, description: 'cash', idempotencyKey: key(), method: 'cash' }));
    expect(cash.status).toBe('succeeded');
    const sandbox = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'sandbox');
    const card = await withScope(sandbox, 'payments.write', (s) => takePayment(s, { amountCents: 1000, description: 'test card', idempotencyKey: key(), method: 'card' }));
    expect(card.status).toBe('succeeded');
  });

  it('no email leaves, even with a real email channel configured', async () => {
    const sent: string[] = [];
    setEmailChannel({ name: 'real-email', send: async (m) => { sent.push(m.recipient); return { ok: true }; } });
    process.env.PILOT_MODE = 'true';
    const live = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'live');
    const row = await withScope(live, 'notifications.write', (s) => sendNotification(s, { recipient: 'customer@example.com', subject: 's', body: 'b' }));
    expect(sent).toEqual([]);
    expect(row.adapter).toBe('console-email');
  });

  it('knows its own address on Vercel', () => {
    delete process.env.APP_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'sai-platform.vercel.app';
    expect(siteUrl()).toBe('https://sai-platform.vercel.app');
    process.env.APP_URL = 'https://hhmc.example.org/';
    expect(siteUrl()).toBe('https://hhmc.example.org');
  });
});

describe('requestHost', () => {
  it('uses the public host behind a load balancer, not the address the server listens on', () => {
    const request = new Request('http://0.0.0.0:3000/api/auth/microsoft/start', {
      headers: { host: 'console.example.org' },
    });
    expect(requestHost(request)).toBe('console.example.org');
  });

  it('prefers the first X-Forwarded-Host when a proxy sets it', () => {
    const request = new Request('http://10.0.0.5:3000/x', {
      headers: { host: '10.0.0.5:3000', 'x-forwarded-host': 'console.example.org, inner.example.org' },
    });
    expect(requestHost(request)).toBe('console.example.org');
  });

  it('falls back to the request URL without host headers', () => {
    expect(requestHost(new Request('https://hhmc.example.org/x'))).toBe('hhmc.example.org');
  });
});
