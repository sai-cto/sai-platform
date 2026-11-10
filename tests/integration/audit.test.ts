/**
 * PROVES: every mutation produces an activity log entry (who, what, when, which business,
 * before and after), written in the same transaction, and the log cannot be changed.
 */
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { loginWithDev, logout } from '@/core/auth/login';
import { activityLog } from '@/core/db/schema';
import { txOf, withScope } from '@/core/db/scope';
import { setFlag } from '@/core/flags/flags';
import {
  addMember,
  changeMemberRole,
  removeMember,
  setMemberPermissions,
} from '@/core/people/memberships';
import { createUser, setPlatformRole, setUserActive } from '@/core/people/users';
import { CORE_ENTITIES, customerEntity } from '@/core/records/core-entities';
import {
  archiveRecord,
  createRecord,
  purgeRecord,
  restoreRecord,
  updateRecord,
} from '@/core/records/records';
import { resetSandbox } from '@/core/sandbox/sandbox';
import { setRetentionDays } from '@/core/settings/platform';
import { entitiesFor } from '@/core/modules/registry';
import { SEED_BUSINESSES } from '@/seed/businesses';
import {
  FIXTURES,
  USERS,
  ageArchive,
  asOwner,
  ctxFor,
  ensureRow,
  logFor,
  platformCtxFor,
  tableNameOf,
  userId,
} from './helpers';

/** Rows in the whole log, counted as the owner (bypasses row-level security). */
const logCount = () =>
  asOwner(async (q) => Number((await q`select count(*)::int as n from activity_log`)[0].n));

describe('record functions: one log entry per change, for every core entity', () => {
  it.each(CORE_ENTITIES.map((e) => [e.key, e] as const))(
    '%s — create, update, archive, restore, purge',
    async (_key, entity) => {
      const ctx = await ctxFor(USERS.superAdmin, 'tut');
      const started = new Date(Date.now() - 1000);

      const values = await withScope(ctx, 'business.overview.read', (s) => FIXTURES[entity.key](s));
      const row = await withScope(ctx, 'business.overview.read', (s) =>
        createRecord(s, entity, values as never),
      );
      const id = String(row.id);

      // Change the first changeable text column the fixture set, so "before" and "after" differ.
      const [field, oldValue] = Object.entries(values).find(
        ([key, v]) => typeof v === 'string' && !/^[0-9a-f-]{36}$/.test(v) && !(entity.immutableFields ?? []).includes(key),
      )!;
      await withScope(ctx, 'business.overview.read', (s) =>
        updateRecord(s, entity, id, { [field]: `${oldValue} (edited)` } as never),
      );
      await withScope(ctx, 'business.overview.read', (s) => archiveRecord(s, entity, id));
      await withScope(ctx, 'business.overview.read', (s) => restoreRecord(s, entity, id));
      await withScope(ctx, 'business.overview.read', (s) => archiveRecord(s, entity, id));
      await ageArchive(tableNameOf(entity), id, 45);
      await withScope(ctx, 'business.overview.read', (s) => purgeRecord(s, entity, id));

      const entries = (await logFor(entity.key, id, started)).reverse();
      expect(entries.map((e) => e.action)).toEqual([
        'create',
        'update',
        'archive',
        'restore',
        'archive',
        'purge',
      ]);
      for (const e of entries) {
        expect(e.actorUserId).toBe(ctx.actor.id); // who
        expect(e.actorRole).toBe('super_admin');
        expect(e.businessId).toBe(ctx.business.id); // which business
        expect(e.environment).toBe('live');
        expect(e.occurredAt.getTime()).toBeGreaterThan(started.getTime()); // when
        expect(e.summary.length).toBeGreaterThan(5); // what
      }
      const [created, updated, archived, restored] = entries;
      expect(created.before).toBeNull();
      expect(created.after).toMatchObject({ [field]: oldValue });
      expect(updated.before).toEqual({ [field]: oldValue });
      expect(updated.after).toEqual({ [field]: `${oldValue} (edited)` });
      expect(archived.before).toEqual({ archivedAt: null });
      expect(archived.after?.archivedAt).toBeTruthy();
      expect(restored.after).toEqual({ archivedAt: null });
    },
  );

  it('an update that changes nothing writes no entry', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    const row = await withScope(ctx, 'customers.write', (s) =>
      createRecord(s, customerEntity, { firstName: 'Same', lastName: 'Same' }),
    );
    await withScope(ctx, 'customers.write', (s) =>
      updateRecord(s, customerEntity, row.id, { firstName: 'Same' }),
    );
    expect((await logFor('core.customer', row.id)).map((l) => l.action)).toEqual(['create']);
  });

  it('archive and restore are logged for every registered entity of every business', async () => {
    // Runs over the registry, so a new module's entities are covered automatically.
    for (const b of SEED_BUSINESSES) {
      const ctx = await ctxFor(USERS.superAdmin, b.slug, 'sandbox');
      for (const entity of entitiesFor(b.slug)) {
        const id = await withScope(ctx, 'business.overview.read', (s) => ensureRow(s, entity));
        const before = (await logFor(entity.key, id)).length;
        await withScope(ctx, 'business.overview.read', async (s) => {
          await archiveRecord(s, entity, id);
          await restoreRecord(s, entity, id);
        });
        const added = (await logFor(entity.key, id)).slice(
          0,
          (await logFor(entity.key, id)).length - before,
        );
        expect(added.map((l) => l.action).sort(), `${b.slug}:${entity.key}`).toEqual([
          'archive',
          'restore',
        ]);
        expect(
          added.every((l) => l.environment === 'sandbox' && l.businessId === ctx.business.id),
        ).toBe(true);
      }
    }
  });
});

