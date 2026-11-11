import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getModule } from '@/core/modules/registry';
import { PortalHost } from '@/server/portal-host';
import { requireLinkContext } from '@/server/session';

export const metadata: Metadata = { title: 'Your link', robots: { index: false, follow: false } };

/**
 * Host for customer links (src/core/links): signed, expiring, single-purpose links for people
 * without an account, e.g. reviewing and signing an estimate. The token is the only key: it
 * names the business, live or test mode, the purpose and the one record. Anything wrong with
 * it is "not found". The page itself comes from the module's customer portal.
 */
export default async function CustomerLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token, path } = await params;
  const ctx = await requireLinkContext(token);
  const portal = ctx.business.moduleKey
    ? getModule(ctx.business.moduleKey)?.portals.customer
    : undefined;
  if (!portal) notFound();
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      {ctx.environment === 'sandbox' ? (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Test link: this is fake data in test mode. Nothing here is real.
        </p>
      ) : null}
      <PortalHost
        ctx={ctx}
        portal={portal}
        segments={path ?? []}
        searchParams={await searchParams}
        basePath={`/l/${token}`}
      />
    </main>
  );
}
