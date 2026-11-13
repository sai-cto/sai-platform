/**
 * Renders a page of a module's portal. All three portal types (staff, customer, field) go
 * through here, so they share one login, one context and one data layer.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import type { PortalDef, PortalPageProps } from '@/core/modules/contract';
import { matchRoute } from '@/core/modules/portal';
import type { BusinessContext } from '@/core/tenancy/context';
import { cn } from '@/ui/cn';
import { guarded } from './session';

export async function PortalHost({
  ctx,
  portal,
  segments,
  searchParams,
  basePath,
}: {
  ctx: BusinessContext;
  portal: PortalDef;
  segments: string[];
  searchParams: Record<string, string | string[] | undefined>;
  basePath: string;
}) {
  const match = matchRoute(portal, segments);
  if (!match || !ctx.permissions.has(match.route.permission)) notFound();
  const Page = match.route.component;
  const flatSearch: PortalPageProps['searchParams'] = Object.fromEntries(
    Object.entries(searchParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  const current = segments.join('/');
  const nav = portal.nav.filter((item) => {
    const route = portal.routes.find((r) => r.path === item.path);
    return !route || ctx.permissions.has(route.permission);
  });

  // Module pages are async server components, i.e. plain async functions. Calling the page
  // here (instead of leaving it for React to render later) means a page that finds nothing,
  // or is refused by the core, becomes a normal "not found" instead of a server error.
  const props: PortalPageProps = { ctx, params: match.params, searchParams: flatSearch, basePath };
  const content = await guarded(async () =>
    (Page as (p: PortalPageProps) => ReactNode | Promise<ReactNode>)(props),
  );

  // Which nav item is "here": the one whose path starts the current path. A page that belongs
  // to no item (for example a detail page) lights up the portal's home item.
  const matches = (item: { path: string }) =>
    item.path !== '' && (current === item.path || current.startsWith(`${item.path}/`));
  const activePath = nav.find(matches)?.path ?? '';
  const section = nav.find((item) => item.path === activePath);
  // Where you are, always: Business › Section › this page (the page only when it is deeper).
  const crumbs: { label: string; href?: string }[] = [
    { label: ctx.business.name, href: basePath },
    ...(section && section.path !== '' ? [{ label: section.label, href: `${basePath}/${section.path}` }] : []),
    ...(current !== activePath ? [{ label: match.route.title }] : []),
  ];

  return (
    <div>
      {crumbs.length > 1 ? (
        <nav aria-label="Breadcrumb" data-testid="breadcrumbs" className="mb-2 text-xs text-zinc-500">
          <ol className="flex flex-wrap items-center gap-1">
            {crumbs.map((c, i) => (
              <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                {i > 0 ? <span aria-hidden="true">›</span> : null}
                {c.href && i < crumbs.length - 1 ? (
                  <Link href={c.href} className="hover:text-zinc-900 hover:underline">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-zinc-700">
                    {c.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      {nav.length > 1 ? (
        <nav
          aria-label="App sections"
          className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-1"
        >
          {nav.map((item) => {
            const active = item.path === activePath;
            return (
              <Link
                key={item.path}
                href={item.path ? `${basePath}/${item.path}` : basePath}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'shrink-0 rounded-md px-3 py-1.5 text-[13px] whitespace-nowrap text-zinc-600 hover:text-zinc-900',
                  active && 'bg-white font-medium text-zinc-900 shadow-sm ring-1 ring-zinc-200',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
      {content}
    </div>
  );
}
