/**
 * The hosted demo's accounts (DEMO_ACCOUNTS, see src/core/demo/demo.ts): users with a
 * membership in the demo business. Passwords are NOT stored: they stay in the environment.
 *   gm    → business admin of HHMC
 *   staff → business staff of HHMC with everything a move needs switched on
 *   tech  → the platform's tech role (Run due emails, settings)
 */
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { businesses, membershipPermissions, memberships, sessions, users } from '@/core/db/schema';
import { SEED_USERS } from './users';
import type { DemoAccount } from '@/core/demo/demo';
import type { PilotAccount } from '@/core/demo/pilot';
import { grantableActions } from '@/core/rbac/permissions';
import { getModule } from '@/core/modules/registry';
import { DEFAULT_STAFF_GRANTS } from '@/core/people/memberships';

export const DEMO_BUSINESS = 'hhmc';

export async function upsertDemoAccounts(
  accounts: DemoAccount[],
  options: { switchOffOthers?: boolean } = {},
): Promise<string[]> {
  const db = getDb();
  const [business] = await db.select().from(businesses).where(eq(businesses.slug, DEMO_BUSINESS)).limit(1);
  if (!business) throw new Error(`Business ${DEMO_BUSINESS} is not seeded.`);
  // Staff get every permission a business admin may grant (the whole move, start to finish).
  const staffGrants = grantableActions(DEMO_BUSINESS).map((a) => a.key);
  const done: string[] = [];
  for (const account of accounts) {
    const [user] = await db
      .insert(users)
      .values({ email: account.email, name: account.name, platformRole: account.role === 'tech' ? 'tech' : null, isActive: true })
      .onConflictDoUpdate({ target: users.email, set: { name: account.name, isActive: true, platformRole: account.role === 'tech' ? 'tech' : null } })
      .returning();
    if (account.role !== 'tech') {
      const role = account.role === 'gm' ? 'business_admin' : 'business_staff';
      const [existing] = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.userId, user.id), eq(memberships.businessId, business.id)))
        .limit(1);
      const membership = existing
        ? (await db.update(memberships).set({ role, isActive: true }).where(eq(memberships.id, existing.id)).returning())[0]
        : (await db.insert(memberships).values({ userId: user.id, businessId: business.id, role }).returning())[0];
      await db.delete(membershipPermissions).where(eq(membershipPermissions.membershipId, membership.id));
      if (role === 'business_staff')
        await db.insert(membershipPermissions).values(staffGrants.map((permissionKey) => ({ membershipId: membership.id, permissionKey })));
    }
    done.push(`${account.email} (${account.role})`);
  }
  // Anyone who is neither a demo account now nor one of the fixed fake users is switched off
  // and signed out (a manager removed from DEMO_ACCOUNTS loses access at the next deploy).
  if (!options.switchOffOthers) return done;
  const keep = new Set([...accounts.map((a) => a.email), ...SEED_USERS.map((u) => u.email)]);
  for (const user of await db.select().from(users).where(eq(users.isActive, true))) {
    if (keep.has(user.email)) continue;
    // One step: switched off AND signed out (sessions are revoked: the app role may not delete them).
    await db.transaction(async (tx) => {
      await tx.update(users).set({ isActive: false }).where(eq(users.id, user.id));
      await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
    });
    done.push(`${user.email} switched off (no longer in DEMO_ACCOUNTS)`);
  }
  return done;
}

/**
 * The pilot's accounts (PILOT_ACCOUNTS, src/core/demo/pilot.ts). People sign in with their
 * Microsoft account, matched by email: nothing secret is stored. Existing accounts are only
 * updated; nobody is switched off here (on a real-data site, People and access does that).
 */
export async function upsertPilotAccounts(accounts: PilotAccount[]): Promise<string[]> {
  const db = getDb();
  const [business] = await db.select().from(businesses).where(eq(businesses.slug, DEMO_BUSINESS)).limit(1);
  if (!business) throw new Error(`Business ${DEMO_BUSINESS} is not seeded.`);
  const done: string[] = [];
  for (const account of accounts) {
    // An account that already exists is never changed here: its role, access and status are
    // managed in the console (and logged there). This list only creates people the first time.
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, account.email)).limit(1);
    if (existing) {
      done.push(`${account.email} (already exists: unchanged)`);
      continue;
    }
    const platformRole = account.role === 'cto' ? 'super_admin' : account.role === 'tech' ? 'tech' : null;
    const [user] = await db
      .insert(users)
      .values({ email: account.email, name: account.name, platformRole, isActive: true })
      .returning();
    if (account.role === 'gm' || account.role === 'staff') {
      const role = account.role === 'gm' ? 'business_admin' : 'business_staff';
      const [membership] = await db.insert(memberships).values({ userId: user.id, businessId: business.id, role }).returning();
      if (role === 'business_staff') {
        // The same starting access as someone added in People and access.
        const allowed = new Set(grantableActions(DEMO_BUSINESS).map((a) => a.key));
        const mod = getModule(DEMO_BUSINESS);
        const grants = [
          ...DEFAULT_STAFF_GRANTS,
          ...(mod?.permissions.filter((p) => p.defaultForStaff).map((p) => p.key) ?? []),
        ].filter((key) => allowed.has(key));
        if (grants.length > 0)
          await db.insert(membershipPermissions).values(grants.map((permissionKey) => ({ membershipId: membership.id, permissionKey })));
      }
    }
    done.push(`${account.email} (${account.role}, created)`);
  }
  return done;
}
