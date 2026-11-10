import type { Metadata } from 'next';
import Link from 'next/link';
import { listPlatformActivity } from '@/core/audit/read';
import { ROLE_LABELS } from '@/core/rbac/roles';
import { listAccessibleBusinesses } from '@/core/tenancy/context';
import { Badge } from '@/ui/badge';
import { Card, EmptyState, PageHeader } from '@/ui/layout';
import { Monogram } from '@/ui/monogram';
import { requirePlatformContext } from '../_lib/session';
import { ActivityTable } from './_components/activity-table';

export const metadata: Metadata = { title: 'Home' };

export default async function ConsoleHome() {
  const ctx = await requirePlatformContext();
  const businesses = await listAccessibleBusinesses(ctx.actor.id as string);
  const recent = ctx.permissions.has('platform.activity.read')
    ? (await listPlatformActivity(ctx, { limit: 8 })).rows
    : null;
  const nameOf = new Map(businesses.map((b) => [b.id, b.code]));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-6">
      <PageHeader
        title={`Hello, ${ctx.actor.name.split(' ')[0]}`}
        description={
          businesses.length === 1
            ? 'Your business is below.'
            : `You can open ${businesses.length} businesses.`
        }
      />
      {businesses.length === 0 ? (
        <Card>
          <EmptyState title="You have not been given access to a business yet">
            Ask a business admin or the tech team to add you.
          </EmptyState>
        </Card>
      ) : (
        <ul data-testid="home-businesses" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {businesses.map((b) => (
            <li key={b.id}>
              <Link
                href={`/console/${b.slug}`}
                className="flex h-full gap-3 rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-400 focus-visible:outline-2 focus-visible:outline-zinc-900"
              >
                <Monogram code={b.code} color={b.accentColor} size="lg" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-zinc-900">
                    {b.name}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-zinc-500">
                    {b.description}
                  </span>
                  <Badge className="mt-2">{ROLE_LABELS[b.role]}</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {recent ? (
        <Card
          title="Latest activity across the platform"
          className="mt-6"
          flush
          actions={
            <Link
              href="/console/platform/activity"
              className="text-xs text-zinc-500 hover:text-zinc-900 hover:underline"
            >
              Open the full log
            </Link>
          }
        >
          <ActivityTable
            rows={recent}
            compact
            businessLabel={(id) => (id ? (nameOf.get(id) ?? '—') : 'Platform')}
          />
        </Card>
      ) : null}

      <p className="mt-6 text-xs text-zinc-500">
        Keyboard: <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1">⌘K</kbd> or{' '}
        <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1">Ctrl K</kbd> go to anything
        · <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1">[</kbd>{' '}
        <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1">]</kbd> previous / next
        business · <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1">g</kbd> then{' '}
        <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1">o</kbd>{' '}
        <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1">a</kbd>{' '}
        <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1">p</kbd>{' '}
        <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1">d</kbd>{' '}
        <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1">l</kbd>{' '}
        <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1">s</kbd>{' '}
        <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1">t</kbd> jump to a tab of the
        current business.
      </p>
    </div>
  );
}
