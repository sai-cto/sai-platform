/** Finding the page for a path inside a module's portal. */
import type { BusinessContext } from '../tenancy/context';
import type { PortalDef, RouteDef } from './contract';
import { getModule } from './registry';

/**
 * Matches path segments against a portal's routes. "orders/:id" matches ["orders", "42"]
 * and captures { id: "42" }. Returns null when nothing matches.
 */
export function matchRoute(
  portal: PortalDef,
  segments: string[],
): { route: RouteDef; params: Record<string, string> } | null {
  for (const route of portal.routes) {
    const parts = route.path === '' ? [] : route.path.split('/');
    if (parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const matches = parts.every((part, index) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(segments[index]);
        return true;
      }
      return part === segments[index];
    });
    if (matches) return { route, params };
  }
  return null;
}

/** The ModuleManifest.adminInApp switch for a business's module. */
export function adminInApp(moduleKey: string | null): boolean {
  return Boolean(moduleKey && getModule(moduleKey)?.adminInApp);
}

export type AdminLink = { key: 'data' | 'activity' | 'business-settings' | 'people'; label: string; href: string };

type AdminCtx = Pick<BusinessContext, 'business' | 'environment' | 'permissions'>;

/** The console's Data and Activity log, as sections of an adminInApp module's app. */
export function adminSectionLinks(ctx: AdminCtx): AdminLink[] {
  if (!adminInApp(ctx.business.moduleKey)) return [];
  const base = `/console/${ctx.business.slug}/${ctx.environment}`;
  return [
    { key: 'data' as const, label: 'Data', href: `${base}/data`, permission: 'business.data.read' },
    { key: 'activity' as const, label: 'Activity log', href: `${base}/activity`, permission: 'business.activity.read' },
  ]
    .filter((l) => ctx.permissions.has(l.permission))
    .map(({ key, label, href }) => ({ key, label, href }));
}

/** The module settings and People and access, as areas of an adminInApp module's Settings. */
export function adminSettingsLinks(ctx: AdminCtx): AdminLink[] {
  if (!adminInApp(ctx.business.moduleKey)) return [];
  const base = `/console/${ctx.business.slug}`;
  return [
    { key: 'business-settings' as const, label: 'Business settings', href: `${base}/settings`, permission: 'business.settings.read' },
    { key: 'people' as const, label: 'People and access', href: `${base}/people`, permission: 'business.people.read' },
  ]
    .filter((l) => ctx.permissions.has(l.permission))
    .map(({ key, label, href }) => ({ key, label, href }));
}
