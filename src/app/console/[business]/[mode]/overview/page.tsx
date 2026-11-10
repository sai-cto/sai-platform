import type { Metadata } from 'next';
import { and, eq, gte } from 'drizzle-orm';
import {
  activityCount,
  createdCount,
  fillSeries,
  lastDays,
  revenueSeries,
  revenueSummary,
} from '@/core/analytics/analytics';
import { listBusinessActivity } from '@/core/audit/read';
import { appointments, customers } from '@/core/db/schema/tenant';
import { withScope } from '@/core/db/scope';
import { getModule, findEntity } from '@/core/modules/registry';
import { isPortalAvailable } from '@/core/modules/config';
import { Badge } from '@/ui/badge';
import { TrendChart } from '@/ui/charts';
import { formatMoneyShort, formatNumber } from '@/ui/format';
import { Card, Stat } from '@/ui/layout';
import { parseMode, requireBusinessContext } from '@/server/session';
import { ActivityTable } from '../../../_components/activity-table';

export const metadata: Metadata = { title: 'Overview' };

const STATUS_LABEL = {
  scaffold: 'Not built yet',
  in_development: 'In development',
  live: 'Live',
} as const;

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ business: string; mode: string }>;
}) {
  const { business, mode } = await params;
  const ctx = await requireBusinessContext(business, parseMode(mode));
  const can = (permission: string) => ctx.permissions.has(permission);
  const mod = ctx.business.moduleKey ? getModule(ctx.business.moduleKey) : undefined;
  const month = lastDays(30);
  const week = lastDays(7);

  // Each number is only loaded if this person may see the records behind it.
  const data = await withScope(ctx, 'business.overview.read', async (s) => {
    const workEntity = mod?.workItem
      ? findEntity(ctx.business.moduleKey, mod.workItem.entityKey)
      : undefined;
    return {
      revenue: can('payments.read') ? await revenueSummary(s, month) : null,
      revenueTrend: can('payments.read')
        ? fillSeries(await revenueSeries(s, month, 'day'), month, 'day', ctx.business.timeZone)
        : null,
      customerCount: can('customers.read')
        ? await s.db.$count(customers, s.where(customers))
        : null,
      upcoming: can('scheduling.read')
        ? await s.db.$count(
            appointments,
            and(
              s.where(appointments),
              gte(appointments.startsAt, new Date()),
              eq(appointments.status, 'confirmed'),
            ),
          )
        : null,
      workItems:
        workEntity && can(workEntity.readPermission)
          ? await createdCount(s, workEntity, month)
          : null,
      activity: can('business.activity.read') ? await activityCount(s, week) : null,
      widgets: await Promise.all(
        (mod?.widgets ?? [])
          .filter((w) => can(w.permission))
          .map(async (w) => ({ key: w.key, label: w.label, ...(await w.load(s)) })),
      ),
      health: mod?.healthChecks ? await mod.healthChecks(s) : [],
    };
  });
  const recent = can('business.activity.read')
    ? (await listBusinessActivity(ctx, { limit: 8 })).rows
    : null;
  const portals = {
    staff: await isPortalAvailable(ctx.business.id, 'staff'),
    customer: await isPortalAvailable(ctx.business.id, 'customer'),
    field: await isPortalAvailable(ctx.business.id, 'field'),
  };

  return (
    <div className="space-y-5">
      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {data.workItems !== null && mod?.workItem ? (
          <Stat
            label={`${mod.workItem.label} · last 30 days`}
            value={formatNumber(data.workItems)}
          />
        ) : null}
        {data.revenue ? (
          <Stat
            label="Revenue · last 30 days"
            value={formatMoneyShort(data.revenue.netCents)}
            hint={`${formatNumber(data.revenue.paymentCount)} payments${data.revenue.refundedCents ? ` · ${formatMoneyShort(data.revenue.refundedCents)} refunded` : ''}`}
          />
        ) : null}
        {data.customerCount !== null ? (
          <Stat label="Customers" value={formatNumber(data.customerCount)} />
        ) : null}
        {data.upcoming !== null ? (
          <Stat label="Upcoming confirmed appointments" value={formatNumber(data.upcoming)} />
        ) : null}
        {data.activity !== null ? (
          <Stat label="Changes · last 7 days" value={formatNumber(data.activity)} />
        ) : null}
        {data.widgets.map((w) => (
          <Stat key={w.key} label={w.label} value={w.value} hint={w.hint} />
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          {data.revenueTrend ? (
            <Card title="Revenue per day" description="Completed payments, last 30 days">
              <TrendChart data={data.revenueTrend} format="money" label="Revenue" />
            </Card>
          ) : null}
          {recent ? (
            <Card title="Recent activity" flush>
              <ActivityTable rows={recent} compact />
            </Card>
          ) : null}
        </div>

        <Card title="Module health">
          {mod ? (
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-zinc-500">Module</dt>
                <dd className="text-right font-medium">{mod.name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-zinc-500">Status</dt>
                <dd>
                  <Badge
                    tone={
                      mod.status === 'live'
                        ? 'green'
                        : mod.status === 'in_development'
                          ? 'blue'
                          : 'neutral'
                    }
                  >
                    {STATUS_LABEL[mod.status]}
                  </Badge>
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-zinc-500">Version</dt>
                <dd className="font-mono text-xs">{mod.version}</dd>
              </div>
              {(['staff', 'customer', 'field'] as const).map((p) => (
                <div key={p} className="flex justify-between gap-3">
                  <dt className="text-zinc-500 capitalize">{p} portal</dt>
                  <dd>
                    {portals[p] ? (
                      <Badge tone="green">On</Badge>
                    ) : (
                      <Badge>{mod.portals[p] ? 'Off' : 'Not built'}</Badge>
                    )}
                  </dd>
                </div>
              ))}
              {data.health.map((check) => (
                <div key={check.name} className="flex justify-between gap-3">
                  <dt className="text-zinc-500">{check.name}</dt>
                  <dd className="text-right">
                    <Badge tone={check.ok ? 'green' : 'red'}>{check.ok ? 'OK' : 'Problem'}</Badge>
                    <div className="mt-0.5 text-xs text-zinc-500">{check.detail}</div>
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-zinc-600">No module is registered for this business yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
