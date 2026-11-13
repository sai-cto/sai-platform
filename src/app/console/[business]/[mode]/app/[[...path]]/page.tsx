import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isPortalAvailable } from '@/core/modules/config';
import { matchRoute } from '@/core/modules/portal';
import { getModule } from '@/core/modules/registry';
import { Card } from '@/ui/layout';
import { PortalHost } from '@/server/portal-host';
import { parseMode, requireBusinessContext } from '@/server/session';

/** The browser tab says which page this is: "<page title> · <business name>". */
export async function generateMetadata({ params }: { params: Promise<{ business: string; mode: string; path?: string[] }> }): Promise<Metadata> {
  const { business, mode, path } = await params;
  try {
    const ctx = await requireBusinessContext(business, parseMode(mode));
    const mod = ctx.business.moduleKey ? getModule(ctx.business.moduleKey) : undefined;
    const route = mod ? matchRoute(mod.portals.staff, path ?? [])?.route : undefined;
    const where = `${route?.title ?? 'App'} · ${ctx.business.name}`;
    return { title: ctx.environment === 'sandbox' ? `${where} (test mode)` : where };
  } catch {
    return { title: 'App' };
  }
}

/** The App tab: the business's staff portal, embedded in the console. */
export default async function StaffPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ business: string; mode: string; path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { business, mode, path } = await params;
  const ctx = await requireBusinessContext(business, parseMode(mode));
  if (!ctx.permissions.has('business.app.use')) notFound();
  const mod = ctx.business.moduleKey ? getModule(ctx.business.moduleKey) : undefined;

  if (!mod) {
    return (
      <Card title="No app yet">
        <p className="text-sm text-zinc-600">
          No module is registered for {ctx.business.name}, so there is no staff portal to show.
        </p>
      </Card>
    );
  }
  if (!(await isPortalAvailable(ctx.business.id, 'staff'))) {
    return (
      <Card title="Staff portal is switched off">
        <p className="text-sm text-zinc-600">The tech team can switch it back on in Settings.</p>
      </Card>
    );
  }
  return (
    <PortalHost
      ctx={ctx}
      portal={mod.portals.staff}
      segments={path ?? []}
      searchParams={await searchParams}
      basePath={`/console/${ctx.business.slug}/${ctx.environment}/app`}
    />
  );
}
