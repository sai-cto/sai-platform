/**
 * The sections bar of a business's staff app, and the frame that shows the console's Data,
 * Activity log, Settings and People and access pages as sections of the app when its module
 * runs its admin there (ModuleManifest.adminInApp; managers' feedback round 1, Nov 2026).
 */
import type { ReactNode } from 'react';
import type { NavItem, PortalDef } from '@/core/modules/contract';
import { adminSectionLinks, adminSettingsLinks, type AdminLink } from '@/core/modules/portal';
import { getModule } from '@/core/modules/registry';
import type { BusinessContext } from '@/core/tenancy/context';
import { AppSectionsNav, SectionAreasNav, type SectionLink } from '@/ui/section-nav';

/** The app's own nav items the person may open (a hidden route = a hidden link). */
export function visibleNav(ctx: BusinessContext, portal: PortalDef): NavItem[] {
  return portal.nav.filter((item) => {
    const route = portal.routes.find((r) => r.path === item.path);
    return !route || ctx.permissions.has(route.permission);
  });
}

/**
 * The staff app's sections: its own, with Data and Activity log before Settings when the
 * module runs its admin in the app. `active` is a nav path of the app or an admin key.
 */
export function staffSectionLinks(ctx: BusinessContext, active: { path?: string; admin?: AdminLink['key'] }): SectionLink[] {
  const portal = ctx.business.moduleKey ? getModule(ctx.business.moduleKey)?.portals.staff : undefined;
  if (!portal) return [];
  const appBase = `/console/${ctx.business.slug}/${ctx.environment}/app`;
  const own = visibleNav(ctx, portal).map((item) => ({
    label: item.label,
    href: item.path ? `${appBase}/${item.path}` : appBase,
    // Settings stays lit on the console's Business settings and People and access pages.
    active: item.path === active.path || (item.path === 'settings' && (active.admin === 'business-settings' || active.admin === 'people')),
  }));
  const admin = adminSectionLinks(ctx).map((l) => ({ label: l.label, href: l.href, active: l.key === active.admin }));
  const at = own.findIndex((l) => l.href === `${appBase}/settings`);
  return at === -1 ? [...own, ...admin] : [...own.slice(0, at), ...admin, ...own.slice(at)];
}

/**
 * A console page shown as a section of the app. For any other business it renders the page
 * as it always was.
 */
export function AdminAppFrame({ ctx, active, padded = false, children }: { ctx: BusinessContext; active: AdminLink['key']; padded?: boolean; children: ReactNode }) {
  const settings = adminSettingsLinks(ctx);
  if (!adminSectionLinks(ctx).length && !settings.length) return <>{children}</>;
  const portal = ctx.business.moduleKey ? getModule(ctx.business.moduleKey)?.portals.staff : undefined;
  const settingsAreas = active === 'business-settings' || active === 'people' ? appSettingsAreas(ctx, { admin: active }) : [];
  return (
    <div className={portal && padded ? 'mx-auto max-w-6xl px-4 pt-5 lg:px-6' : undefined}>
      <AppSectionsNav links={staffSectionLinks(ctx, { admin: active })} />
      {settingsAreas.length ? <SectionAreasNav label="Settings areas" links={settingsAreas} /> : null}
      {children}
    </div>
  );
}

/**
 * The areas of the app's Settings: the module's own (ModuleManifest.adminInApp areas, given by
 * the module page) followed by Business settings and People and access.
 */
export function appSettingsAreas(
  ctx: BusinessContext,
  active: { area?: string; admin?: AdminLink['key'] },
  own: { key: string; label: string }[] = getModule(ctx.business.moduleKey ?? '')?.settingsAreas ?? [],
): SectionLink[] {
  const appBase = `/console/${ctx.business.slug}/${ctx.environment}/app`;
  return [
    ...own.map((a) => ({ label: a.label, href: `${appBase}/settings?area=${a.key}`, active: a.key === active.area })),
    ...adminSettingsLinks(ctx).map((l) => ({ label: l.label, href: l.href, active: l.key === active.admin })),
  ];
}
