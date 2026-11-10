/**
 * What appears in the console's navigation for a given person. Built on the server from
 * their permissions, so the sidebar never shows a link the server would refuse.
 */
import type { BusinessContext, PlatformContext } from '@/core/tenancy/context';

export type NavIcon = 'home' | 'chart' | 'users' | 'boxes' | 'flag' | 'activity' | 'upload' | 'heart' | 'settings';
export type NavLink = { label: string; href: string; icon: NavIcon; permission?: string };

const PLATFORM_LINKS: NavLink[] = [
  { label: 'Users and roles', href: '/console/platform/users', icon: 'users', permission: 'platform.users.read' },
  { label: 'Module registry', href: '/console/platform/modules', icon: 'boxes', permission: 'platform.modules.read' },
  { label: 'Feature flags', href: '/console/platform/flags', icon: 'flag', permission: 'platform.flags.read' },
  { label: 'Activity log', href: '/console/platform/activity', icon: 'activity', permission: 'platform.activity.read' },
  { label: 'Data imports', href: '/console/platform/imports', icon: 'upload', permission: 'platform.imports.read' },
  { label: 'System health', href: '/console/platform/health', icon: 'heart', permission: 'platform.health.read' },
  { label: 'Platform settings', href: '/console/platform/settings', icon: 'settings', permission: 'platform.settings.read' },
];

export function topLinks(ctx: PlatformContext): NavLink[] {
  const links: NavLink[] = [{ label: 'Home', href: '/console', icon: 'home' }];
  if (ctx.permissions.has('executive.dashboard.read')) {
    links.push({ label: 'Executive view', href: '/console/executive', icon: 'chart' });
  }
  return links;
}

export function platformLinks(ctx: PlatformContext): NavLink[] {
  return PLATFORM_LINKS.filter((link) => !link.permission || ctx.permissions.has(link.permission));
}

export type BusinessTab = {
  key: 'overview' | 'app' | 'people' | 'data' | 'activity' | 'settings' | 'test-mode';
  label: string;
  /** Tabs that show live or sandbox data live under /[mode]/. */
  usesMode: boolean;
  permission: string;
  /** Keyboard shortcut: press "g" then this letter. */
  shortcut: string;
};

const BUSINESS_TABS: BusinessTab[] = [
  { key: 'overview', label: 'Overview', usesMode: true, permission: 'business.overview.read', shortcut: 'o' },
  { key: 'app', label: 'App', usesMode: true, permission: 'business.app.use', shortcut: 'a' },
  { key: 'people', label: 'People and access', usesMode: false, permission: 'business.people.read', shortcut: 'p' },
  { key: 'data', label: 'Data', usesMode: true, permission: 'business.data.read', shortcut: 'd' },
  { key: 'activity', label: 'Activity log', usesMode: true, permission: 'business.activity.read', shortcut: 'l' },
  { key: 'settings', label: 'Settings', usesMode: false, permission: 'business.settings.read', shortcut: 's' },
  { key: 'test-mode', label: 'Test mode', usesMode: false, permission: 'business.sandbox.use', shortcut: 't' },
];

export function businessTabs(ctx: BusinessContext): BusinessTab[] {
  return BUSINESS_TABS.filter((tab) => ctx.permissions.has(tab.permission));
}

export function tabHref(slug: string, mode: 'live' | 'sandbox', tab: BusinessTab): string {
  return tab.usesMode ? `/console/${slug}/${mode}/${tab.key}` : `/console/${slug}/${tab.key}`;
}
