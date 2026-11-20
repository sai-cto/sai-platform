/**
 * What appears in the console's navigation for a given person. Built on the server from
 * their permissions, so the sidebar never shows a link the server would refuse.
 */
import { adminInApp } from '@/core/modules/portal';
import { PLATFORM_ROLES } from '@/core/rbac/roles';
import type { BusinessContext, PlatformContext } from '@/core/tenancy/context';

export type NavIcon =
  'home' | 'chart' | 'users' | 'boxes' | 'flag' | 'activity' | 'upload' | 'heart' | 'settings' | 'chat';
export type NavLink = { label: string; href: string; icon: NavIcon; permission?: string };

const PLATFORM_LINKS: NavLink[] = [
  {
    label: 'Users and roles',
    href: '/console/platform/users',
    icon: 'users',
    permission: 'platform.users.read',
  },
  {
    label: 'Module registry',
    href: '/console/platform/modules',
    icon: 'boxes',
    permission: 'platform.modules.read',
  },
  {
    label: 'Feature flags',
    href: '/console/platform/flags',
    icon: 'flag',
    permission: 'platform.flags.read',
  },
  {
    label: 'Activity log',
    href: '/console/platform/activity',
    icon: 'activity',
    permission: 'platform.activity.read',
  },
  {
    label: 'Data imports',
    href: '/console/platform/imports',
    icon: 'upload',
    permission: 'platform.imports.read',
  },
  {
    label: 'Feedback',
    href: '/console/platform/feedback',
    icon: 'chat',
    permission: 'platform.feedback.read',
  },
  {
    label: 'System health',
    href: '/console/platform/health',
    icon: 'heart',
    permission: 'platform.health.read',
  },
  {
    label: 'Platform settings',
    href: '/console/platform/settings',
    icon: 'settings',
    permission: 'platform.settings.read',
  },
];

export function topLinks(ctx: PlatformContext, businessCount = 2): NavLink[] {
  // Someone who works in one business only has nothing to choose on Home: no Home link.
  const links: NavLink[] = ctx.role || businessCount !== 1 ? [{ label: 'Home', href: '/console', icon: 'home' }] : [];
  if (ctx.permissions.has('executive.dashboard.read')) {
    links.push({ label: 'Executive view', href: '/console/executive', icon: 'chart' });
  }
  return links;
}

export function platformLinks(ctx: PlatformContext): NavLink[] {
  return PLATFORM_LINKS.filter((link) => !link.permission || ctx.permissions.has(link.permission));
}

export type BusinessTab = {
  key: 'overview' | 'app' | 'people' | 'data' | 'activity' | 'settings';
  label: string;
  /** Tabs that show live or sandbox data live under /[mode]/. */
  usesMode: boolean;
  permission: string;
  /** Keyboard shortcut: press "g" then this letter. */
  shortcut: string;
};

const BUSINESS_TABS: BusinessTab[] = [
  {
    key: 'overview',
    label: 'Overview',
    usesMode: true,
    permission: 'business.overview.read',
    shortcut: 'o',
  },
  { key: 'app', label: 'App', usesMode: true, permission: 'business.app.use', shortcut: 'a' },
  {
    key: 'people',
    label: 'People and access',
    usesMode: false,
    permission: 'business.people.read',
    shortcut: 'p',
  },
  { key: 'data', label: 'Data', usesMode: true, permission: 'business.data.read', shortcut: 'd' },
  {
    key: 'activity',
    label: 'Activity log',
    usesMode: true,
    permission: 'business.activity.read',
    shortcut: 'l',
  },
  {
    // The console's own settings for a business (module switches, portals, module settings):
    // the tech team's. A business's day-to-day settings live in its app (App › Settings).
    key: 'settings',
    label: 'Module settings',
    usesMode: false,
    permission: 'business.settings.read',
    shortcut: 's',
  },
];

/** Tech team, super admin, executive: the console's platform tabs. Everyone else works in the app. */
export function isPlatformPerson(ctx: Pick<BusinessContext, 'role'>): boolean {
  return (PLATFORM_ROLES as readonly string[]).includes(ctx.role);
}

/**
 * The tabs of a business. Business admins and staff see only the App (no tab bar at all): the
 * Overview, Data, Activity log, People and access and Module settings tabs are the tech team's.
 * The Live / Test mode switch is the header's (the old "Test mode" tab duplicated it; its page,
 * with the sandbox reset, stays at /console/<business>/test-mode).
 */
export function businessTabs(ctx: BusinessContext): BusinessTab[] {
  const allowed = BUSINESS_TABS.filter((tab) => ctx.permissions.has(tab.permission));
  // One set of tabs, inside the app (src/server/app-sections.tsx), for everyone.
  if (runsAdminInApp(ctx)) return allowed.filter((tab) => tab.key === 'app');
  return isPlatformPerson(ctx) ? allowed : allowed.filter((tab) => tab.key === 'app');
}

/** Where /console/<business> lands: the App when there is one, else the first tab. */
/**
 * Where /console/<business> goes: the App when this person can open its home page (a new hire
 * with no grants yet cannot), otherwise the Overview, otherwise their first tab.
 */
export function homeTab(ctx: BusinessContext, appHomeOpen = true): BusinessTab | undefined {
  const tabs = businessTabs(ctx);
  const app = appHomeOpen ? tabs.find((t) => t.key === 'app') : undefined;
  const overview = ctx.permissions.has('business.overview.read') ? BUSINESS_TABS.find((t) => t.key === 'overview') : undefined;
  return app ?? overview ?? tabs.find((t) => t.key !== 'app') ?? tabs[0];
}

export function tabHref(slug: string, mode: 'live' | 'sandbox', tab: BusinessTab): string {
  return tab.usesMode ? `/console/${slug}/${mode}/${tab.key}` : `/console/${slug}/${tab.key}`;
}

/** The business's module runs its admin inside the app (ModuleManifest.adminInApp). */
export function runsAdminInApp(ctx: Pick<BusinessContext, 'business'>): boolean {
  return adminInApp(ctx.business.moduleKey);
}
