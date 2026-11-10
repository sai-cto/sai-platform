/** The shared core services: payments, scheduling, notifications, files, analytics, sandbox, flags, settings. */
import { describe, expect, it } from 'vitest';
import {
  createdCount,
  fillSeries,
  bucketKey,
  lastDays,
  revenueByBusiness,
  revenueSeries,
  revenueSummary,
} from '@/core/analytics/analytics';
import { listBusinessActivity, listPlatformActivity } from '@/core/audit/read';
import { createCustomer, listCustomers, updateCustomer } from '@/core/customers/customers';
import { withPlatformScope, withScope } from '@/core/db/scope';
import { ForbiddenError, ValidationError } from '@/core/errors';
import { isFlagEnabled, setFlag } from '@/core/flags/flags';
import { getModuleConfig, isPortalAvailable, setPortalEnabled } from '@/core/modules/config';
import { MOCK_DECLINED_TOKEN } from '@/core/payments/mock-provider';
import { providerFor, refundPayment, takePayment } from '@/core/payments/payments';
import {
  assertTestKey,
  createStripeProvider,
  type StripeLike,
} from '@/core/payments/stripe-provider';
import {
  customerEntity,
  paymentEntity,
  resourceEntity,
  unavailabilityEntity,
} from '@/core/records/core-entities';
import { createRecord, listRecords } from '@/core/records/records';
import { resetSandbox } from '@/core/sandbox/sandbox';
import { seedRecords } from '@/core/sandbox/seeding';
import {
  bookAppointment,
  findBlocks,
  findConflicts,
  rescheduleAppointment,
} from '@/core/scheduling/scheduling';
import {
  sendNotification,
  setEmailChannel,
  consoleEmailChannel,
} from '@/core/notifications/notifications';
import { USERS, ctxFor, platformCtxFor } from './helpers';

