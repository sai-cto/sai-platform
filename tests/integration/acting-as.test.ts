/**
 * "Act as" (src/core/auth/acting-as.ts): a super admin sees and uses the site as someone else,
 * and every change is logged with the super admin's id.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { ACTING_AS_MINUTES, findSessionPrincipal, startActingAs, stopActingAs } from '@/core/auth/acting-as';
import { loginWithDev } from '@/core/auth/login';
import { logActivity } from '@/core/audit/log';
import { getDb } from '@/core/db/client';
import { users } from '@/core/db/schema';
import { ForbiddenError, ValidationError } from '@/core/errors';
import { buildBusinessContext, buildPlatformContext } from '@/core/tenancy/context';
import { USERS, asOwner, userId } from './helpers';

let sessionToken: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (sessionToken ? { value: sessionToken } : undefined) }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

async function tokenFor(email: string): Promise<string> {
  return (await loginWithDev(await userId(email))).token;
}

describe('acting as someone', () => {
  it('a super admin sees exactly what the person sees, and changes are logged as the super admin', async () => {
    const token = await tokenFor(USERS.superAdmin);
    const own = await buildPlatformContext((await findSessionPrincipal(token))!);
    await startActingAs(own, token, await userId(USERS.hhmcStaff));

    const principal = (await findSessionPrincipal(token))!;
    expect(principal.userId).toBe(await userId(USERS.hhmcStaff));
    expect(principal.actingBy?.id).toBe(await userId(USERS.superAdmin));

    // The staff member's own access: HHMC only, as staff, without the super admin's powers.
    const ctx = await buildBusinessContext(principal, 'hhmc', 'live');
    const theirs = await buildBusinessContext(await userId(USERS.hhmcStaff), 'hhmc', 'live');
    expect(ctx.role).toBe('business_staff');
    expect([...ctx.permissions].sort()).toEqual([...theirs.permissions].sort());
    await expect(buildBusinessContext(principal, 'brss', 'live')).rejects.toThrow();
    const platform = await buildPlatformContext(principal);
    expect(platform.role).toBeNull();
    expect(platform.permissions.has('platform.users.manage')).toBe(false);

    // The server glue gives the same view.
    sessionToken = token;
    const { requireBusinessContext } = await import('@/server/session');
    expect((await requireBusinessContext('hhmc', 'live')).role).toBe('business_staff');

    // A change made meanwhile names both and keeps the super admin's id.
    const marker = `acting-test-${Date.now()}`;
    await getDb().transaction((tx) => logActivity(tx, ctx, { action: 'update', entityType: 'test', summary: marker }));
    const [row] = await asOwner((sql) => sql`select actor_user_id, actor_name from activity_log where summary = ${marker}`);
    expect(row.actor_user_id).toBe(await userId(USERS.superAdmin));
    expect(row.actor_name).toMatch(/\(acting: .+\)$/);

    // While acting, they cannot start acting as someone else.
    await expect(startActingAs(platform, token, await userId(USERS.brssAdmin))).rejects.toBeInstanceOf(ForbiddenError);

    await stopActingAs(token);
    expect((await findSessionPrincipal(token))!.userId).toBe(await userId(USERS.superAdmin));
    const superId = await userId(USERS.superAdmin);
    const stops = await asOwner((sql) => sql`select 1 from activity_log where action = 'act_as_stop' and actor_user_id = ${superId}`);
    expect(stops.length).toBeGreaterThan(0);
  });

  it('is refused for anyone but a super admin, and never as a super admin, oneself or a switched-off account', async () => {
    const token = await tokenFor(USERS.superAdmin);
    const own = await buildPlatformContext((await findSessionPrincipal(token))!);
    await expect(startActingAs(own, token, await userId(USERS.superAdmin))).rejects.toBeInstanceOf(ValidationError);

    const techToken = await tokenFor(USERS.tech);
    const tech = await buildPlatformContext((await findSessionPrincipal(techToken))!);
    await expect(startActingAs(tech, techToken, await userId(USERS.hhmcStaff))).rejects.toBeInstanceOf(ForbiddenError);

    // Another super admin.
    const [other] = await getDb()
      .insert(users)
      .values({ email: `second.super.${Date.now()}@sai.example`, name: 'Second Super', platformRole: 'super_admin' })
      .returning();
    await expect(startActingAs(own, token, other.id)).rejects.toBeInstanceOf(ValidationError);

    const [off] = await getDb()
      .insert(users)
      .values({ email: `off.${Date.now()}@sai.example`, name: 'Switched Off', isActive: false })
      .returning();
    await expect(startActingAs(own, token, off.id)).rejects.toBeInstanceOf(ValidationError);

    // A token of one person cannot be used to start acting for another person's context.
    await expect(startActingAs(own, techToken, await userId(USERS.hhmcStaff))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it(`ends by itself after ${ACTING_AS_MINUTES} minutes, and when the person is switched off`, async () => {
    const token = await tokenFor(USERS.superAdmin);
    const own = await buildPlatformContext((await findSessionPrincipal(token))!);
    const [person] = await getDb()
      .insert(users)
      .values({ email: `target.${Date.now()}@sai.example`, name: 'Target Person' })
      .returning();
    await startActingAs(own, token, person.id);
    expect((await findSessionPrincipal(token))!.userId).toBe(person.id);
    const later = new Date(Date.now() + (ACTING_AS_MINUTES + 1) * 60_000);
    expect((await findSessionPrincipal(token, later))!.userId).toBe(own.actor.id);

    await getDb().update(users).set({ isActive: false }).where(eq(users.id, person.id));
    expect((await findSessionPrincipal(token))!.userId).toBe(own.actor.id);
  });
});
