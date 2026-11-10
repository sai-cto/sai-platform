/**
 * Platform-wide user management (Platform → Users). Every change is logged.
 * Rules (docs/DECISIONS.md): tech may create users; only super_admin may grant or remove
 * the three platform roles; a person has a platform role OR business memberships, never both.
 */
import { and, asc, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { logActivity } from '../audit/log';
import { revokeAllSessions } from '../auth/session';
import { getDb, type Tx } from '../db/client';
import { businesses, memberships, users } from '../db/schema';
import { lockAndCountAdmins } from './admins';
import { NotFoundError, ValidationError } from '../errors';
import { authorize } from '../rbac/permissions';
import { PLATFORM_ROLES, type PlatformRole } from '../rbac/roles';
import type { PlatformContext } from '../tenancy/context';
import { isUuid } from '../ids';

export type UserWithAccess = {
  id: string;
  email: string;
  name: string;
  platformRole: PlatformRole | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  memberships: {
    id: string;
    businessId: string;
    businessCode: string;
    businessName: string;
    role: string;
    isActive: boolean;
  }[];
};

export async function listUsers(ctx: PlatformContext): Promise<UserWithAccess[]> {
  authorize(ctx, 'platform.users.read');
  const db = getDb();
  const allUsers = await db.select().from(users).orderBy(asc(users.name));
  const allMemberships = await db
    .select({
      id: memberships.id,
      userId: memberships.userId,
      businessId: memberships.businessId,
      businessCode: businesses.code,
      businessName: businesses.name,
      role: memberships.role,
      isActive: memberships.isActive,
    })
    .from(memberships)
    .innerJoin(businesses, eq(businesses.id, memberships.businessId))
    .orderBy(asc(businesses.sortOrder));
  return allUsers.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    platformRole: u.platformRole,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt,
    memberships: allMemberships.filter((m) => m.userId === u.id),
  }));
}

export const newUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(200),
});

/** Finds a user by email or creates one. Used by createUser and by adding a member. */
export async function findOrCreateUser(
  tx: Tx,
  input: z.infer<typeof newUserSchema>,
): Promise<{ user: typeof users.$inferSelect; created: boolean }> {
  const [existing] = await tx.select().from(users).where(eq(users.email, input.email)).limit(1);
  if (existing) return { user: existing, created: false };
  const [user] = await tx
    .insert(users)
    .values({ email: input.email, name: input.name })
    .returning();
  return { user, created: true };
}

export async function createUser(ctx: PlatformContext, raw: unknown): Promise<string> {
  authorize(ctx, 'platform.users.manage');
  const parsed = newUserSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  return getDb().transaction(async (tx) => {
    const { user, created } = await findOrCreateUser(tx, parsed.data);
    if (!created) throw new ValidationError('A user with that email already exists.');
    await logActivity(tx, ctx, {
      action: 'create',
      entityType: 'user',
      entityId: user.id,
      summary: `Created user ${user.name} (${user.email})`,
      after: { name: user.name, email: user.email },
    });
    return user.id;
  });
}

/** Counts active super admins, locking those rows so two simultaneous demotions cannot both pass. */
async function activeSuperAdminCount(tx: Tx): Promise<number> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.platformRole, 'super_admin'), eq(users.isActive, true)))
    .for('update');
  return rows.length;
}

async function loadUser(tx: Tx, userId: string) {
  if (!isUuid(userId)) throw new NotFoundError();
  const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new NotFoundError();
  return user;
}

/** Grant or remove a platform role. super_admin only. */
export async function setPlatformRole(
  ctx: PlatformContext,
  userId: string,
  role: PlatformRole | null,
): Promise<void> {
  authorize(ctx, 'platform.roles.grant');
  if (role !== null && !PLATFORM_ROLES.includes(role)) throw new ValidationError('Unknown role.');
  await getDb().transaction(async (tx) => {
    const user = await loadUser(tx, userId);
    if (user.platformRole === role) return;
    if (
      user.platformRole === 'super_admin' &&
      user.isActive &&
      (await activeSuperAdminCount(tx)) <= 1
    ) {
      throw new ValidationError(
        'This is the last super admin. Make someone else a super admin first.',
      );
    }
    if (role !== null) {
      const [active] = await tx
        .select({ n: count() })
        .from(memberships)
        .where(and(eq(memberships.userId, userId), eq(memberships.isActive, true)));
      if (active.n > 0) {
        throw new ValidationError(
          'This person has business roles. Remove those before granting a platform role.',
        );
      }
    }
    await tx.update(users).set({ platformRole: role }).where(eq(users.id, userId));
    await revokeAllSessions(tx, userId);
    await logActivity(tx, ctx, {
      action: 'permission_change',
      entityType: 'user',
      entityId: userId,
      summary: `Changed platform role of ${user.name} from ${user.platformRole ?? 'none'} to ${role ?? 'none'}`,
      before: { platformRole: user.platformRole },
      after: { platformRole: role },
    });
  });
}

/** Deactivate (or reactivate) an account. Deactivating signs the person out everywhere. */
export async function setUserActive(
  ctx: PlatformContext,
  userId: string,
  isActive: boolean,
): Promise<void> {
  authorize(ctx, 'platform.users.manage');
  await getDb().transaction(async (tx) => {
    const user = await loadUser(tx, userId);
    if (user.isActive === isActive) return;
    // Only someone who may grant platform roles may switch a platform-role account on or off.
    if (user.platformRole) authorize(ctx, 'platform.roles.grant');
    if (!isActive && user.id === ctx.actor.id)
      throw new ValidationError('You cannot deactivate your own account.');
    if (
      !isActive &&
      user.platformRole === 'super_admin' &&
      (await activeSuperAdminCount(tx)) <= 1
    ) {
      throw new ValidationError('This is the last super admin and cannot be deactivated.');
    }
    if (!isActive) {
      // A business must always keep one usable admin: refuse if this account is the only one.
      const adminOf = await tx
        .select({ businessId: memberships.businessId, name: businesses.name })
        .from(memberships)
        .innerJoin(businesses, eq(businesses.id, memberships.businessId))
        .where(
          and(
            eq(memberships.userId, userId),
            eq(memberships.role, 'business_admin'),
            eq(memberships.isActive, true),
          ),
        );
      for (const b of adminOf) {
        if ((await lockAndCountAdmins(tx, b.businessId)) <= 1) {
          throw new ValidationError(
            `${user.name} is the only admin of ${b.name}. Give that business another admin first.`,
          );
        }
      }
    }
    await tx.update(users).set({ isActive }).where(eq(users.id, userId));
    if (!isActive) await revokeAllSessions(tx, userId);
    await logActivity(tx, ctx, {
      action: 'permission_change',
      entityType: 'user',
      entityId: userId,
      summary: `${isActive ? 'Reactivated' : 'Deactivated'} ${user.name}`,
      before: { isActive: user.isActive },
      after: { isActive },
    });
  });
}
