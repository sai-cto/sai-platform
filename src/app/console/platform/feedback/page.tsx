import type { Metadata } from 'next';
import Link from 'next/link';
import { listFeedback } from '@/core/feedback/feedback';
import { Badge } from '@/ui/badge';
import { ConfirmButton } from '@/ui/confirm-button';
import { formatDateTime } from '@/ui/format';
import { Card, EmptyState, PageHeader } from '@/ui/layout';
import { listAccessibleBusinesses } from '@/core/tenancy/context';
import { setFeedbackStatusAction } from '@/server/feedback-actions';
import { guarded, one, requirePlatformContext } from '@/server/session';

export const metadata: Metadata = { title: 'Feedback' };

const FILTERS = [
  { key: 'new', label: 'New' },
  { key: 'read', label: 'Read' },
  { key: 'done', label: 'Done' },
  { key: 'all', label: 'All' },
] as const;

/** What people sent with "Send feedback", from every app. Tech team and super admins. */
export default async function FeedbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePlatformContext();
  const raw = one((await searchParams).status);
  const status = (FILTERS.some((f) => f.key === raw) ? raw : 'new') as (typeof FILTERS)[number]['key'];
  const rows = await guarded(() => listFeedback(ctx, { status }));
  const slugOf = new Map((await listAccessibleBusinesses(ctx.actor.id as string)).map((b) => [b.id, b.slug]));
  return (
    <>
      <PageHeader title="Feedback" description="What people sent from the apps with the Send feedback button, newest first. Mark a message read, or done once acted on." />
      <nav aria-label="Filter" className="mb-3 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/console/platform/feedback?status=${f.key}`}
            aria-current={f.key === status ? 'page' : undefined}
            className={`flex min-h-11 items-center rounded-md px-3 text-sm ${f.key === status ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      <Card flush>
        {rows.length === 0 ? (
          <EmptyState title={status === 'new' ? 'No new feedback' : 'Nothing here'}>
            Messages sent with the Send feedback button on any app page appear here.
          </EmptyState>
        ) : (
          <ul data-testid="feedback-list" className="divide-y divide-zinc-100">
            {rows.map((f) => {
              const slug = slugOf.get(f.businessId) ?? '';
              return (
                <li key={f.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span className="font-medium text-zinc-900">{f.authorName || 'Someone'}</span>
                    {f.authorEmail ? <span>{f.authorEmail}</span> : null}
                    <span>{formatDateTime(f.createdAt)}</span>
                    <span>{f.businessName}</span>
                    {f.environment === 'sandbox' ? <Badge>Test mode</Badge> : null}
                    <Badge>{f.status}</Badge>
                  </div>
                  <p className="mt-1 text-sm whitespace-pre-wrap text-zinc-900">{f.message}</p>
                  {f.pageUrl.startsWith('/console/') && !f.pageUrl.startsWith('//') ? (
                    <Link href={f.pageUrl} className="mt-1 inline-block text-xs break-all text-zinc-600 underline hover:text-zinc-900">
                      {f.pageUrl}
                    </Link>
                  ) : null}
                  {slug ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {f.status !== 'read' ? <ConfirmButton action={setFeedbackStatusAction.bind(null, slug, f.environment, f.id, 'read')} size="sm">Mark read</ConfirmButton> : null}
                      {f.status !== 'done' ? <ConfirmButton action={setFeedbackStatusAction.bind(null, slug, f.environment, f.id, 'done')} size="sm">Mark done</ConfirmButton> : null}
                      {f.status !== 'new' ? <ConfirmButton action={setFeedbackStatusAction.bind(null, slug, f.environment, f.id, 'new')} size="sm" variant="ghost">Mark new</ConfirmButton> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
