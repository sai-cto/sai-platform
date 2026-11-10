/**
 * PROVES: a business_admin of business A cannot read or write business B.
 *
 * Checked at three levels, for EVERY registered entity (core + each module's):
 *   1. the context: A's admin cannot even open B;
 *   2. the record functions: with A's context, B's rows do not exist;
 *   3. the database: a raw query inside A's scope returns no B rows (row-level security).
 * Route-level checks (every console URL and export) are in tests/e2e/isolation.spec.ts.
 */
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/core/db/client';
import { businesses, memberships } from '@/core/db/schema';
import { txOf, withScope } from '@/core/db/scope';
import { ForbiddenError, NotFoundError } from '@/core/errors';
import { readFile, saveFile } from '@/core/files/files';
import { entitiesFor } from '@/core/modules/registry';
import {
  changeMemberRole,
  listMembers,
  removeMember,
  setMemberPermissions,
} from '@/core/people/memberships';
import {
  archiveRecord,
  createRecord,
  getRecord,
  listRecords,
  purgeRecord,
  restoreRecord,
  updateRecord,
} from '@/core/records/records';
import { customerEntity } from '@/core/records/core-entities';
import { buildBusinessContext } from '@/core/tenancy/context';
import { SEED_BUSINESSES } from '@/seed/businesses';
import { USERS, ageArchive, arrange, ctxFor, ensureRow, tableNameOf, userId } from './helpers';

// A = HHMC (the admin under test), B = every other business.
const A = 'hhmc';
const OTHERS = SEED_BUSINESSES.map((b) => b.slug).filter((slug) => slug !== A);