const key = () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const at = (daysFromNow: number, hour: number) => {
  const d = new Date(Date.now() + daysFromNow * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};

describe('customers', () => {
  it('validates input and searches within the business only', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    await expect(createCustomer(ctx, { firstName: '', lastName: '' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      createCustomer(ctx, { firstName: 'A', lastName: 'B', email: 'not-an-email' }),
    ).rejects.toBeInstanceOf(ValidationError);
    const marker = `Zed${Date.now()}`;
    const row = await createCustomer(ctx, {
      firstName: marker,
      lastName: 'Search',
      email: 'Zed@Example.com',
    });
    expect(row.email).toBe('zed@example.com');
    await updateCustomer(ctx, row.id, { firstName: marker, lastName: 'Renamed' });
    expect((await listCustomers(ctx, { search: marker })).rows.map((r) => r.lastName)).toEqual([
      'Renamed',
    ]);
    const other = await ctxFor(USERS.hhmcAdmin, 'hhmc');
    expect((await listCustomers(other, { search: marker })).total).toBe(0);
    // % and _ in a search are treated as text, not wildcards.
    expect((await listCustomers(ctx, { search: '%' })).total).toBe(0);
  });
});

describe('payments', () => {
  it('a card payment succeeds through the mock provider and is recorded', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    const payment = await withScope(ctx, 'payments.write', (s) =>
      takePayment(s, { amountCents: 4200, description: 'Test', idempotencyKey: key() }),
    );
    expect(payment).toMatchObject({
      status: 'succeeded',
      provider: 'mock',
      amountCents: 4200,
      cardLast4: '4242',
    });
    expect(payment.paidAt).toBeInstanceOf(Date);
  });

  it('the same idempotency key never charges twice', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    const k = key();
    const first = await withScope(ctx, 'payments.write', (s) =>
      takePayment(s, { amountCents: 1000, description: 'Once', idempotencyKey: k }),
    );
    const second = await withScope(ctx, 'payments.write', (s) =>
      takePayment(s, { amountCents: 1000, description: 'Once', idempotencyKey: k }),
    );
    expect(second.id).toBe(first.id);
  });

  it('a declined card is recorded as failed and nothing is marked paid', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    const payment = await withScope(ctx, 'payments.write', (s) =>
      takePayment(s, {
        amountCents: 1000,
        description: 'Declined',
        idempotencyKey: key(),
        paymentMethodToken: MOCK_DECLINED_TOKEN,
      }),
    );
    expect(payment).toMatchObject({ status: 'failed', paidAt: null });
    expect(payment.failureReason).toMatch(/declined/i);
  });

  it('if the caller’s transaction fails, no payment row is left behind', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    const k = key();
    await expect(
      withScope(ctx, 'payments.write', async (s) => {
        await takePayment(s, { amountCents: 1000, description: 'Rolled back', idempotencyKey: k });
        throw new Error('order update failed');
      }),
    ).rejects.toThrow('order update failed');
    const found = await withScope(ctx, 'payments.read', (s) =>
      listRecords(s, paymentEntity, { search: 'Rolled back' }),
    );
    expect(found.total).toBe(0);
  });

  it('refunds cannot exceed what was paid', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    await withScope(ctx, 'payments.write', async (s) => {
      const payment = await takePayment(s, {
        amountCents: 5000,
        description: 'Refundable',
        idempotencyKey: key(),
      });
      const refund = await refundPayment(s, {
        paymentId: payment.id,
        amountCents: 2000,
        reason: 'Partial',
      });
      expect(refund.status).toBe('succeeded');
      await refundPayment(s, { paymentId: payment.id, amountCents: 3000, reason: 'Rest' });
      await expect(
        refundPayment(s, { paymentId: payment.id, amountCents: 1, reason: 'Too much' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  it('rejects zero and negative amounts; staff without payments.write cannot charge', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    await expect(
      withScope(ctx, 'payments.write', (s) =>
        takePayment(s, { amountCents: 0, description: 'x', idempotencyKey: key() }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    const staff = await ctxFor(USERS.brssStaff, 'brss');
    await expect(
      withScope(staff, 'customers.read', (s) =>
        takePayment(s, { amountCents: 100, description: 'x', idempotencyKey: key() }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('the sandbox always uses the mock provider, even when Stripe is configured', () => {
    const before = process.env.PAYMENT_PROVIDER;
    process.env.PAYMENT_PROVIDER = 'stripe';
    try {
      expect(providerFor('sandbox').name).toBe('mock');
    } finally {
      process.env.PAYMENT_PROVIDER = before;
    }
  });

  it('the Stripe adapter refuses anything but a test key', () => {
    expect(() => assertTestKey(undefined)).toThrow();
    expect(() => assertTestKey(['sk', 'live', 'abc123'].join('_'))).toThrow(/TEST key/);
    expect(() => assertTestKey(['rk', 'test', 'abc123'].join('_'))).toThrow(/TEST key/);
    expect(assertTestKey(['sk', 'test', 'abc'].join('_'))).toBeTruthy();
  });

  it('the Stripe adapter maps charges and refunds (against a fake client)', async () => {
    const calls: unknown[] = [];
    const fake: StripeLike = {
      paymentIntents: {
        create: async (params, options) => {
          calls.push([params, options]);
          return {
            id: 'pi_fake',
            status: params.capture_method === 'manual' ? 'requires_capture' : 'succeeded',
          };
        },
      },
      refunds: {
        create: async (params, options) => {
          calls.push([params, options]);
          return { id: 're_fake', status: 'succeeded' };
        },
      },
    };
    const provider = createStripeProvider(fake);
    expect(
      await provider.charge({
        amountCents: 500,
        currency: 'usd',
        description: 'd',
        idempotencyKey: 'k1',
        kind: 'charge',
        paymentMethodToken: 'pm_x',
      }),
    ).toEqual({ ok: true, providerRef: 'pi_fake' });
    expect(
      await provider.charge({
        amountCents: 100,
        currency: 'usd',
        description: 'd',
        idempotencyKey: 'k2',
        kind: 'authorization',
      }),
    ).toEqual({ ok: true, providerRef: 'pi_fake' });
    expect(
      await provider.refund({ providerRef: 'pi_fake', amountCents: 200, idempotencyKey: 'k3' }),
    ).toEqual({ ok: true, providerRef: 're_fake' });
    expect(calls[0]).toMatchObject([
      { amount: 500, currency: 'usd', confirm: true, payment_method: 'pm_x' },
      { idempotencyKey: 'k1' },
    ]);
    const failing = createStripeProvider({
      ...fake,
      paymentIntents: {
        create: async () => {
          throw new Error('card_declined');
        },
      },
    });
    expect(
      await failing.charge({
        amountCents: 1,
        currency: 'usd',
        description: 'd',
        idempotencyKey: 'k',
        kind: 'charge',
      }),
    ).toEqual({ ok: false, failureReason: 'card_declined' });
  });
});

describe('scheduling', () => {
  it('refuses a blocked time on the server, unless explicitly overridden', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    await withScope(ctx, 'scheduling.write', async (s) => {
      await createRecord(s, unavailabilityEntity, {
        startsAt: at(200, 0),
        endsAt: at(201, 0),
        reason: 'Commencement',
      });
      const blocked = { kind: 'pickup', startsAt: at(200, 14), endsAt: at(200, 16) };
      await expect(bookAppointment(s, blocked)).rejects.toThrow(/Commencement/);
      expect(await findBlocks(s, blocked)).toHaveLength(1);
      const forced = await bookAppointment(s, blocked, { overrideBlocks: true });
      expect(forced.status).toBe('unconfirmed');
      const free = await bookAppointment(s, {
        kind: 'pickup',
        startsAt: at(202, 14),
        endsAt: at(202, 16),
      });
      await expect(
        rescheduleAppointment(s, free.id, { startsAt: at(200, 10), endsAt: at(200, 12) }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        bookAppointment(s, { kind: 'pickup', startsAt: at(203, 16), endsAt: at(203, 14) }),
      ).rejects.toThrow(/after the start/);
    });
  });

  it('a block on one resource does not block another; conflicts are per resource', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    await withScope(ctx, 'scheduling.write', async (s) => {
      const truckA = await createRecord(s, resourceEntity, { kind: 'truck', name: 'Truck A' });
      const truckB = await createRecord(s, resourceEntity, { kind: 'truck', name: 'Truck B' });
      await createRecord(s, unavailabilityEntity, {
        resourceId: truckA.id,
        startsAt: at(210, 0),
        endsAt: at(211, 0),
        reason: 'In the shop',
      });
      const slot = { kind: 'pickup', startsAt: at(210, 14), endsAt: at(210, 16) };
      await expect(bookAppointment(s, { ...slot, resourceId: truckA.id })).rejects.toThrow(
        /In the shop/,
      );
      const booked = await bookAppointment(s, { ...slot, resourceId: truckB.id });
      expect(await findConflicts(s, { ...slot, resourceId: truckB.id })).toHaveLength(1);
      expect(
        await findConflicts(s, { ...slot, resourceId: truckB.id, excludeAppointmentId: booked.id }),
      ).toHaveLength(0);
      expect(
        await findConflicts(s, {
          startsAt: at(210, 16),
          endsAt: at(210, 18),
          resourceId: truckB.id,
        }),
      ).toHaveLength(0);
    });
  });
});

describe('notifications', () => {
  it('are recorded, and the sandbox never uses a real channel', async () => {
    const sent: string[] = [];
    setEmailChannel({
      name: 'recorder',
      send: async (m) => {
        sent.push(m.recipient);
        return { ok: true };
      },
    });
    try {
      const live = await ctxFor(USERS.brssAdmin, 'brss', 'live');
      const sandbox = await ctxFor(USERS.brssAdmin, 'brss', 'sandbox');
      const a = await withScope(live, 'notifications.write', (s) =>
        sendNotification(s, { recipient: 'live@example.com', subject: 'Hi', body: 'Body' }),
      );
      const b = await withScope(sandbox, 'notifications.write', (s) =>
        sendNotification(s, { recipient: 'sandbox@example.com', subject: 'Hi', body: 'Body' }),
      );
      expect(a).toMatchObject({ status: 'sent', adapter: 'recorder' });
      expect(b).toMatchObject({ status: 'sent', adapter: 'console-email' });
      expect(sent).toEqual(['live@example.com']);
    } finally {
      setEmailChannel(consoleEmailChannel);
    }
  });
});

describe('analytics', () => {
  it('revenue = succeeded charges minus refunds, for this business and environment only', async () => {
    const ctx = await ctxFor(USERS.superAdmin, 'cfr', 'sandbox');
    await resetSandbox(ctx);
    // The range must end after the payments made below, so it ends a minute from now.
    const range = lastDays(1, new Date(Date.now() + 60_000));
    const before = await withScope(ctx, 'payments.read', (s) => revenueSummary(s, range));
    await withScope(ctx, 'payments.write', async (s) => {
      const p = await takePayment(s, {
        amountCents: 10_000,
        description: 'A',
        idempotencyKey: key(),
      });
      await takePayment(s, {
        amountCents: 999,
        description: 'Declined',
        idempotencyKey: key(),
        paymentMethodToken: MOCK_DECLINED_TOKEN,
      });
      await takePayment(s, {
        amountCents: 100,
        description: 'Hold',
        idempotencyKey: key(),
        kind: 'authorization',
      });
      await refundPayment(s, { paymentId: p.id, amountCents: 2_500, reason: 'r' });
    });
    const after = await withScope(ctx, 'payments.read', (s) => revenueSummary(s, range));
    expect(after.grossCents - before.grossCents).toBe(10_000);
    expect(after.refundedCents - before.refundedCents).toBe(2_500);
    expect(after.netCents - before.netCents).toBe(7_500);
    const series = await withScope(ctx, 'payments.read', (s) =>
      revenueSeries(s, lastDays(7, new Date(Date.now() + 60_000)), 'day'),
    );
    expect(series.at(-1)!.value).toBeGreaterThanOrEqual(10_000);
    expect(
      await withScope(ctx, 'customers.read', (s) =>
        createdCount(s, customerEntity, lastDays(1, new Date(Date.now() + 60_000))),
      ),
    ).toBeGreaterThanOrEqual(12);
  });

  it('cross-business numbers use live data only and need a platform role', async () => {
    const exec = await platformCtxFor(USERS.executive);
    const sandbox = await ctxFor(USERS.superAdmin, 'brm', 'sandbox');
    const soon = () => lastDays(1, new Date(Date.now() + 60_000));
    const before = await withPlatformScope(exec, 'executive.dashboard.read', (s) =>
      revenueByBusiness(s, soon()),
    );
    await withScope(sandbox, 'payments.write', (s) =>
      takePayment(s, { amountCents: 77_700, description: 'Sandbox only', idempotencyKey: key() }),
    );
    const after = await withPlatformScope(exec, 'executive.dashboard.read', (s) =>
      revenueByBusiness(s, soon()),
    );
    expect(after.get(sandbox.business.id)?.grossCents ?? 0).toBe(
      before.get(sandbox.business.id)?.grossCents ?? 0,
    );
    const admin = await platformCtxFor(USERS.brssAdmin);
    await expect(
      withPlatformScope(admin, 'executive.dashboard.read', (s) =>
        revenueByBusiness(s, lastDays(1)),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('fillSeries and bucketKey produce one point per bucket', () => {
    const range = { from: new Date('2026-03-01T12:00:00Z'), to: new Date('2026-03-08T12:00:00Z') };
    const filled = fillSeries([{ bucket: '2026-03-03', value: 5 }], range, 'day');
    expect(filled).toHaveLength(8); // 1 March … 8 March: the range ends part-way through the 8th
    expect(filled.find((p) => p.bucket === '2026-03-03')?.value).toBe(5);
    expect(bucketKey(new Date('2026-03-04T12:00:00Z'), 'week')).toBe('2026-03-02');
    expect(bucketKey(new Date('2026-03-04T12:00:00Z'), 'month')).toBe('2026-03-01');
    expect(bucketKey(new Date('2026-03-04T02:00:00Z'), 'day')).toBe('2026-03-03'); // still the 3rd in Ithaca
  });
});

describe('sandbox', () => {
  it('reset replaces sandbox data with fresh fake data and never touches live', async () => {
    const live = await ctxFor(USERS.brssAdmin, 'brss', 'live');
    const sandbox = await ctxFor(USERS.brssAdmin, 'brss', 'sandbox');
    const liveRow = await createCustomer(live, { firstName: 'Live', lastName: 'Survivor' });
    const sandboxRow = await createCustomer(sandbox, {
      firstName: 'Sandbox',
      lastName: 'Temporary',
    });
    const liveBefore = (await listCustomers(live, { archived: 'include', limit: 1 })).total;
    await resetSandbox(live); // may be called from either mode; it only ever resets the sandbox
    expect((await listCustomers(live, { archived: 'include', limit: 1 })).total).toBe(liveBefore);
    expect((await listCustomers(live, { search: 'Survivor' })).rows.map((r) => r.id)).toContain(
      liveRow.id,
    );
    const sandboxAfter = await listCustomers(sandbox, { limit: 500 });
    expect(sandboxAfter.rows.some((r) => r.id === sandboxRow.id)).toBe(false);
    expect(sandboxAfter.total).toBeGreaterThanOrEqual(12);
  });

  it('staff cannot reset; seedRecords refuses to write live data for a real person', async () => {
    await expect(resetSandbox(await ctxFor(USERS.brssStaff, 'brss'))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const live = await ctxFor(USERS.superAdmin, 'brss', 'live');
    await expect(
      withScope(live, 'customers.write', (s) =>
        seedRecords(s, customerEntity, [{ firstName: 'Bulk', lastName: 'Live' }]),
      ),
    ).rejects.toThrow(/sandbox/);
  });
});

describe('flags and module settings', () => {
  it('a business flag overrides the global one', async () => {
    const sa = await platformCtxFor(USERS.superAdmin);
    const brss = await ctxFor(USERS.superAdmin, 'brss');
    const k = `test.flag.${Date.now()}`;
    expect(await isFlagEnabled(k, brss.business.id)).toBe(false);
    await setFlag(sa, { key: k, businessId: null, enabled: true });
    expect(await isFlagEnabled(k, brss.business.id)).toBe(true);
    await setFlag(sa, { key: k, businessId: brss.business.id, enabled: false });
    expect(await isFlagEnabled(k, brss.business.id)).toBe(false);
    expect(await isFlagEnabled(k, null)).toBe(true);
    await expect(
      setFlag(sa, { key: 'Bad Key!', businessId: null, enabled: true }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('a portal the module does not define cannot be switched on', async () => {
    const tech = await ctxFor(USERS.tech, 'hhmc');
    const config = await getModuleConfig(tech);
    expect(config.portals).toEqual({ staff: true, customer: false, field: false });
    await expect(setPortalEnabled(tech, 'customer', true)).rejects.toBeInstanceOf(ValidationError);
    expect(await isPortalAvailable(tech.business.id, 'customer')).toBe(false);
    expect(await isPortalAvailable(tech.business.id, 'field')).toBe(false);
  });
});

describe('activity log reading', () => {
  it('a business sees its own log; the platform log needs a platform role', async () => {
    const brss = await ctxFor(USERS.brssAdmin, 'brss');
    const marker = `Logged${Date.now()}`;
    await createCustomer(brss, { firstName: marker, lastName: 'Entry' });
    const own = await listBusinessActivity(brss, { search: marker });
    expect(own.rows).toHaveLength(1);
    expect(own.rows[0]).toMatchObject({ action: 'create', entityType: 'core.customer' });
    expect(
      (await listBusinessActivity(await ctxFor(USERS.hhmcAdmin, 'hhmc'), { search: marker })).total,
    ).toBe(0);
    expect((await listBusinessActivity(brss, { search: marker, action: 'archive' })).total).toBe(0);
    await expect(
      listPlatformActivity(await platformCtxFor(USERS.brssAdmin)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      (await listPlatformActivity(await platformCtxFor(USERS.tech), { search: marker })).total,
    ).toBe(1);
    await expect(
      listBusinessActivity(await ctxFor(USERS.brssNewHire, 'brss')),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
