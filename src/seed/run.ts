/**
 * Seeds a database: the 9 businesses, their module rows, the fake users and (optionally)
 * fake demo data in both live and sandbox. Safe to run repeatedly — it only adds what is
 * missing. Used by `npm run db:seed` and by the automated tests.
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import {
  businessModules,
  businesses,
  customers,
  membershipPermissions,
  memberships,
  platformSettings,
  users,
} from '@/core/db/schema';
import { withScope } from '@/core/db/scope';
import { DEFAULT_STAFF_GRANTS } from '@/core/people/memberships';
import { getModule } from '@/core/modules/registry';
import { grantableActions } from '@/core/rbac/permissions';
import { seedDemoData } from '@/core/sandbox/sandbox';
import { DEFAULT_RETENTION_DAYS } from '@/core/settings/platform';
import { systemContext } from '@/core/tenancy/system';
import { SEED_BUSINESSES } from './businesses';
import { SEED_USERS } from './users';

function defaultGrantsFor(moduleKey: string): string[] {
  const allowed = new Set(grantableActions(moduleKey).map((a) => a.key));
  const fromModule =
    getModule(moduleKey)
      ?.permissions.filter((p) => p.defaultForStaff)
      .map((p) => p.key) ?? [];
  return [...DEFAULT_STAFF_GRANTS, ...fromModule].filter((key) => allowed.has(key));
}

export async function seedAll(options: { demoData: boolean }): Promise<void> {
  const db = getDb();

  // Businesses and their module rows.
  const businessIds = new Map<string, string>();
  for (const [index, b] of SEED_BUSINESSES.entries()) {
    const [row] = await db
      .insert(businesses)
      .values({ ...b, secondaryColor: b.secondaryColor ?? null, sortOrder: index + 1 })
      .onConflictDoUpdate({
        target: businesses.slug,
        set: {
          name: b.name,
          description: b.description,
          accentColor: b.accentColor,
          secondaryColor: b.secondaryColor ?? null,
          sortOrder: index + 1,
        },
      })
      .returning();
    businessIds.set(b.slug, row.id);
    const mod = getModule(b.slug);
    await db
      .insert(businessModules)
      .values({
        businessId: row.id,
        moduleKey: b.slug,
        staffPortalEnabled: true,
        customerPortalEnabled: false,
        fieldPortalEnabled: false,
        settings: mod?.settings?.defaults ?? {},
      })
      .onConflictDoNothing();
  }

  await db
    .insert(platformSettings)
    .values({ key: 'retention_days', value: DEFAULT_RETENTION_DAYS })
    .onConflictDoNothing();

  // Users, memberships and staff grants.
  for (const u of SEED_USERS) {
    const [user] = await db
      .insert(users)
      .values({ email: u.email, name: u.name, platformRole: u.platformRole ?? null })
      .onConflictDoUpdate({ target: users.email, set: { name: u.name } })
      .returning();
    for (const m of u.memberships ?? []) {
      const businessId = businessIds.get(m.business);
      if (!businessId)
        throw new Error(`Seed user ${u.email} refers to unknown business ${m.business}`);
      const [existing] = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.userId, user.id), eq(memberships.businessId, businessId)))
        .limit(1);
      if (existing) continue;
      const [membership] = await db
        .insert(memberships)
        .values({ userId: user.id, businessId, role: m.role })
        .returning();
      const grants =
        m.role !== 'business_staff' || m.grants === 'none'
          ? []
          : Array.isArray(m.grants)
            ? m.grants
            : defaultGrantsFor(m.business);
      if (grants.length > 0) {
        await db
          .insert(membershipPermissions)
          .values(grants.map((permissionKey) => ({ membershipId: membership.id, permissionKey })));
      }
    }
  }

  if (!options.demoData) return;
  for (const b of SEED_BUSINESSES) {
    for (const environment of ['live', 'sandbox'] as const) {
      const ctx = await systemContext(b.slug, environment);
      await withScope(ctx, 'customers.read', async (s) => {
        const existing = await s.db.$count(customers, s.where(customers, 'include'));
        if (existing === 0) await seedDemoData(s);
      });
    }
  }
}
