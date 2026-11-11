/**
 * The hosted demo's accounts (DEMO_ACCOUNTS, see src/core/demo/demo.ts): users with a
 * membership in the demo business. Passwords are NOT stored: they stay in the environment.
 *   gm    → business admin of HHMC
 *   staff → business staff of HHMC with everything a move needs switched on
 *   tech  → the platform's tech role (Run due emails, settings)
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { businesses, membershipPermissions, memberships, users } from '@/core/db/schema';
import type { DemoAccount } from '@/core/demo/demo';
import { grantableActions } from '@/core/rbac/permissions';

export const DEMO_BUSINESS = 'hhmc';

export async function upsertDemoAccounts(accounts: DemoAccount[]): Promise<string[]> {
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
  return done;
}
