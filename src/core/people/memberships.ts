/**
 * Who has access to one business (the People and access tab). Every change is logged
 * as a permission_change.
 *
 * Rules (docs/DECISIONS.md):
 *  - a business_admin manages admins and staff of their OWN business only;
 *  - a business must always keep at least one active admin;
 *  - someone with a platform role cannot also be a member;
 *  - staff permissions can only be chosen from the "grantable" actions in the matrix.
 */
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { asLive, logActivity } from '../audit/log';
import { getDb, type Tx } from '../db/client';
import { membershipPermissions, memberships, users } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';
import { getModule } from '../modules/registry';
import { authorize, grantableActions } from '../rbac/permissions';
import { BUSINESS_ROLES, type BusinessRole } from '../rbac/roles';
import type { BusinessContext } from '../tenancy/context';
import { lockAndCountAdmins, lockBusinessPeople, lockUserAccess } from './admins';
import { findOrCreateUser, newUserSchema } from './users';
import { isUuid } from '../ids';

/** Core permissions a new staff member starts with, on top of their module's defaults. */
export const DEFAULT_STAFF_GRANTS = ['customers.read', 'scheduling.read'];

export type Member = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: BusinessRole;
  isActive: boolean;
  grants: string[];
};

export async function listMembers(ctx: BusinessContext): Promise<Member[]> {
  authorize(ctx, 'business.people.read');
  const db = getDb();
  const rows = await db
    .select({
      membershipId: memberships.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      role: memberships.role,
      isActive: memberships.isActive,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.businessId, ctx.business.id))
    .orderBy(asc(memberships.role), asc(users.name));
  const grants = await db
    .select({
      membershipId: membershipPermissions.membershipId,
      key: membershipPermissions.permissionKey,
    })
    .from(membershipPermissions)
    .innerJoin(memberships, eq(memberships.id, membershipPermissions.membershipId))
    .where(eq(memberships.businessId, ctx.business.id));
  return rows.map((r) => ({
    ...r,
    grants: grants
      .filter((g) => g.membershipId === r.membershipId)
      .map((g) => g.key)
      .sort(),
  }));
}

/** Loads a membership ONLY if it belongs to the context's business. */
async function loadMembership(tx: Tx, ctx: BusinessContext, membershipId: string) {
  if (!isUuid(membershipId)) throw new NotFoundError();
  const [row] = await tx
    .select({ membership: memberships, user: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.id, membershipId), eq(memberships.businessId, ctx.business.id)))
    .limit(1);
  if (!row) throw new NotFoundError();
  return row;
}

async function currentGrants(tx: Tx, membershipId: string): Promise<string[]> {
  const rows = await tx
    .select({ key: membershipPermissions.permissionKey })
    .from(membershipPermissions)
    .where(eq(membershipPermissions.membershipId, membershipId));
  return rows.map((r) => r.key).sort();
}

function defaultGrants(ctx: BusinessContext): string[] {
  const allowed = new Set(grantableActions(ctx.business.moduleKey).map((a) => a.key));
  const mod = ctx.business.moduleKey ? getModule(ctx.business.moduleKey) : undefined;
  const wanted = [
    ...DEFAULT_STAFF_GRANTS,
    ...(mod?.permissions.filter((p) => p.defaultForStaff).map((p) => p.key) ?? []),
  ];
  return wanted.filter((key) => allowed.has(key));
}

async function replaceGrants(tx: Tx, membershipId: string, keys: string[]): Promise<void> {
  await tx
    .delete(membershipPermissions)
    .where(eq(membershipPermissions.membershipId, membershipId));
  if (keys.length > 0) {
    await tx
      .insert(membershipPermissions)
      .values(keys.map((permissionKey) => ({ membershipId, permissionKey })));
  }
}

const addMemberSchema = newUserSchema.extend({ role: z.enum(BUSINESS_ROLES) });

/** Gives a person a role in this business, creating their account if they have none. */
export async function addMember(ctx: BusinessContext, raw: unknown): Promise<string> {
  authorize(ctx, 'business.people.manage');
  const parsed = addMemberSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  const input = parsed.data;
  return getDb().transaction(async (tx) => {
    const found = await findOrCreateUser(tx, input);
    // Lock, then re-read: a platform role granted at this very moment must not slip past.
    await lockUserAccess(tx, found.user.id);
    await lockBusinessPeople(tx, ctx.business.id);
    const [user] = await tx.select().from(users).where(eq(users.id, found.user.id)).limit(1);
    const created = found.created;
    if (user.platformRole)
      throw new ValidationError(
        'This person has a platform role and already has access to every business.',
      );
    if (!user.isActive)
      throw new ValidationError('This account is deactivated. Ask the tech team to reactivate it.');
    const [existing] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, user.id), eq(memberships.businessId, ctx.business.id)))
      .limit(1);
    if (existing?.isActive)
      throw new ValidationError('This person already has access to this business.');
    let membershipId: string;
    if (existing) {
      await tx
        .update(memberships)
        .set({ role: input.role, isActive: true, updatedAt: new Date() })
        .where(eq(memberships.id, existing.id));
      membershipId = existing.id;
    } else {
      const [row] = await tx
        .insert(memberships)
        .values({ userId: user.id, businessId: ctx.business.id, role: input.role })
        .returning();
      membershipId = row.id;
    }
    const grants = input.role === 'business_staff' ? defaultGrants(ctx) : [];
    await replaceGrants(tx, membershipId, grants);
    if (created) {
      await logActivity(tx, asLive(ctx), {
        action: 'create',
        entityType: 'user',
        entityId: user.id,
        summary: `Created user ${user.name} (${user.email})`,
        after: { name: user.name, email: user.email },
      });
    }
    await logActivity(tx, asLive(ctx), {
      action: 'permission_change',
      entityType: 'membership',
      entityId: membershipId,
      summary: `Gave ${user.name} the role ${input.role} in ${ctx.business.name}`,
      before: existing ? { role: existing.role, isActive: existing.isActive } : null,
      after: { role: input.role, isActive: true, grants },
    });
    return membershipId;
  });
}

