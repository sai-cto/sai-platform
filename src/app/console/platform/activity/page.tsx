import type { Metadata } from 'next';
import { listPlatformActivity } from '@/core/audit/read';
import { listAccessibleBusinesses } from '@/core/tenancy/context';
import { Card, PageHeader } from '@/ui/layout';
import { Pagination } from '@/ui/pagination';
import { guarded, requirePlatformContext } from '@/server/session';
import {
  ActivityFilters,
  activityHref,
  parseActivitySearch,
  type ActivitySearch,
} from '../../_components/activity-filters';
import { ActivityTable } from '../../_components/activity-table';

export const metadata: Metadata = { title: 'Activity log' };

export default async function PlatformActivityPage({
  searchParams,
}: {
  searchParams: Promise<ActivitySearch>;
}) {
  const search = await searchParams;
  const ctx = await requirePlatformContext();
  const { page, filters } = parseActivitySearch(search);
  const { rows, total } = await guarded(() =>
    listPlatformActivity(ctx, { ...filters, businessId: search.business || undefined }),
  );
  const businesses = await listAccessibleBusinesses(ctx.actor.id as string);
  const codeOf = new Map(businesses.map((b) => [b.id, b.code]));
  return (
    <>
      <PageHeader
        title="Activity log"
        description="Every change on the platform, in every business, plus sign-ins and platform changes. Live and test mode. It cannot be edited."
      />
      <Card flush>
        <ActivityFilters
          search={search}
          businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
        />
        <ActivityTable
          rows={rows}
          businessLabel={(id) => (id ? (codeOf.get(id) ?? '—') : 'Platform')}
        />
        <Pagination
          page={page}
          pageSize={50}
          total={total}
          hrefFor={(p) => activityHref('/console/platform/activity', search, p)}
        />
      </Card>
    </>
  );
}
