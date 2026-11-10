import type { Metadata } from 'next';
import { listBusinessActivity } from '@/core/audit/read';
import { Card, PageHeader } from '@/ui/layout';
import { Pagination } from '@/ui/pagination';
import { guarded, parseMode, requireBusinessContext } from '@/server/session';
import {
  ActivityFilters,
  activityHref,
  parseActivitySearch,
} from '../../../_components/activity-filters';
import { ActivityTable } from '../../../_components/activity-table';

export const metadata: Metadata = { title: 'Activity log' };

export default async function BusinessActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ business: string; mode: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { business, mode } = await params;
  const raw = await searchParams;
  const ctx = await requireBusinessContext(business, parseMode(mode));
  const { search, page, filters } = parseActivitySearch(raw, ctx.business.timeZone);
  const { rows, total } = await guarded(() => listBusinessActivity(ctx, filters));
  const base = `/console/${ctx.business.slug}/${ctx.environment}/activity`;
  return (
    <>
      <PageHeader
        title="Activity log"
        description="Everything that was created, changed, archived, restored or deleted here, and who did it. This log cannot be edited."
      />
      <Card flush>
        <ActivityFilters search={search} />
        <ActivityTable rows={rows} />
        <Pagination
          page={page}
          pageSize={50}
          total={total}
          hrefFor={(p) => activityHref(base, search, p)}
        />
      </Card>
    </>
  );
}
