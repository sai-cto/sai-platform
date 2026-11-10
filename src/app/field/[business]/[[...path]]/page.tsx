import { notFound } from 'next/navigation';
import { isPortalAvailable } from '@/core/modules/config';
import { getModule } from '@/core/modules/registry';
import { PortalHost } from '@/server/portal-host';
import { requireBusinessContext } from '@/server/session';

/**
 * Host for a business's field portal. It answers "not found" until BOTH are true:
 *   1. the module defines `portals.field` in its manifest, and
 *   2. the field portal toggle is on in the business's Settings.
 * No module has one yet. How crews sign in is still to be decided (docs/HANDOFF.md); today it
 * uses the same login and roles as the console.
 */
export default async function FieldPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ business: string; path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { business, path } = await params;
  const ctx = await requireBusinessContext(business, 'live');
  const portal = ctx.business.moduleKey
    ? getModule(ctx.business.moduleKey)?.portals.field
    : undefined;
  if (!portal || !(await isPortalAvailable(ctx.business.id, 'field'))) notFound();
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <PortalHost
        ctx={ctx}
        portal={portal}
        segments={path ?? []}
        searchParams={await searchParams}
        basePath={`/field/${ctx.business.slug}`}
      />
    </main>
  );
}
