/**
 * PROVES the role rules that are locked by the project brief, by calling the real
 * functions as each seed role. docs/PERMISSIONS.md is generated from the same matrix
 * these tests exercise, and the last test fails if that file is out of date.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCustomer } from '@/core/customers/customers';
import { withScope } from '@/core/db/scope';
import { ForbiddenError, ValidationError } from '@/core/errors';
import { setFlag } from '@/core/flags/flags';
import { setPortalEnabled, updateModuleSettings } from '@/core/modules/config';
import {
  addMember,
  changeMemberRole,
  listMembers,
  removeMember,
  setMemberPermissions,
} from '@/core/people/memberships';
import { createUser, listUsers, setPlatformRole, setUserActive } from '@/core/people/users';
import { entitiesFor } from '@/core/modules/registry';
import { CORE_ACTIONS } from '@/core/rbac/actions';
import { businessActions, platformActions } from '@/core/rbac/permissions';
import { customerEntity } from '@/core/records/core-entities';
import {
  archiveRecord,
  createRecord,
  purgeRecord,
  restoreRecord,
  updateRecord,
} from '@/core/records/records';
import { resetSandbox } from '@/core/sandbox/sandbox';
import { setRetentionDays } from '@/core/settings/platform';
import { buildBusinessContext } from '@/core/tenancy/context';
import { SEED_BUSINESSES } from '@/seed/businesses';
import { renderPermissionsDoc } from '../../scripts/lib/permissions-doc';
import { USERS, arrange, ctxFor, ensureRow, platformCtxFor, userId } from './helpers';

const forbidden = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(ForbiddenError);

describe('executive: read-only everywhere', () => {
  it('holds no write action in any business or on the platform', async () => {
    const platform = await platformCtxFor(USERS.executive);
    for (const a of platformActions().filter((x) => x.kind === 'write'))
      expect(platform.permissions.has(a.key), a.key).toBe(false);
    for (const b of SEED_BUSINESSES) {
      const ctx = await ctxFor(USERS.executive, b.slug);
      for (const a of businessActions(b.slug).filter((x) => x.kind === 'write'))
        expect(ctx.permissions.has(a.key), `${b.slug}:${a.key}`).toBe(false);
    }
  });

  it('every record write function refuses, for every entity, in every business', async () => {
    for (const b of SEED_BUSINESSES) {
      const ctx = await ctxFor(USERS.executive, b.slug);
      // entitiesFor() = the core's entities plus this business's module's, so a new module is covered.
      for (const entity of entitiesFor(b.slug)) {
        const id = await arrange(b.slug, 'live', (s) => ensureRow(s, entity));
        await withScope(ctx, 'business.overview.read', async (s) => {
          await forbidden(createRecord(s, entity, {} as never));
          await forbidden(updateRecord(s, entity, id, {} as never));
          await forbidden(archiveRecord(s, entity, id));
          await forbidden(restoreRecord(s, entity, id));
          await forbidden(purgeRecord(s, entity, id));
        });
      }
    }
  });

  it('every other write function refuses', async () => {
    const platform = await platformCtxFor(USERS.executive);
    const brss = await ctxFor(USERS.executive, 'brss');
    const someone = await userId(USERS.brssStaff);
    await forbidden(createUser(platform, { name: 'X', email: 'x@sai.example' }));
    await forbidden(setPlatformRole(platform, someone, 'tech'));
    await forbidden(setUserActive(platform, someone, false));
    await forbidden(setFlag(platform, { key: 'exec.flag', businessId: null, enabled: true }));
    await forbidden(setRetentionDays(platform, 1));
    await forbidden(createCustomer(brss, { firstName: 'No', lastName: 'Way' }));
    await forbidden(addMember(brss, { name: 'X', email: 'x@sai.example', role: 'business_staff' }));
    await forbidden(changeMemberRole(brss, someone, 'business_admin'));
    await forbidden(removeMember(brss, someone));
    await forbidden(setMemberPermissions(brss, someone, []));
    await forbidden(updateModuleSettings(brss, {}));
    await forbidden(setPortalEnabled(brss, 'customer', true));
    await forbidden(resetSandbox(brss));
  });

  it('cannot use the sandbox, export, see people or settings — but can read data and activity', async () => {
    await forbidden(buildBusinessContext(await userId(USERS.executive), 'brss', 'sandbox'));
    const ctx = await ctxFor(USERS.executive, 'brss');
    for (const key of [
      'business.data.export',
      'business.people.read',
      'business.settings.read',
      'business.app.use',
    ])
      expect(ctx.permissions.has(key), key).toBe(false);
    for (const key of [
      'business.overview.read',
      'business.data.read',
      'business.activity.read',
      'customers.read',
      'payments.read',
    ])
      expect(ctx.permissions.has(key), key).toBe(true);
    const platform = await platformCtxFor(USERS.executive);
    expect(platform.permissions.has('executive.dashboard.read')).toBe(true);
    await forbidden(listUsers(platform));
  });
});

describe('tech: everything except permanent delete and super_admin settings', () => {
  it('can work in every business, live and sandbox', async () => {
    for (const b of SEED_BUSINESSES) {
      const ctx = await ctxFor(USERS.tech, b.slug, 'sandbox');
      const row = await createCustomer(ctx, { firstName: 'Tech', lastName: 'Made' });
      expect(row.businessId).toBe(ctx.business.id);
    }
    const live = await ctxFor(USERS.tech, 'brss');
    expect(live.permissions.has('business.settings.write')).toBe(true);
  });

  it('cannot permanently delete, change platform settings, or grant platform roles', async () => {
    const platform = await platformCtxFor(USERS.tech);
    const brss = await ctxFor(USERS.tech, 'brss');
    expect(brss.permissions.has('business.data.purge')).toBe(false);
    await forbidden(setRetentionDays(platform, 1));
    await forbidden(setPlatformRole(platform, await userId(USERS.brssStaff), 'tech'));
    await forbidden(setPlatformRole(platform, await userId(USERS.superAdmin), null));
    // ...and cannot switch a platform-role account off either.
    await forbidden(setUserActive(platform, await userId(USERS.executive), false));
  });
});

describe('business_admin: their own business, no permanent delete, no settings changes', () => {
  it('has day-to-day permissions but not purge or settings.write', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    for (const key of [
      'business.people.manage',
      'business.data.export',
      'business.sandbox.reset',
      'customers.write',
      'payments.write',
    ])
      expect(ctx.permissions.has(key), key).toBe(true);
    for (const key of ['business.data.purge', 'business.settings.write'])
      expect(ctx.permissions.has(key), key).toBe(false);
    await forbidden(updateModuleSettings(ctx, {}));
  });

  it('has no platform permissions at all', async () => {
    const platform = await platformCtxFor(USERS.brssAdmin);
    expect(platform.permissions.size).toBe(0);
    await forbidden(listUsers(platform));
  });

  it('manages their own staff, and a business always keeps one admin', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    const membershipId = await addMember(ctx, {
      name: 'Perm Test',
      email: 'perm.test@sai.example',
      role: 'business_staff',
    });
    await setMemberPermissions(ctx, membershipId, ['customers.read', 'customers.write']);
    const staff = await ctxFor('perm.test@sai.example', 'brss');
    expect(staff.permissions.has('customers.write')).toBe(true);
    expect(staff.permissions.has('payments.write')).toBe(false);
    // Not grantable to staff, whatever the admin asks for:
    await expect(
      setMemberPermissions(ctx, membershipId, ['business.people.manage']),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      setMemberPermissions(ctx, membershipId, ['business.data.purge']),
    ).rejects.toBeInstanceOf(ValidationError);
    await removeMember(ctx, membershipId);

    const me = (await listMembers(ctx)).find((m) => m.email === USERS.brssAdmin)!;
    await expect(removeMember(ctx, me.membershipId)).rejects.toBeInstanceOf(ValidationError);
    await expect(changeMemberRole(ctx, me.membershipId, 'business_staff')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('cannot add someone who holds a platform role', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    await expect(
      addMember(ctx, { name: 'Tessa', email: USERS.tech, role: 'business_staff' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('business_staff: limited to what their admin grants', () => {
  it('a new hire with no grants can open the app and overview and send feedback, nothing else', async () => {
    const ctx = await ctxFor(USERS.brssNewHire, 'brss');
    expect([...ctx.permissions].sort()).toEqual(['business.app.use', 'business.feedback.send', 'business.overview.read']);
    await forbidden(createCustomer(ctx, { firstName: 'No', lastName: 'Grant' }));
    await forbidden(buildBusinessContext(await userId(USERS.brssNewHire), 'brss', 'sandbox'));
  });

  it('default staff can read customers but not write, manage people or archive', async () => {
    const ctx = await ctxFor(USERS.brssStaff, 'brss');
    expect(ctx.permissions.has('customers.read')).toBe(true);
    await forbidden(createCustomer(ctx, { firstName: 'No', lastName: 'Write' }));
    await forbidden(listMembers(ctx));
    const id = await arrange('brss', 'live', (s) => ensureRow(s, customerEntity));
    await forbidden(withScope(ctx, 'customers.read', (s) => archiveRecord(s, customerEntity, id)));
  });

  it('one person can hold different roles in different businesses', async () => {
    const tut = await ctxFor(USERS.multi, 'tut');
    const cbb = await ctxFor(USERS.multi, 'cbb');
    expect(tut.role).toBe('business_admin');
    expect(cbb.role).toBe('business_staff');
    expect(cbb.permissions.has('business.people.manage')).toBe(false);
  });
});

describe('super_admin', () => {
  it('holds every action', async () => {
    const platform = await platformCtxFor(USERS.superAdmin);
    for (const a of platformActions()) expect(platform.permissions.has(a.key), a.key).toBe(true);
    const ctx = await ctxFor(USERS.superAdmin, 'brss');
    for (const a of businessActions('brss')) expect(ctx.permissions.has(a.key), a.key).toBe(true);
  });

  it('the last super admin cannot be demoted or deactivated', async () => {
    const platform = await platformCtxFor(USERS.superAdmin);
    const me = await userId(USERS.superAdmin);
    await expect(setPlatformRole(platform, me, null)).rejects.toBeInstanceOf(ValidationError);
    await expect(setUserActive(platform, me, false)).rejects.toBeInstanceOf(ValidationError);
  });

  it('a person with business roles cannot also be given a platform role', async () => {
    const platform = await platformCtxFor(USERS.superAdmin);
    await expect(
      setPlatformRole(platform, await userId(USERS.hhmcStaff), 'tech'),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('the matrix itself', () => {
  it('no business role holds a platform action, and nobody but super_admin holds purge / platform settings / role grants', () => {
    for (const a of CORE_ACTIONS.filter((x) => x.scope === 'platform')) {
      expect(a.allow.business_admin, a.key).toBe(false);
      expect(a.allow.business_staff, a.key).toBe(false);
    }
    for (const key of ['business.data.purge', 'platform.settings.write', 'platform.roles.grant']) {
      const a = CORE_ACTIONS.find((x) => x.key === key)!;
      expect(a.allow).toEqual({
        super_admin: true,
        tech: false,
        executive: false,
        business_admin: false,
        business_staff: false,
      });
    }
  });

  it('docs/PERMISSIONS.md is up to date with the matrix (run: npm run docs:permissions)', () => {
    const committed = fs.readFileSync(path.resolve(__dirname, '../../docs/PERMISSIONS.md'), 'utf8');
    expect(committed).toBe(renderPermissionsDoc());
  });
});
