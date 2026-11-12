/**
 * The request context: who is asking, for which business, in which environment, and what
 * they may do there. Every core function takes one. It is always built on the server from
 * the database — never from anything the browser sends except the session cookie and URL.
 */
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  businessModules,
  businesses,
  membershipPermissions,
  memberships,
  users,
} from '../db/schema';
import { ForbiddenError, NotFoundError, UnauthenticatedError } from '../errors';
import { resolveBusinessPermissions, resolvePlatformPermissions } from '../rbac/permissions';
import type { PlatformRole, Role } from '../rbac/roles';

export type Environment = 'live' | 'sandbox';

export type Actor = {
  /** Null only for the system actor used by seed scripts. */
  id: string | null;
  name: string;
  email: string;
  platformRole: PlatformRole | null;
  /** Set while a super admin acts as this person (src/core/auth/acting-as.ts). */
  actingBy?: { id: string; name: string };
};

export type BusinessRef = {
  id: string;
  slug: string;
  code: string;
  name: string;
  timeZone: string;
  accentColor: string;
  description: string;
  moduleKey: string | null;
};

/** For pages that are not about one business (home, Platform section, executive view). */
export type PlatformContext = {
  kind: 'platform';
  actor: Actor;
  /** The platform role, or null for people who only have business roles. */
  role: PlatformRole | null;
  permissions: ReadonlySet<string>;
};

/** For everything inside one business. */
export type BusinessContext = {
  kind: 'business';
  actor: Actor;
  /** "customer_link": someone without an account, holding a customer link (src/core/links). */
  role: Role | 'customer_link';
  business: BusinessRef;
  environment: Environment;
  permissions: ReadonlySet<string>;
  /** Present only for a customer link: the one record the link is about. */
  link?: { purpose: string; subjectId: string; expiresAt: Date };
};

export type AnyContext = PlatformContext | BusinessContext;

/** A user id, or the principal of a session (a super admin may be acting as this person). */
export type Who = string | { userId: string; actingBy?: { id: string; name: string } };

export async function loadActor(who: Who): Promise<Actor> {
  const userId = typeof who === 'string' ? who : who.userId;
  const actingBy = typeof who === 'string' ? undefined : who.actingBy;
  const [user] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !user.isActive) throw new UnauthenticatedError();
  if (actingBy)
    return { id: user.id, name: `${user.name} (acting: ${actingBy.name})`, email: user.email, platformRole: user.platformRole, actingBy };
  return { id: user.id, name: user.name, email: user.email, platformRole: user.platformRole };
}

export async function buildPlatformContext(who: Who): Promise<PlatformContext> {
  const actor = await loadActor(who);
  return {
    kind: 'platform',
    actor,
    role: actor.platformRole,
    permissions: resolvePlatformPermissions(actor.platformRole),
  };
}

async function loadBusiness(slug: string): Promise<BusinessRef | null> {
  const [row] = await getDb()
    .select({
      id: businesses.id,
      slug: businesses.slug,
      code: businesses.code,
      name: businesses.name,
      timeZone: businesses.timeZone,
      accentColor: businesses.accentColor,
      description: businesses.description,
      moduleKey: businessModules.moduleKey,
      moduleEnabled: businessModules.enabled,
    })
    .from(businesses)
    .leftJoin(businessModules, eq(businessModules.businessId, businesses.id))
    .where(eq(businesses.slug, slug))
    .limit(1);
  if (!row) return null;
  const { moduleEnabled, ...business } = row;
  return { ...business, moduleKey: moduleEnabled ? business.moduleKey : null };
}

/**
 * Builds the context for one business. Throws NotFoundError when the business does not
 * exist OR the user has no access to it — the caller cannot tell which, on purpose.
 */
export async function buildBusinessContext(
  who: Who,
  businessSlug: string,
  environment: Environment,
): Promise<BusinessContext> {
  const actor = await loadActor(who);
  const userId = actor.id as string;
  const business = await loadBusiness(businessSlug);
  if (!business) throw new NotFoundError();

  let membershipRole: 'business_admin' | 'business_staff' | null = null;
  let grants: string[] = [];
  if (!actor.platformRole) {
    const [membership] = await getDb()
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.businessId, business.id),
          eq(memberships.isActive, true),
        ),
      )
      .limit(1);
    if (!membership) throw new NotFoundError();
    membershipRole = membership.role;
    const rows = await getDb()
      .select({ key: membershipPermissions.permissionKey })
      .from(membershipPermissions)
      .where(eq(membershipPermissions.membershipId, membership.id));
    grants = rows.map((r) => r.key);
  }

  const resolved = resolveBusinessPermissions({
    platformRole: actor.platformRole,
    membershipRole,
    grants,
    moduleKey: business.moduleKey,
  });
  if (!resolved) throw new NotFoundError();
  if (environment === 'sandbox' && !resolved.permissions.has('business.sandbox.use')) {
    throw new ForbiddenError('business.sandbox.use');
  }
  return {
    kind: 'business',
    actor,
    role: resolved.role,
    business,
    environment,
    permissions: resolved.permissions,
  };
}

export type AccessibleBusiness = {
  id: string;
  slug: string;
  code: string;
  name: string;
  description: string;
  accentColor: string;
  secondaryColor: string | null;
  role: Role;
};

/** The businesses a user may open, in sidebar order. Platform roles see all of them. */
export async function listAccessibleBusinesses(userId: string): Promise<AccessibleBusiness[]> {
  const actor = await loadActor(userId);
  const all = await getDb().select().from(businesses).orderBy(asc(businesses.sortOrder));
  if (actor.platformRole) return all.map((b) => ({ ...b, role: actor.platformRole as Role }));
  const mine = await getDb()
    .select({ businessId: memberships.businessId, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.isActive, true)));
  const roleByBusiness = new Map(mine.map((m) => [m.businessId, m.role]));
  return all
    .filter((b) => roleByBusiness.has(b.id))
    .map((b) => ({ ...b, role: roleByBusiness.get(b.id) as Role }));
}