export async function changeMemberRole(
  ctx: BusinessContext,
  membershipId: string,
  role: BusinessRole,
): Promise<void> {
  authorize(ctx, 'business.people.manage');
  if (!BUSINESS_ROLES.includes(role)) throw new ValidationError('Unknown role.');
  await getDb().transaction(async (tx) => {
    await lockBusinessPeople(tx, ctx.business.id);
    const { membership, user } = await loadMembership(tx, ctx, membershipId);
    if (membership.role === role) return;
    // Only a USABLE admin (active membership, active account) counts towards the minimum.
    if (
      membership.role === 'business_admin' &&
      membership.isActive &&
      user.isActive &&
      (await lockAndCountAdmins(tx, ctx.business.id)) <= 1
    ) {
      throw new ValidationError(
        'This is the last admin of this business. Make someone else an admin first.',
      );
    }
    const previousGrants = await currentGrants(tx, membershipId);
    await tx
      .update(memberships)
      .set({ role, updatedAt: new Date() })
      .where(eq(memberships.id, membershipId));
    const grants = role === 'business_staff' ? defaultGrants(ctx) : [];
    await replaceGrants(tx, membershipId, grants);
    await logActivity(tx, asLive(ctx), {
      action: 'permission_change',
      entityType: 'membership',
      entityId: membershipId,
      summary: `Changed ${user.name} from ${membership.role} to ${role} in ${ctx.business.name}`,
      before: { role: membership.role, grants: previousGrants },
      after: { role, grants },
    });
  });
}

/** Removes someone's access to this business. Their account and history stay. */
export async function removeMember(ctx: BusinessContext, membershipId: string): Promise<void> {
  authorize(ctx, 'business.people.manage');
  await getDb().transaction(async (tx) => {
    await lockBusinessPeople(tx, ctx.business.id);
    const { membership, user } = await loadMembership(tx, ctx, membershipId);
    if (!membership.isActive) return;
    if (
      membership.role === 'business_admin' &&
      user.isActive &&
      (await lockAndCountAdmins(tx, ctx.business.id)) <= 1
    ) {
      throw new ValidationError('This is the last admin of this business and cannot be removed.');
    }
    const previousGrants = await currentGrants(tx, membershipId);
    await tx
      .update(memberships)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(memberships.id, membershipId));
    await replaceGrants(tx, membershipId, []);
    await logActivity(tx, asLive(ctx), {
      action: 'permission_change',
      entityType: 'membership',
      entityId: membershipId,
      summary: `Removed ${user.name} (${membership.role}) from ${ctx.business.name}`,
      before: { role: membership.role, isActive: true, grants: previousGrants },
      after: { isActive: false, grants: [] },
    });
  });
}

/** Sets exactly which grantable permissions a staff member holds. */
export async function setMemberPermissions(
  ctx: BusinessContext,
  membershipId: string,
  keys: string[],
): Promise<void> {
  authorize(ctx, 'business.people.manage');
  const allowed = new Set(grantableActions(ctx.business.moduleKey).map((a) => a.key));
  const wanted = [...new Set(keys)].sort();
  const invalid = wanted.filter((key) => !allowed.has(key));
  if (invalid.length > 0)
    throw new ValidationError(
      `These permissions cannot be granted to staff: ${invalid.join(', ')}`,
    );
  await getDb().transaction(async (tx) => {
    await lockBusinessPeople(tx, ctx.business.id);
    const { membership, user } = await loadMembership(tx, ctx, membershipId);
    if (membership.role !== 'business_staff')
      throw new ValidationError('Admins already hold every permission of their business.');
    if (!membership.isActive)
      throw new ValidationError('This person no longer has access to this business.');
    const current = await tx
      .select({ key: membershipPermissions.permissionKey })
      .from(membershipPermissions)
      .where(eq(membershipPermissions.membershipId, membershipId));
    const before = current.map((c) => c.key).sort();
    if (JSON.stringify(before) === JSON.stringify(wanted)) return;
    await replaceGrants(tx, membershipId, wanted);
    await logActivity(tx, asLive(ctx), {
      action: 'permission_change',
      entityType: 'membership',
      entityId: membershipId,
      summary: `Changed staff permissions of ${user.name} in ${ctx.business.name}`,
      before: { grants: before },
      after: { grants: wanted },
    });
  });
}
