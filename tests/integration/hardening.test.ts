/**
 * Rules found (or found untested) by the independent review of Phase 1. Each block names
 * the rule it protects.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { revenueSummary, lastDays } from '@/core/analytics/analytics';
import { loginWithDev, loginWithIdentity } from '@/core/auth/login';
import { googleIdentityFromClaims, googleProvider } from '@/core/auth/providers/google';
import { microsoftIdentityFromClaims, microsoftProvider } from '@/core/auth/providers/microsoft';
import { findSessionUserId } from '@/core/auth/session';
import { withScope } from '@/core/db/scope';
import { ForbiddenError, NotFoundError, ValidationError } from '@/core/errors';
import { readFile, saveFile } from '@/core/files/files';
import { fileStorage } from '@/core/files/storage';
import { validateRegistry } from '@/core/modules/registry';
import { consoleEmailChannel, sendNotification, setEmailChannel } from '@/core/notifications/notifications';
import { mockProvider } from '@/core/payments/mock-provider';
import { refundPayment, refundedCents, takePayment } from '@/core/payments/payments';
import { addMember, listMembers, removeMember, setMemberPermissions } from '@/core/people/memberships';
import { createUser, setPlatformRole, setUserActive } from '@/core/people/users';
import { customerEntity, fileEntity, paymentEntity, refundEntity, resourceEntity, unavailabilityEntity } from '@/core/records/core-entities';
import { archiveRecord, createRecord, getRecord, listRecords, purgeRecord } from '@/core/records/records';
import { resetSandbox } from '@/core/sandbox/sandbox';
import { seedRecords } from '@/core/sandbox/seeding';
import { bookAppointment, findBlocks, listAppointments, rescheduleAppointment } from '@/core/scheduling/scheduling';
import { buildBusinessContext } from '@/core/tenancy/context';
import { renderPermissionsDoc } from '../../scripts/lib/permissions-doc';
import { USERS, ageArchive, arrange, ctxFor, logFor, platformCtxFor, userId } from './helpers';

const key = () => `hard-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const at = (daysFromNow: number, hour: number) => {
  const d = new Date(Date.now() + daysFromNow * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};
const unique = () => `${Date.now()}.${Math.random().toString(36).slice(2, 7)}`;

describe('permission is checked BEFORE anything leaves the platform', () => {
  // Someone who may read but not write. The scope is opened with a READ permission they
  // hold, as a careless caller might; the write function itself must still refuse first.
  const cases = [
    ['executive', USERS.executive],
    ['staff without the grant', USERS.brssStaff],
  ] as const;

  it.each(cases)('%s cannot make the payment provider charge or refund', async (_label, email) => {
    const admin = await ctxFor(USERS.brssAdmin, 'brss');
    const payment = await withScope(admin, 'payments.write', (s) => takePayment(s, { amountCents: 2000, description: 'to refund', idempotencyKey: key() }));
    const charge = vi.spyOn(mockProvider, 'charge');
    const refund = vi.spyOn(mockProvider, 'refund');
    try {
      const ctx = await ctxFor(email, 'brss');
      await expect(withScope(ctx, 'customers.read', (s) => takePayment(s, { amountCents: 100, description: 'x', idempotencyKey: key() }))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(withScope(ctx, 'customers.read', (s) => refundPayment(s, { paymentId: payment.id, amountCents: 100, reason: 'x' }))).rejects.toBeInstanceOf(ForbiddenError);
      expect(charge).not.toHaveBeenCalled();
      expect(refund).not.toHaveBeenCalled();
    } finally {
      charge.mockRestore();
      refund.mockRestore();
    }
  });

  it.each(cases)('%s cannot write a file to storage or send an email', async (_label, email) => {
    const put = vi.spyOn(fileStorage, 'put');
    const sent: string[] = [];
    setEmailChannel({ name: 'recorder', send: async (m) => { sent.push(m.recipient); return { ok: true }; } });
    try {
      const ctx = await ctxFor(email, 'brss');
      await expect(withScope(ctx, 'customers.read', (s) => saveFile(s, { filename: 'a.txt', contentType: 'text/plain', bytes: new Uint8Array([1]) }))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(withScope(ctx, 'customers.read', (s) => sendNotification(s, { recipient: 'x@example.com', subject: 's', body: 'b' }))).rejects.toBeInstanceOf(ForbiddenError);
      expect(put).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
    } finally {
      put.mockRestore();
      setEmailChannel(consoleEmailChannel);
    }
  });

  it.each(cases)('%s cannot book or move an appointment, or bulk-insert', async (_label, email) => {
    const ctx = await ctxFor(email, 'brss');
    const existing = await arrange('brss', 'live', (s) => bookAppointment(s, { kind: 'visit', startsAt: at(400, 14), endsAt: at(400, 16) }));
    await expect(withScope(ctx, 'customers.read', (s) => bookAppointment(s, { kind: 'visit', startsAt: at(401, 14), endsAt: at(401, 16) }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(withScope(ctx, 'customers.read', (s) => rescheduleAppointment(s, existing.id, { startsAt: at(402, 14), endsAt: at(402, 16) }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(withScope(ctx, 'customers.read', (s) => seedRecords(s, customerEntity, [{ firstName: 'Bulk', lastName: 'Insert' }]))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('read helpers check their own permission', () => {
  it('a new hire with only "open the app" cannot read appointments, blocks, revenue or refunds through a helper', async () => {
    const ctx = await ctxFor(USERS.brssNewHire, 'brss');
    const range = { startsAt: at(1, 0), endsAt: at(2, 0) };
    await withScope(ctx, 'business.overview.read', async (s) => {
      await expect(listAppointments(s, { from: at(-30, 0), to: at(30, 0) })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(findBlocks(s, range)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(revenueSummary(s, lastDays(30))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(refundedCents(s, '00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  it('staff granted sandbox access can open the sandbox but still cannot bulk-insert without write', async () => {
    const admin = await ctxFor(USERS.brssAdmin, 'brss');
    const membershipId = await addMember(admin, { name: 'Sandy Box', email: `sandy.${unique()}@sai.example`, role: 'business_staff' });
    const member = (await listMembers(admin)).find((m) => m.membershipId === membershipId)!;
    await expect(buildBusinessContext(member.userId, 'brss', 'sandbox')).rejects.toBeInstanceOf(ForbiddenError);
    await setMemberPermissions(admin, membershipId, ['business.sandbox.use', 'customers.read']);
    const sandbox = await buildBusinessContext(member.userId, 'brss', 'sandbox');
    expect(sandbox.environment).toBe('sandbox');
    await expect(withScope(sandbox, 'customers.read', (s) => seedRecords(s, customerEntity, [{ firstName: 'No', lastName: 'Write' }]))).rejects.toBeInstanceOf(ForbiddenError);
    await removeMember(admin, membershipId);
  });
});

describe('payments under simultaneous requests', () => {
  it('three simultaneous requests with one idempotency key charge once and store one row', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    const original = mockProvider.charge;
    const charge = vi.spyOn(mockProvider, 'charge').mockImplementation(async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return original(request);
    });
    try {
      const k = key();
      const results = await Promise.all([1, 2, 3].map(() => withScope(ctx, 'payments.write', (s) => takePayment(s, { amountCents: 1500, description: 'Race', idempotencyKey: k }))));
      expect(new Set(results.map((r) => r.id)).size).toBe(1);
      expect(charge).toHaveBeenCalledTimes(1);
      const stored = await withScope(ctx, 'payments.read', (s) => listRecords(s, paymentEntity, { search: 'Race', limit: 50 }));
      expect(stored.rows.filter((r) => r.idempotencyKey === k)).toHaveLength(1);
    } finally {
      charge.mockRestore();
    }
  });

  it('the database itself refuses a second payment row with the same key', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    const k = key();
    const row = { amountCents: 1, status: 'succeeded', provider: 'manual', idempotencyKey: k } as const;
    await expect(
      withScope(ctx, 'payments.write', async (s) => {
        await createRecord(s, paymentEntity, row);
        await createRecord(s, paymentEntity, row);
      }),
    ).rejects.toThrow();
  });

  it('three simultaneous full refunds give back the money once', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    const payment = await withScope(ctx, 'payments.write', (s) => takePayment(s, { amountCents: 1000, description: 'Refund race', idempotencyKey: key() }));
    const results = await Promise.allSettled([1, 2, 3].map(() => withScope(ctx, 'payments.write', (s) => refundPayment(s, { paymentId: payment.id, amountCents: 1000, reason: 'race' }))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason instanceof ValidationError)).toBe(true);
    expect(await withScope(ctx, 'payments.read', (s) => refundedCents(s, payment.id))).toBe(1000);
  });
});

describe('scheduling: moving an appointment respects its resource’s unavailability', () => {
  it('rescheduling without naming a resource still checks the appointment’s own resource', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    await withScope(ctx, 'scheduling.write', async (s) => {
      const truck = await createRecord(s, resourceEntity, { kind: 'truck', name: `Truck ${unique()}` });
      await createRecord(s, unavailabilityEntity, { resourceId: truck.id, startsAt: at(300, 0), endsAt: at(301, 0), reason: 'Truck service' });
      const appointment = await bookAppointment(s, { kind: 'pickup', startsAt: at(305, 14), endsAt: at(305, 16), resourceId: truck.id });
      await expect(rescheduleAppointment(s, appointment.id, { startsAt: at(300, 14), endsAt: at(300, 16) })).rejects.toThrow(/Truck service/);
      // Moving it off the truck (resourceId: null) is allowed: the block was the truck's.
      const moved = await rescheduleAppointment(s, appointment.id, { startsAt: at(300, 14), endsAt: at(300, 16), resourceId: null });
      expect(moved.resourceId).toBeNull();
    });
  });
});

describe('a business always keeps one usable admin', () => {
  it('the tech team cannot deactivate the account of a business’s only admin', async () => {
    const tech = await platformCtxFor(USERS.tech);
    await expect(setUserActive(tech, await userId('cp.admin@sai.example'), false)).rejects.toThrow(/only admin of Campus Promotions/);
    await expect(ctxFor('cp.admin@sai.example', 'cp')).resolves.toBeTruthy();
  });

  it('two admins removing each other at the same moment: exactly one succeeds', async () => {
    const tech = await ctxFor(USERS.tech, 'sare');
    const secondId = await addMember(tech, { name: 'Second Admin', email: `second.${unique()}@sai.example`, role: 'business_admin' });
    const admins = (await listMembers(tech)).filter((m) => m.role === 'business_admin' && m.isActive);
    expect(admins).toHaveLength(2);
    const results = await Promise.allSettled(admins.map((m) => removeMember(tech, m.membershipId)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const left = (await listMembers(tech)).filter((m) => m.role === 'business_admin' && m.isActive);
    expect(left).toHaveLength(1);
    // Put the seed admin back if they were the one removed, so later tests still have them.
    if (!left.some((m) => m.email === 'sare.admin@sai.example')) {
      await addMember(tech, { name: 'Sol SARE-Admin', email: 'sare.admin@sai.example', role: 'business_admin' });
      await removeMember(tech, secondId);
    }
  });

  it('tech can deactivate and reactivate an ordinary account; only super admin can touch a platform-role account', async () => {
    const tech = await platformCtxFor(USERS.tech);
    const superAdmin = await platformCtxFor(USERS.superAdmin);
    const id = await createUser(tech, { name: 'Ordinary Person', email: `ordinary.${unique()}@sai.example` });
    await setUserActive(tech, id, false);
    await setUserActive(tech, id, true);
    await setPlatformRole(superAdmin, id, 'executive');
    await expect(setUserActive(tech, id, false)).rejects.toBeInstanceOf(ForbiddenError);
    await setUserActive(superAdmin, id, false);
    await expect(setUserActive(tech, id, true)).rejects.toBeInstanceOf(ForbiddenError);
    await setUserActive(superAdmin, id, true);
  });

  it('changing a platform role signs the person out everywhere', async () => {
    const superAdmin = await platformCtxFor(USERS.superAdmin);
    const id = await createUser(superAdmin, { name: 'Role Change', email: `role.${unique()}@sai.example` });
    const session = await loginWithDev(id);
    expect(await findSessionUserId(session.token)).toBe(id);
    await setPlatformRole(superAdmin, id, 'tech');
    expect(await findSessionUserId(session.token)).toBeNull();
  });
});

describe('people and settings changes are filed under the live log, even from test mode', () => {
  it('adding an admin while in the sandbox appears in the live log, not the sandbox log', async () => {
    const sandbox = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'sandbox');
    const started = new Date(Date.now() - 1000);
    const membershipId = await addMember(sandbox, { name: 'From Sandbox', email: `from.sandbox.${unique()}@sai.example`, role: 'business_admin' });
    const [entry] = await logFor('membership', membershipId, started);
    expect(entry).toMatchObject({ action: 'permission_change', environment: 'live', businessId: sandbox.business.id });
    await removeMember(sandbox, membershipId);
    const entries = await logFor('membership', membershipId, started);
    expect(entries.every((e) => e.environment === 'live')).toBe(true);
    expect(entries[0].before).toMatchObject({ role: 'business_admin', isActive: true });
  });
});

describe('permanent delete never takes other records with it', () => {
  it('a payment with a refund cannot be purged until the refund is purged; nothing cascades', async () => {
    const ids = await arrange('corn', 'live', async (s) => {
      const payment = await takePayment(s, { amountCents: 5000, description: 'Has refund', idempotencyKey: key() });
      const refund = await refundPayment(s, { paymentId: payment.id, amountCents: 1000, reason: 'partial' });
      await archiveRecord(s, paymentEntity, payment.id);
      return { payment: payment.id, refund: refund.id };
    });
    await ageArchive('payments', ids.payment, 60);
    const superAdmin = await ctxFor(USERS.superAdmin, 'corn');
    await expect(withScope(superAdmin, 'business.overview.read', (s) => purgeRecord(s, paymentEntity, ids.payment))).rejects.toThrow(/still refer/);
    await withScope(superAdmin, 'business.overview.read', async (s) => {
      await expect(getRecord(s, refundEntity, ids.refund)).resolves.toBeTruthy();
      await expect(getRecord(s, paymentEntity, ids.payment, 'only')).resolves.toBeTruthy();
    });
  });

  it('purging a file removes its bytes; resetting a sandbox removes the sandbox’s files; live files stay', async () => {
    const superAdmin = await ctxFor(USERS.superAdmin, 'brm');
    const bytes = new TextEncoder().encode('hello');
    const file = await withScope(superAdmin, 'files.write', (s) => saveFile(s, { filename: 'purge-me.txt', contentType: 'text/plain', bytes }));
    const onDisk = (storageKey: string) => fs.existsSync(path.resolve(process.env.FILE_STORAGE_DIR as string, storageKey));
    expect(onDisk(file.storageKey)).toBe(true);
    await withScope(superAdmin, 'files.write', (s) => archiveRecord(s, fileEntity, file.id));
    await ageArchive('files', file.id, 40);
    await withScope(superAdmin, 'files.write', (s) => purgeRecord(s, fileEntity, file.id));
    expect(onDisk(file.storageKey)).toBe(false);

    const live = await withScope(superAdmin, 'files.write', (s) => saveFile(s, { filename: 'live.txt', contentType: 'text/plain', bytes }));
    const sandboxCtx = await ctxFor(USERS.superAdmin, 'brm', 'sandbox');
    const inSandbox = await withScope(sandboxCtx, 'files.write', (s) => saveFile(s, { filename: 'sandbox.txt', contentType: 'text/plain', bytes }));
    await resetSandbox(superAdmin);
    expect(onDisk(inSandbox.storageKey)).toBe(false);
    expect(onDisk(live.storageKey)).toBe(true);
    await expect(withScope(sandboxCtx, 'files.read', (s) => readFile(s, inSandbox.id))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a refund of a payment taken with another provider is refused rather than faked', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    await withScope(ctx, 'payments.write', async (s) => {
      const payment = await createRecord(s, paymentEntity, { amountCents: 900, status: 'succeeded', provider: 'stripe', providerRef: 'pi_from_before', paidAt: new Date() });
      await expect(refundPayment(s, { paymentId: payment.id, amountCents: 100, reason: 'x' })).rejects.toThrow(/not the active payment provider/);
    });
  });
});

describe('sign-in adapters only trust our own directory', () => {
  const TENANT = '11111111-2222-4333-8444-555555555555';

  it('Microsoft: needs a real directory id; "common" and "organizations" keep it switched off', () => {
    const env = { ...process.env };
    try {
      Object.assign(process.env, { APP_URL: 'http://localhost:3000', MICROSOFT_CLIENT_ID: 'id', MICROSOFT_CLIENT_SECRET: 'secret' });
      for (const tenant of ['common', 'organizations', 'consumers', '']) {
        process.env.MICROSOFT_TENANT_ID = tenant;
        expect(microsoftProvider.isEnabled(), tenant).toBe(false);
      }
      process.env.MICROSOFT_TENANT_ID = TENANT;
      expect(microsoftProvider.isEnabled()).toBe(true);
    } finally {
      process.env = env;
    }
  });

  it('Microsoft: a token from another directory yields no usable identity', async () => {
    const ours = microsoftIdentityFromClaims({ tid: TENANT, oid: 'abc', preferred_username: 'Tech@SAI.example' }, TENANT);
    expect(ours).toMatchObject({ subject: 'abc', email: 'tech@sai.example', emailVerified: true });
    const theirs = microsoftIdentityFromClaims({ tid: '99999999-2222-4333-8444-555555555555', oid: 'abc', email: USERS.superAdmin }, TENANT);
    expect(theirs).toMatchObject({ subject: '', emailVerified: false });
    expect(microsoftIdentityFromClaims({ oid: 'abc', email: USERS.superAdmin }, TENANT).emailVerified).toBe(false);
    expect(microsoftIdentityFromClaims({ tid: 'common', oid: 'abc', email: USERS.superAdmin }, 'common').emailVerified).toBe(false);
    // ...and such an identity cannot sign in as the CTO.
    await expect(loginWithIdentity(theirs)).rejects.toThrow();
  });

  it('Google: needs a Workspace domain, and only that Workspace’s verified accounts count', async () => {
    const env = { ...process.env };
    try {
      Object.assign(process.env, { APP_URL: 'http://localhost:3000', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' });
      delete process.env.GOOGLE_WORKSPACE_DOMAIN;
      expect(googleProvider.isEnabled()).toBe(false);
      process.env.GOOGLE_WORKSPACE_DOMAIN = 'sai.example';
      expect(googleProvider.isEnabled()).toBe(true);
    } finally {
      process.env = env;
    }
    expect(googleIdentityFromClaims({ sub: '1', hd: 'sai.example', email: 'CTO@sai.example', email_verified: true }, 'sai.example')).toMatchObject({ subject: '1', email: 'cto@sai.example', emailVerified: true });
    const personal = googleIdentityFromClaims({ sub: '2', email: USERS.superAdmin, email_verified: true }, 'sai.example');
    expect(personal).toMatchObject({ subject: '', emailVerified: false });
    expect(googleIdentityFromClaims({ sub: '3', hd: 'evil.example', email: USERS.superAdmin, email_verified: true }, 'sai.example').emailVerified).toBe(false);
    expect(googleIdentityFromClaims({ sub: '4', hd: 'sai.example', email: USERS.superAdmin, email_verified: false }, 'sai.example').emailVerified).toBe(false);
    await expect(loginWithIdentity(personal)).rejects.toThrow();
  });

  it('linking a provider to an account is logged', async () => {
    const id = await userId(USERS.hhmcAdmin);
    const started = new Date(Date.now() - 1000);
    await loginWithIdentity({ provider: 'google', subject: `link-${unique()}`, email: USERS.hhmcAdmin, emailVerified: true });
    const entries = (await logFor('user', id, started)).map((e) => e.action);
    expect(entries).toContain('permission_change');
    expect(entries).toContain('login');
  });
});

describe('the registry and the generated docs', () => {
  it('the module registry has no problems', () => {
    expect(validateRegistry()).toEqual([]);
  });

  it('every test file named in docs/PERMISSIONS.md exists', () => {
    const cited = [...renderPermissionsDoc().matchAll(/`(tests\/[^`]+)`/g)].map((m) => m[1]);
    expect(cited.length).toBeGreaterThan(5);
    for (const file of new Set(cited)) expect(fs.existsSync(path.resolve(__dirname, '../..', file)), file).toBe(true);
  });
});
