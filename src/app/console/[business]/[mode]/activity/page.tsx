import type { Metadata } from 'next';
import { listBusinessActivity } from '@/core/audit/read';
import { Card, PageHeader } from '@/ui/layout';
import { Pagination } from '@/ui/pagination';
import { guarded, parseMode, requireBusinessContext } from '../../../../_lib/session';
import {
  ActivityFilters,
  activityHref,
  parseActivitySearch,
  type ActivitySearch,
} from '../../../_components/activity-filters';
import { ActivityTable } from '../../../_components/activity-table';

export const metadata: Metadata = { title: 'Activity log' };

export default async function BusinessActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ business: string; mode: string }>;
  searchParams: Promise<ActivitySearch>;
}) {
  const { business, mode } = await params;
  const search = await searchParams;
  const ctx = await requireBusinessContext(business, parseMode(mode));
  const { page, filters } = parseActivitySearch(search);
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