describe('the change and its log entry succeed or fail together', () => {
  it('if the transaction fails after the write, neither the row nor the entry exists', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    const before = await logCount();
    let id = '';
    await expect(
      withScope(ctx, 'customers.write', async (s) => {
        id = (await createRecord(s, customerEntity, { firstName: 'Rolled', lastName: 'Back' })).id;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await logCount()).toBe(before);
    expect(await logFor('core.customer', id)).toHaveLength(0);
  });

  it('if the log entry cannot be written, the change is rolled back', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    const badEntity = {
      ...customerEntity,
      titleOf: () => {
        throw new Error('cannot describe');
      },
    };
    const marker = `NoLog${Date.now()}`;
    await expect(
      withScope(ctx, 'customers.write', (s) =>
        createRecord(s, badEntity, { firstName: marker, lastName: 'X' }),
      ),
    ).rejects.toThrow('cannot describe');
    const found = await withScope(ctx, 'customers.read', (s) =>
      s.db.select().from(customerEntity.table).where(eq(customerEntity.table.firstName, marker)),
    );
    expect(found).toHaveLength(0);
  });
});

describe('platform and people changes are logged', () => {
  it('user creation, platform role changes and deactivation', async () => {
    const sa = await platformCtxFor(USERS.superAdmin);
    const id = await createUser(sa, {
      name: 'Audit Person',
      email: `audit.${Date.now()}@sai.example`,
    });
    await setPlatformRole(sa, id, 'executive');
    await setPlatformRole(sa, id, null);
    await setUserActive(sa, id, false);
    const actions = (await logFor('user', id)).reverse().map((l) => [l.action, l.before, l.after]);
    expect(actions).toEqual([
      ['create', null, expect.objectContaining({ name: 'Audit Person' })],
      ['permission_change', { platformRole: null }, { platformRole: 'executive' }],
      ['permission_change', { platformRole: 'executive' }, { platformRole: null }],
      ['permission_change', { isActive: true }, { isActive: false }],
    ]);
  });

  it('membership add, role change, grants change and removal', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    const membershipId = await addMember(ctx, {
      name: 'Audit Member',
      email: `audit.member.${Date.now()}@sai.example`,
      role: 'business_staff',
    });
    await setMemberPermissions(ctx, membershipId, ['customers.read']);
    await changeMemberRole(ctx, membershipId, 'business_admin');
    await removeMember(ctx, membershipId);
    const entries = (await logFor('membership', membershipId)).reverse();
    expect(entries.map((l) => l.action)).toEqual([
      'permission_change',
      'permission_change',
      'permission_change',
      'permission_change',
    ]);
    expect(
      entries.every((l) => l.businessId === ctx.business.id && l.actorUserId === ctx.actor.id),
    ).toBe(true);
    expect(entries[1].after).toEqual({ grants: ['customers.read'] });
    expect(entries[3].after).toEqual({ isActive: false, grants: [] });
  });

  it('feature flags, retention and sandbox reset', async () => {
    const sa = await platformCtxFor(USERS.superAdmin);
    const key = `audit.flag.${Date.now()}`;
    await setFlag(sa, { key, businessId: null, enabled: true });
    await setFlag(sa, { key, businessId: null, enabled: false });
    expect((await logFor('feature_flag', key)).map((l) => l.action)).toEqual([
      'settings_change',
      'settings_change',
    ]);

    await setRetentionDays(sa, 31);
    await setRetentionDays(sa, 30);
    const retention = await logFor('platform.setting', 'retention_days');
    expect(retention[0]).toMatchObject({
      action: 'settings_change',
      before: { retention_days: 31 },
      after: { retention_days: 30 },
    });

    const started = new Date(Date.now() - 1000);
    await resetSandbox(await ctxFor(USERS.tech, 'cp'));
    const [reset] = await logFor('sandbox', 'cp', started);
    expect(reset).toMatchObject({ action: 'sandbox_reset', environment: 'sandbox' });
  });

  it('sign-in, failed sign-in and sign-out', async () => {
    const id = await userId(USERS.brssStaff);
    const started = new Date(Date.now() - 1000);
    const session = await loginWithDev(id);
    await logout(session.token);
    expect((await logFor('user', id, started)).reverse().map((l) => l.action)).toEqual([
      'login',
      'logout',
    ]);

    const ghost = '00000000-0000-4000-8000-000000000000';
    await expect(loginWithDev(ghost)).rejects.toThrow();
    expect((await logFor('user', ghost, started)).map((l) => l.action)).toEqual(['login_failed']);
  });
});

describe('the log is append-only', () => {
  it('the app role cannot update, delete or truncate it', async () => {
    const ctx = await ctxFor(USERS.superAdmin, 'brss');
    for (const statement of [
      sql`update activity_log set summary = 'tampered'`,
      sql`delete from activity_log`,
      sql`truncate activity_log`,
    ]) {
      await expect(
        withScope(ctx, 'business.overview.read', (s) => txOf(s).execute(statement)),
      ).rejects.toThrow();
    }
  });

  it('even the database owner is stopped by the trigger', async () => {
    const before = await logCount();
    expect(before).toBeGreaterThan(0);
    await expect(asOwner((q) => q`update activity_log set summary = 'tampered'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(asOwner((q) => q`delete from activity_log`)).rejects.toThrow(/append-only/);
    await expect(asOwner((q) => q`truncate activity_log`)).rejects.toThrow(/append-only/);
    expect(await logCount()).toBe(before);
  });

  it('a business scope cannot read another business’s entries', async () => {
    const hhmc = await ctxFor(USERS.hhmcAdmin, 'hhmc');
    const rows = await withScope(hhmc, 'business.activity.read', (s) =>
      s.db.select().from(activityLog),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.businessId === hhmc.business.id)).toBe(true);
  });
});
