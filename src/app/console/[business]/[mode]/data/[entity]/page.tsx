import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { withScope } from '@/core/db/scope';
import { findEntity } from '@/core/modules/registry';
import { isPurgeEligible, listRecords, purgeEligibleAt } from '@/core/records/records';
import { getRetentionDays } from '@/core/settings/platform';
import { Badge } from '@/ui/badge';
import { buttonClass } from '@/ui/button';
import { cn } from '@/ui/cn';
import { ConfirmButton } from '@/ui/confirm-button';
import { formatDate, formatValue } from '@/ui/format';
import { Card, EmptyState, PageHeader, Table, Td, Th, inputClass } from '@/ui/layout';
import { Pagination } from '@/ui/pagination';
import {
  guarded,
  one,
  pageNumber,
  parseMode,
  requireBusinessContext,
} from '../../../../../_lib/session';
import { archiveRecordAction, purgeRecordAction, restoreRecordAction } from '../actions';

export const metadata: Metadata = { title: 'Data' };

const PAGE_SIZE = 50;
type Search = { q?: string; show?: string };

export default async function EntityPage({
  params,
  searchParams,
}: {
  params: Promise<{ business: string; mode: string; entity: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { business, mode, entity: entityKey } = await params;
  const raw = await searchParams;
  const search: Search = { q: one(raw.q) || undefined, show: one(raw.show) || undefined };
  const ctx = await requireBusinessContext(business, parseMode(mode));
  const entity = findEntity(ctx.business.moduleKey, entityKey);
  if (!entity) notFound();

  const show = search.show === 'archived' ? 'only' : search.show === 'all' ? 'include' : 'exclude';
  const page = pageNumber(raw.page);
  const { rows, total } = await guarded(() =>
    withScope(ctx, 'business.data.read', (s) =>
      listRecords(s, entity, {
        search: search.q,
        archived: show,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    ),
  );
  const retentionDays = await getRetentionDays();

  const canWrite = ctx.permissions.has(entity.writePermission);
  const canExport = ctx.permissions.has('business.data.export');
  const canPurge = ctx.permissions.has('business.data.purge');
  const base = `/console/${ctx.business.slug}/${ctx.environment}/data/${entity.key}`;
  const query = (overrides: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [key, value] of Object.entries({ q: search.q, show: search.show, ...overrides }))
      if (value) p.set(key, value);
    const text = p.toString();
    return text ? `?${text}` : '';
  };
  const bind = (action: typeof archiveRecordAction, id: string) =>
    action.bind(null, ctx.business.slug, ctx.environment, entity.key, id);

  return (
    <>
      <PageHeader
        title={entity.labelPlural}
        description={
          <Link
            href={`/console/${ctx.business.slug}/${ctx.environment}/data`}
            className="hover:underline"
          >
            ← All data
          </Link>
        }
        actions={
          canExport ? (
            <a href={`${base}/export${query({})}`} className={buttonClass()}>
              Export CSV
            </a>
          ) : null
        }
      />
      <Card flush>
        <form
          method="get"
          className="flex flex-wrap items-center gap-2 border-b border-zinc-200 p-3"
        >
          <label className="sr-only" htmlFor="q">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={search.q ?? ''}
            placeholder={`Search ${entity.labelPlural.toLowerCase()}`}
            className={cn(inputClass, 'sm:w-72')}
          />
          <label className="sr-only" htmlFor="show">
            Show
          </label>
          <select
            id="show"
            name="show"
            defaultValue={search.show ?? ''}
            className={cn(inputClass, 'sm:w-44')}
          >
            <option value="">Active</option>
            <option value="archived">Archived</option>
            <option value="all">Active + archived</option>
          </select>
          <button type="submit" className={buttonClass({ variant: 'primary' })}>
            Search
          </button>
        </form>

        {rows.length === 0 ? (
          <EmptyState
            title={
              search.q || search.show
                ? 'No records match'
                : `No ${entity.labelPlural.toLowerCase()} yet`
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                {entity.listColumns.map((c) => (
                  <Th key={c.key}>{c.label}</Th>
                ))}
                <Th>State</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const r = row as Record<string, unknown> & { id: string; archivedAt: Date | null };
                const eligibleAt = r.archivedAt
                  ? purgeEligibleAt(r.archivedAt, retentionDays)
                  : null;
                const purgeReady =
                  r.archivedAt !== null && isPurgeEligible(r.archivedAt, retentionDays);
                return (
                  <tr key={r.id} className="hover:bg-zinc-50">
                    {entity.listColumns.map((c, index) => (
                      <Td key={c.key} className="max-w-64 truncate">
                        {index === 0 ? (
                          <Link
                            href={`${base}/${r.id}`}
                            className="font-medium text-zinc-900 hover:underline"
                          >
                            {formatValue(r[c.key], c.format)}
                          </Link>
                        ) : (
                          formatValue(r[c.key], c.format)
                        )}
                      </Td>
                    ))}
                    <Td>
                      {r.archivedAt ? (
                        <Badge tone="amber">Archived {formatDate(r.archivedAt)}</Badge>
                      ) : (
                        <Badge tone="green">Active</Badge>
                      )}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <span className="inline-flex gap-1.5">
                        {canWrite && !r.archivedAt ? (
                          <ConfirmButton
                            action={bind(archiveRecordAction, r.id)}
                            confirmTitle={`Archive this ${entity.label}?`}
                            confirmBody="It will be hidden from day-to-day screens. You can restore it from here at any time."
                            confirmLabel="Archive"
                          >
                            Archive
                          </ConfirmButton>
                        ) : null}
                        {canWrite && r.archivedAt ? (
                          <ConfirmButton action={bind(restoreRecordAction, r.id)}>
                            Restore
                          </ConfirmButton>
                        ) : null}
                        {canPurge && r.archivedAt ? (
                          <ConfirmButton
                            action={bind(purgeRecordAction, r.id)}
                            variant="danger"
                            disabled={!purgeReady}
                            title={
                              purgeReady
                                ? undefined
                                : `Can be permanently deleted from ${formatDate(eligibleAt)} (${retentionDays} days after archiving)`
                            }
                            confirmTitle={`Permanently delete this ${entity.label}?`}
                            confirmBody="This cannot be undone. The record is removed for good; only a note that it was deleted stays in the activity log."
                            confirmLabel="Delete permanently"
                          >
                            Delete permanently
                          </ConfirmButton>
                        ) : null}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          hrefFor={(p) => `${base}${query({ page: String(p) })}`}
        />
      </Card>
      {canPurge ? (
        <p className="mt-3 text-xs text-zinc-500">
          Permanent delete is available to super admins only, for records archived more than{' '}
          {retentionDays} days ago.
        </p>
      ) : null}
    </>
  );
}
