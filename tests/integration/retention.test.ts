/**
 * PROVES: "delete" is a recoverable archive; permanent delete is possible ONLY for
 * super_admin and ONLY after the retention window.
 */
import { describe, expect, it } from 'vitest';
import { withScope } from '@/core/db/scope';
import { ForbiddenError, NotFoundError, ValidationError } from '@/core/errors';
import { customerEntity, paymentEntity } from '@/core/records/core-entities';
import {
  archiveRecord,
  createRecord,
  getRecord,
  listRecords,
  purgeRecord,
  restoreRecord,
} from '@/core/records/records';
import { getRetentionDays, setRetentionDays } from '@/core/settings/platform';
import { USERS, ageArchive, arrange, ctxFor, logFor, platformCtxFor } from './helpers';

async function archivedCustomer(daysAgo: number): Promise<string> {
  const id = await arrange('brss', 'live', async (s) => {
    const row = await createRecord(s, customerEntity, {
      firstName: 'Retention',
      lastName: `Test ${daysAgo}`,
    });
    await archiveRecord(s, customerEntity, row.id);
    return row.id;
  });
  if (daysAgo > 0) await ageArchive('customers', id, daysAgo);
  return id;
}

const purgeAs = async (email: string, id: string) => {
  const ctx = await ctxFor(email, 'brss');
  return withScope(ctx, 'business.overview.read', (s) => purgeRecord(s, customerEntity, id));
};

describe('archive and restore', () => {
  it('archiving hides a record, restoring brings it back, nothing is lost', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    const row = await withScope(ctx, 'customers.write', (s) =>
      createRecord(s, customerEntity, {
        firstName: 'Archie',
        lastName: 'Restore',
        notes: 'keep me',
      }),
    );
    await withScope(ctx, 'customers.write', (s) => archiveRecord(s, customerEntity, row.id));
    await withScope(ctx, 'customers.read', async (s) => {
      await expect(getRecord(s, customerEntity, row.id)).rejects.toBeInstanceOf(NotFoundError);
      const active = await listRecords(s, customerEntity, { search: 'Archie' });
      expect(active.rows.some((r) => r.id === row.id)).toBe(false);
      const archived = await listRecords(s, customerEntity, { archived: 'only', search: 'Archie' });
      expect(archived.rows.some((r) => r.id === row.id)).toBe(true);
    });
    await withScope(ctx, 'customers.write', (s) => restoreRecord(s, customerEntity, row.id));
    const back = await withScope(ctx, 'customers.read', (s) =>
      getRecord(s, customerEntity, row.id),
    );
    expect(back).toMatchObject({ firstName: 'Archie', notes: 'keep me', archivedAt: null });
  });

  it('archiving twice, or restoring something not archived, is "not found"', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    const row = await withScope(ctx, 'customers.write', (s) =>
      createRecord(s, customerEntity, { firstName: 'Twice', lastName: 'Archived' }),
    );
    await withScope(ctx, 'customers.write', async (s) => {
      await expect(restoreRecord(s, customerEntity, row.id)).rejects.toBeInstanceOf(NotFoundError);
      await archiveRecord(s, customerEntity, row.id);
    });
    await expect(
      withScope(ctx, 'customers.write', (s) => archiveRecord(s, customerEntity, row.id)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('permanent delete: who and when', () => {
  const OTHER_ROLES = [
    ['tech', USERS.tech],
    ['executive', USERS.executive],
    ['business_admin', USERS.brssAdmin],
    ['business_staff', USERS.brssStaff],
  ] as const;

  it.each(OTHER_ROLES)('%s cannot purge, even long past retention', async (_role, email) => {
    const id = await archivedCustomer(400);
    await expect(purgeAs(email, id)).rejects.toBeInstanceOf(ForbiddenError);
    await arrange('brss', 'live', (s) =>
      expect(getRecord(s, customerEntity, id, 'only')).resolves.toBeTruthy(),
    );
  });

  it('super_admin cannot purge a record archived today', async () => {
    const id = await archivedCustomer(0);
    await expect(purgeAs(USERS.superAdmin, id)).rejects.toBeInstanceOf(ValidationError);
  });

  it('super_admin cannot purge one day before retention ends (29 days, default 30)', async () => {
    expect(await getRetentionDays()).toBe(30);
    const id = await archivedCustomer(29);
    await expect(purgeAs(USERS.superAdmin, id)).rejects.toBeInstanceOf(ValidationError);
    await arrange('brss', 'live', (s) =>
      expect(getRecord(s, customerEntity, id, 'only')).resolves.toBeTruthy(),
    );
  });

  it('super_admin cannot purge a record that is not archived', async () => {
    const id = await arrange(
      'brss',
      'live',
      async (s) =>
        (await createRecord(s, customerEntity, { firstName: 'Active', lastName: 'Record' })).id,
    );
    await expect(purgeAs(USERS.superAdmin, id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('super_admin CAN purge a record archived 31 days ago; it is gone and the log keeps a tombstone only', async () => {
    const id = await archivedCustomer(31);
    await purgeAs(USERS.superAdmin, id);
    await arrange('brss', 'live', (s) =>
      expect(getRecord(s, customerEntity, id, 'include')).rejects.toBeInstanceOf(NotFoundError),
    );
    const [entry] = (await logFor('core.customer', id)).filter((l) => l.action === 'purge');
    expect(entry.actorRole).toBe('super_admin');
    expect(entry.after).toBeNull();
    expect(Object.keys(entry.before ?? {}).sort()).toEqual(['archivedAt', 'label']);
  });

  it('the retention window is configurable, by super_admin only', async () => {
    const sa = await platformCtxFor(USERS.superAdmin);
    const id = await archivedCustomer(10);
    await expect(purgeAs(USERS.superAdmin, id)).rejects.toBeInstanceOf(ValidationError);
    await setRetentionDays(sa, 7);
    try {
      await purgeAs(USERS.superAdmin, id);
    } finally {
      await setRetentionDays(sa, 30);
    }
    await expect(setRetentionDays(await platformCtxFor(USERS.tech), 1)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(setRetentionDays(sa, 0)).rejects.toBeInstanceOf(ValidationError);
  });

  it('a record other records depend on is refused with a clear message, and nothing is deleted', async () => {
    const customerId = await arrange('brss', 'live', async (s) => {
      const customer = await createRecord(s, customerEntity, {
        firstName: 'Has',
        lastName: 'Payments',
      });
      await createRecord(s, paymentEntity, {
        customerId: customer.id,
        amountCents: 100,
        status: 'succeeded',
        provider: 'mock',
      });
      await archiveRecord(s, customerEntity, customer.id);
      return customer.id;
    });
    await ageArchive('customers', customerId, 60);
    await expect(purgeAs(USERS.superAdmin, customerId)).rejects.toThrow(/still refer/);
    await arrange('brss', 'live', (s) =>
      expect(getRecord(s, customerEntity, customerId, 'only')).resolves.toBeTruthy(),
    );
  });
});