describe('context: a business admin can only open their own business', () => {
  it.each(OTHERS)('hhmc admin cannot build a context for %s', async (other) => {
    const id = await userId(USERS.hhmcAdmin);
    await expect(buildBusinessContext(id, other, 'live')).rejects.toBeInstanceOf(NotFoundError);
    await expect(buildBusinessContext(id, other, 'sandbox')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('an unknown business looks exactly like a forbidden one', async () => {
    const id = await userId(USERS.hhmcAdmin);
    await expect(buildBusinessContext(id, 'does-not-exist', 'live')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('staff cannot open another business either', async () => {
    await expect(ctxFor(USERS.brssStaff, 'hhmc')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a removed member loses access immediately', async () => {
    const admin = await ctxFor(USERS.tech, 'cp');
    const { addMember } = await import('@/core/people/memberships');
    const membershipId = await addMember(admin, {
      name: 'Temp Person',
      email: 'temp.person@sai.example',
      role: 'business_staff',
    });
    const tempId = await userId('temp.person@sai.example');
    await expect(buildBusinessContext(tempId, 'cp', 'live')).resolves.toBeTruthy();
    await removeMember(admin, membershipId);
    await expect(buildBusinessContext(tempId, 'cp', 'live')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe.each(OTHERS)('records: hhmc admin vs %s', (other) => {
  const entities = entitiesFor(other);

  it.each(entities.map((e) => [e.key, e] as const))(
    '%s — cannot read, change, archive, restore or purge',
    async (_key, entity) => {
      for (const environment of ['live', 'sandbox'] as const) {
        const theirRow = await arrange(other, environment, (s) => ensureRow(s, entity));
        const theirArchivedRow = await arrange(other, environment, async (s) => {
          const id = await ensureRow(s, entity);
          await archiveRecord(s, entity, id);
          return id;
        });
        await ageArchive(tableNameOf(entity), theirArchivedRow, 400);

        const mine = await ctxFor(USERS.hhmcAdmin, A, environment);
        // hhmc's module has no permission for another module's entity, so open the scope with a
        // permission the admin does hold, then try each operation on the other business's row.
        await withScope(mine, 'business.overview.read', async (s) => {
          const denied = (p: Promise<unknown>) =>
            expect(p).rejects.toSatisfy(
              (e: unknown) => e instanceof NotFoundError || e instanceof ForbiddenError,
            );
          await denied(getRecord(s, entity, theirRow));
          await denied(getRecord(s, entity, theirRow, 'include'));
          await denied(updateRecord(s, entity, theirRow, {} as never));
          await denied(archiveRecord(s, entity, theirRow));
          await denied(restoreRecord(s, entity, theirArchivedRow));
          await denied(purgeRecord(s, entity, theirArchivedRow));

          // Level 3: even a raw, unfiltered query inside A's scope cannot see B's rows.
          const raw = await txOf(s)
            .select({ id: entity.table.id })
            .from(entity.table)
            .where(eq(entity.table.id, theirRow));
          expect(raw).toHaveLength(0);
          const rawUpdate = await txOf(s)
            .update(entity.table)
            .set({ updatedAt: new Date() } as never)
            .where(eq(entity.table.id, theirRow))
            .returning({ id: entity.table.id });
          expect(rawUpdate).toHaveLength(0);
          const rawDelete = await txOf(s)
            .delete(entity.table)
            .where(eq(entity.table.id, theirRow))
            .returning({ id: entity.table.id });
          expect(rawDelete).toHaveLength(0);
        });

        // The other business's rows are untouched.
        await arrange(other, environment, async (s) => {
          await expect(getRecord(s, entity, theirRow)).resolves.toBeTruthy();
          await expect(getRecord(s, entity, theirArchivedRow, 'only')).resolves.toBeTruthy();
        });
      }
    },
  );

  it('listing never returns the other business’s rows', async () => {
    const otherId = (await getDb().select().from(businesses).where(eq(businesses.slug, other)))[0]
      .id;
    const mine = await ctxFor(USERS.hhmcAdmin, A);
    await withScope(mine, 'business.overview.read', async (s) => {
      for (const entity of entitiesFor(A)) {
        if (!mine.permissions.has(entity.readPermission)) continue;
        const { rows } = await listRecords(s, entity, { archived: 'include', limit: 5000 });
        expect(rows.every((r) => (r as { businessId: string }).businessId !== otherId)).toBe(true);
        expect(rows.every((r) => (r as { environment: string }).environment === 'live')).toBe(true);
      }
    });
  });
});

describe('records: a row can never be written INTO another business', () => {
  it('createRecord ignores a businessId / environment smuggled into the values', async () => {
    const brssId = (await getDb().select().from(businesses).where(eq(businesses.slug, 'brss')))[0]
      .id;
    const mine = await ctxFor(USERS.hhmcAdmin, A);
    const row = await withScope(mine, 'customers.write', (s) =>
      createRecord(s, customerEntity, {
        firstName: 'Smuggled',
        lastName: 'Row',
        businessId: brssId,
        environment: 'sandbox',
      } as never),
    );
    expect(row.businessId).toBe(mine.business.id);
    expect(row.environment).toBe('live');
  });

  it('updateRecord cannot move a row to another business', async () => {
    const brssId = (await getDb().select().from(businesses).where(eq(businesses.slug, 'brss')))[0]
      .id;
    const mine = await ctxFor(USERS.hhmcAdmin, A);
    const row = await withScope(mine, 'customers.write', async (s) => {
      const created = await createRecord(s, customerEntity, { firstName: 'Stay', lastName: 'Put' });
      return updateRecord(s, customerEntity, created.id, {
        firstName: 'Still',
        businessId: brssId,
        archivedAt: new Date(),
      } as never);
    });
    expect(row.businessId).toBe(mine.business.id);
    expect(row.archivedAt).toBeNull();
  });

  it('the database refuses a raw insert for another business (row-level security)', async () => {
    const brssId = (await getDb().select().from(businesses).where(eq(businesses.slug, 'brss')))[0]
      .id;
    const mine = await ctxFor(USERS.hhmcAdmin, A);
    await expect(
      withScope(mine, 'customers.write', (s) =>
        txOf(s)
          .insert(customerEntity.table)
          .values({
            businessId: brssId,
            environment: 'live',
            firstName: 'Raw',
            lastName: 'Insert',
          }),
      ),
    ).rejects.toThrow();
  });

  it('with no scope set at all, the app role sees no tenant rows', async () => {
    const rows = await getDb().select().from(customerEntity.table).limit(5);
    expect(rows).toHaveLength(0);
  });
});

describe('sandbox and live are separate', () => {
  it('a sandbox scope cannot see or change a live row, and the reverse', async () => {
    const live = await ctxFor(USERS.hhmcAdmin, A, 'live');
    const sandbox = await ctxFor(USERS.hhmcAdmin, A, 'sandbox');
    const liveRow = await withScope(live, 'customers.write', (s) =>
      createRecord(s, customerEntity, { firstName: 'Live', lastName: 'Only' }),
    );
    const sandboxRow = await withScope(sandbox, 'customers.write', (s) =>
      createRecord(s, customerEntity, { firstName: 'Sandbox', lastName: 'Only' }),
    );
    await withScope(sandbox, 'customers.write', async (s) => {
      await expect(getRecord(s, customerEntity, liveRow.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        updateRecord(s, customerEntity, liveRow.id, { firstName: 'Hacked' }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(
        await txOf(s)
          .select()
          .from(customerEntity.table)
          .where(eq(customerEntity.table.id, liveRow.id)),
      ).toHaveLength(0);
    });
    await withScope(live, 'customers.write', async (s) => {
      await expect(getRecord(s, customerEntity, sandboxRow.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(archiveRecord(s, customerEntity, sandboxRow.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });
});

describe('people and files are isolated too', () => {
  it('an admin cannot see or change another business’s members', async () => {
    const mine = await ctxFor(USERS.hhmcAdmin, A);
    const brss = (await getDb().select().from(businesses).where(eq(businesses.slug, 'brss')))[0];
    const [theirs] = await getDb()
      .select()
      .from(memberships)
      .where(eq(memberships.businessId, brss.id))
      .limit(1);
    const members = await listMembers(mine);
    expect(members.some((m) => m.membershipId === theirs.id)).toBe(false);
    await expect(changeMemberRole(mine, theirs.id, 'business_staff')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(removeMember(mine, theirs.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setMemberPermissions(mine, theirs.id, [])).rejects.toBeInstanceOf(NotFoundError);
  });

  it('an admin cannot read another business’s file', async () => {
    const theirs = await ctxFor(USERS.brssAdmin, 'brss');
    const file = await withScope(theirs, 'files.write', (s) =>
      saveFile(s, {
        filename: 'secret.txt',
        contentType: 'text/plain',
        bytes: new TextEncoder().encode('brss only'),
      }),
    );
    const mine = await ctxFor(USERS.hhmcAdmin, A);
    await expect(withScope(mine, 'files.read', (s) => readFile(s, file.id))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const own = await withScope(theirs, 'files.read', (s) => readFile(s, file.id));
    expect(new TextDecoder().decode(own.bytes)).toBe('brss only');
  });
});

describe('the database is set up to enforce isolation', () => {
  it('every table with a business_id column has row-level security on, with policies', async () => {
    const result = await getDb().execute<{
      table_name: string;
      rls: boolean;
      policies: number;
    }>(sql`
      select c.relname as table_name, c.relrowsecurity as rls,
             (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and exists (select 1 from information_schema.columns col where col.table_name = c.relname and col.column_name = 'environment')
        and exists (select 1 from information_schema.columns col where col.table_name = c.relname and col.column_name = 'business_id')`);
    const tables = [...result];
    expect(tables.length).toBeGreaterThanOrEqual(9);
    for (const t of tables) {
      expect(t.rls, `${t.table_name} must have row-level security`).toBe(true);
      expect(t.policies, `${t.table_name} must have policies`).toBeGreaterThanOrEqual(2);
    }
  });

  it('every tenant table is registered as an entity (so the tests above cover it)', async () => {
    const result = await getDb().execute<{ table_name: string }>(sql`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'archived_at'`);
    const registered = new Set(
      SEED_BUSINESSES.flatMap((b) => entitiesFor(b.slug)).map((e) => tableNameOf(e)),
    );
    for (const row of result)
      expect(
        registered.has(row.table_name),
        `${row.table_name} is not registered as an entity`,
      ).toBe(true);
  });

  it('the app connects as a role that cannot bypass row-level security', async () => {
    const [role] = [
      ...(await getDb().execute<{ rolbypassrls: boolean; rolsuper: boolean; name: string }>(
        sql`select rolbypassrls, rolsuper, rolname as name from pg_roles where rolname = current_user`,
      )),
    ];
    expect(role).toMatchObject({ name: 'sai_app', rolbypassrls: false, rolsuper: false });
  });
});
