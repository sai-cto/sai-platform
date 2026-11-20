/**
 * HHMC's admins run HHMC from inside the app (managers' feedback round 1, Nov 2026;
 * ModuleManifest.adminInApp): Data, Activity log, People and access and every module setting,
 * in one set of tabs, and nothing outside HHMC. The super admin keeps everything.
 */
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '@/core/errors';
import { getModuleConfig, setPortalEnabled, updateModuleSettings } from '@/core/modules/config';
import { adminSectionLinks, adminSettingsLinks } from '@/core/modules/portal';
import { listMembers } from '@/core/people/memberships';
import { listUsers } from '@/core/people/users';
import { businessTabs } from '@/app/console/_lib/nav';
import { staffSectionLinks } from '@/server/app-sections';
import { USERS, ctxFor, platformCtxFor } from './helpers';

const forbidden = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(ForbiddenError);
const ADMIN_PERMISSIONS = ['business.data.read', 'business.data.export', 'business.activity.read', 'business.people.read', 'business.people.manage', 'business.settings.read', 'business.settings.write'];

describe('an HHMC business admin', () => {
  it('holds full control of HHMC: data, activity, people and settings', async () => {
    const ctx = await ctxFor(USERS.hhmcAdmin, 'hhmc');
    for (const key of ADMIN_PERMISSIONS) expect(ctx.permissions.has(key), key).toBe(true);
    // ...but cannot purge records or switch a portal off (their own app included).
    for (const key of ['business.data.purge', 'business.portals.write']) expect(ctx.permissions.has(key), key).toBe(false);
    await forbidden(setPortalEnabled(ctx, 'staff', false));
  });

  it('changes the module settings, and the change is kept', async () => {
    const ctx = await ctxFor(USERS.hhmcAdmin, 'hhmc');
    const before = (await getModuleConfig(ctx)).settings.localServiceMaxMiles as number;
    try {
      await updateModuleSettings(ctx, { localServiceMaxMiles: before + 1 });
      expect((await getModuleConfig(ctx)).settings.localServiceMaxMiles).toBe(before + 1);
    } finally {
      await updateModuleSettings(ctx, { localServiceMaxMiles: before });
    }
  });

  it('sees one set of tabs, inside the app: Data, Activity log and one Settings with People and access', async () => {
    const ctx = await ctxFor(USERS.hhmcAdmin, 'hhmc');
    expect(businessTabs(ctx).map((t) => t.key)).toEqual(['app']);
    const sections = staffSectionLinks(ctx, {}).map((l) => l.label);
    expect(sections).toEqual(expect.arrayContaining(['Leads', 'Data', 'Activity log', 'Settings']));
    expect(sections.indexOf('Data')).toBeLessThan(sections.indexOf('Settings'));
    expect(adminSettingsLinks(ctx).map((l) => l.label)).toEqual(['Business settings', 'People and access']);
    expect(adminSectionLinks(ctx).map((l) => l.href)).toEqual(['/console/hhmc/live/data', '/console/hhmc/live/activity']);
  });

  it('sees only HHMC people', async () => {
    const ctx = await ctxFor(USERS.hhmcAdmin, 'hhmc');
    const members = await listMembers(ctx);
    expect(members.map((m) => m.email)).toEqual(expect.arrayContaining([USERS.hhmcAdmin, USERS.hhmcStaff]));
    for (const other of [USERS.brssAdmin, USERS.brssStaff, USERS.superAdmin, USERS.tech]) expect(members.map((m) => m.email)).not.toContain(other);
  });

  it('gets nothing outside HHMC: no other business, no platform settings, no other users', async () => {
    await expect(ctxFor(USERS.hhmcAdmin, 'brss')).rejects.toThrow();
    const platform = await platformCtxFor(USERS.hhmcAdmin);
    expect(platform.permissions.size).toBe(0);
    await forbidden(listUsers(platform));
  });
});

describe('everyone else', () => {
  it('HHMC staff get the app without the admin sections', async () => {
    const ctx = await ctxFor(USERS.hhmcStaff, 'hhmc');
    for (const key of ['business.people.read', 'business.settings.write', 'business.portals.write']) expect(ctx.permissions.has(key), key).toBe(false);
    expect(adminSettingsLinks(ctx)).toEqual([]);
    expect(staffSectionLinks(ctx, {}).map((l) => l.label)).not.toContain('People and access');
    await forbidden(updateModuleSettings(ctx, {}));
  });

  it("another business's admin keeps the old rule (its module does not run its admin in the app)", async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss');
    expect(ctx.permissions.has('business.settings.write')).toBe(false);
    expect(adminSectionLinks(ctx)).toEqual([]);
    await forbidden(updateModuleSettings(ctx, {}));
  });

  it('the super admin keeps everything, in HHMC through the same in-app tabs', async () => {
    const hhmc = await ctxFor(USERS.superAdmin, 'hhmc');
    for (const key of [...ADMIN_PERMISSIONS, 'business.data.purge', 'business.portals.write']) expect(hhmc.permissions.has(key), key).toBe(true);
    expect(businessTabs(hhmc).map((t) => t.key)).toEqual(['app']);
    expect(staffSectionLinks(hhmc, {}).map((l) => l.label)).toEqual(expect.arrayContaining(['Data', 'Activity log', 'Settings']));
    // Other businesses still have the console tabs.
    const brss = await ctxFor(USERS.superAdmin, 'brss');
    expect(businessTabs(brss).map((t) => t.key)).toEqual(expect.arrayContaining(['overview', 'people', 'data', 'activity', 'settings']));
    expect((await platformCtxFor(USERS.superAdmin)).permissions.has('platform.settings.write')).toBe(true);
  });
});
