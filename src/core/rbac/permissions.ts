/**
 * Turning the matrix into answers: "what may this person do here?"
 */
import { ForbiddenError } from '../errors';
import { getModule } from '../modules/registry';
import { CORE_ACTIONS, RECORD_READ, RECORD_WRITE, type ActionDef } from './actions';
import type { BusinessRole, PlatformRole, Role } from './roles';

/** A module's own permissions, turned into matrix rows with the standard record rules. */
function moduleActions(moduleKey: string | null): ActionDef[] {
  const mod = moduleKey ? getModule(moduleKey) : undefined;
  if (!mod) return [];
  return mod.permissions.map((p) => ({
    key: p.key,
    label: p.label,
    scope: 'business' as const,
    kind: p.kind,
    allow: p.kind === 'read' ? RECORD_READ : RECORD_WRITE,
  }));
}

export function platformActions(): ActionDef[] {
  return CORE_ACTIONS.filter((a) => a.scope === 'platform');
}

/** Every action that exists inside one business: the core's plus its module's. */
export function businessActions(moduleKey: string | null): ActionDef[] {
  return [...CORE_ACTIONS.filter((a) => a.scope === 'business'), ...moduleActions(moduleKey)];
}

/** Actions a business_admin may switch on for an individual staff member. */
export function grantableActions(moduleKey: string | null): ActionDef[] {
  return businessActions(moduleKey).filter((a) => a.allow.business_staff === 'grantable');
}

export function resolvePlatformPermissions(platformRole: PlatformRole | null): Set<string> {
  if (!platformRole) return new Set();
  return new Set(
    platformActions()
      .filter((a) => a.allow[platformRole] === true)
      .map((a) => a.key),
  );
}

/**
 * The permissions someone holds inside one business.
 * A platform role wins if present (A5: a person has a platform role OR memberships, not both).
 */
export function resolveBusinessPermissions(input: {
  platformRole: PlatformRole | null;
  membershipRole: BusinessRole | null;
  grants: string[];
  moduleKey: string | null;
}): { role: Role; permissions: Set<string> } | null {
  const role: Role | null = input.platformRole ?? input.membershipRole;
  if (!role) return null;
  const granted = new Set(input.grants);
  const permissions = new Set<string>();
  for (const a of businessActions(input.moduleKey)) {
    const allow = a.allow[role];
    if (allow === true || (allow === 'grantable' && granted.has(a.key))) permissions.add(a.key);
  }
  return { role, permissions };
}

type HasPermissions = { permissions: ReadonlySet<string> };

export function can(ctx: HasPermissions, action: string): boolean {
  return ctx.permissions.has(action);
}

/** Throws ForbiddenError unless the context holds the action. Call this on the server, always. */
export function authorize(ctx: HasPermissions, action: string): void {
  if (!ctx.permissions.has(action)) throw new ForbiddenError(action);
}
