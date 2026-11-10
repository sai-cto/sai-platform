import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listBusinessActivity } from '@/core/audit/read';
import { withScope } from '@/core/db/scope';
import { findEntity } from '@/core/modules/registry';
import { getRecord } from '@/core/records/records';
import { Badge } from '@/ui/badge';
import { formatDateTime, formatValue, humanize } from '@/ui/format';
import { Card, PageHeader } from '@/ui/layout';
import { guarded, parseMode, requireBusinessContext } from '@/server/session';
import { ActivityTable } from '../../../../../_components/activity-table';

export const metadata: Metadata = { title: 'Record' };

const HIDDEN = new Set(['businessId', 'environment']);

export default async function RecordPage({
  params,
}: {
  params: Promise<{ business: string; mode: string; entity: string; id: string }>;
}) {
  const { business, mode, entity: entityKey, id } = await params;
  const ctx = await requireBusinessContext(business, parseMode(mode));
  const entity = findEntity(ctx.business.moduleKey, entityKey);
  if (!entity) notFound();
  const row = (await guarded(() =>
    withScope(ctx, 'business.data.read', (s) => getRecord(s, entity, id, 'include')),
  )) as Record<string, unknown>;
  const formats = new Map(entity.listColumns.map((c) => [c.key, c.format]));
  const history = ctx.permissions.has('business.activity.read')
    ? (await listBusinessActivity(ctx, { entityType: entity.key, entityId: id, limit: 100 })).rows
    : null;
  const back = `/console/${ctx.business.slug}/${ctx.environment}/data/${entity.key}`;

  return (
    <>
      <PageHeader
        title={entity.titleOf(row)}
        description={
          <Link href={back} className="hover:underline">
            ← {entity.labelPlural}
          </Link>
        }
        actions={
          row.archivedAt ? (
            <Badge tone="amber">Archived {formatDateTime(row.archivedAt as Date)}</Badge>
          ) : (
            <Badge tone="green">Active</Badge>
          )
        }
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Fields" flush>
          <dl className="divide-y divide-zinc-100 text-sm">
            {Object.entries(row)
              .filter(([key]) => !HIDDEN.has(key))
              .map(([key, value]) => (
                <div key={key} className="grid grid-cols-[10rem_1fr] gap-3 px-4 py-2">
                  <dt className="text-zinc-500">{humanize(key)}</dt>
                  <dd className="min-w-0 break-words text-zinc-900">
                    {formatValue(value, formats.get(key))}
                  </dd>
                </div>
              ))}
          </dl>
        </Card>
        {history ? (
          <Card title="History" description="Every change to this record" flush>
            <ActivityTable rows={history} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
