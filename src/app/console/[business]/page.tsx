import { redirect } from 'next/navigation';
import { matchRoute } from '@/core/modules/portal';
import { getModule } from '@/core/modules/registry';
import { requireBusinessContext } from '@/server/session';
import { homeTab, tabHref } from '../_lib/nav';

/** /console/<business> → the App's home page (or the first page this person can open), in live mode. */
export default async function BusinessIndex({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
  const ctx = await requireBusinessContext(business, 'live');
  const mod = ctx.business.moduleKey ? getModule(ctx.business.moduleKey) : undefined;
  const home = mod ? matchRoute(mod.portals.staff, [])?.route : undefined;
  const appHomeOpen = !mod || !home?.permission || ctx.permissions.has(home.permission);
  const first = homeTab(ctx, appHomeOpen);
  redirect(first ? tabHref(ctx.business.slug, 'live', first) : '/console');
}
