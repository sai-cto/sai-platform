import type { Metadata } from 'next';
import Link from 'next/link';
import { EXECUTIVE_RANGES, executiveDashboard } from '@/core/analytics/executive';
import { BarList, Sparkline, TrendChart } from '@/ui/charts';
import { cn } from '@/ui/cn';
import { formatMoneyShort, formatNumber } from '@/ui/format';
import { Card, PageHeader, Stat, Table, Td, Th } from '@/ui/layout';
import { Monogram } from '@/ui/monogram';
import { guarded, one, requirePlatformContext } from '@/server/session';

export const metadata: Metadata = { title: 'Executive view' };

const RANGE_LABEL: Record<number, string> = { 30: '30 days', 90: '90 days', 365: '12 months' };

export default async function ExecutivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePlatformContext();
  const requested = Number(one((await searchParams).days));
  const days = (EXECUTIVE_RANGES as readonly number[]).includes(requested) ? requested : 30;
  const data = await guarded(() => executiveDashboard(ctx, days));
  const period = `last ${RANGE_LABEL[days]}`;
  const bucketWord = data.bucket === 'day' ? 'day' : data.bucket === 'week' ? 'week' : 'month';

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-6">
      <PageHeader
        title="Executive view"
        description={`All ${data.rows.length} businesses side by side. Live data only; read-only.`}
        actions={
          <div
            role="group"
            aria-label="Period"
            className="flex rounded-md border border-zinc-300 bg-zinc-50 p-0.5 text-xs font-medium"
          >
            {EXECUTIVE_RANGES.map((d) => (
              <Link
                key={d}
                href={`/console/executive?days=${d}`}
                aria-current={d === days ? 'true' : undefined}
                className={cn(
                  'rounded px-2.5 py-1 text-zinc-600 hover:text-zinc-900',
                  d === days && 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200',
                )}
              >
                {RANGE_LABEL[d]}
              </Link>
            ))}
          </div>
        }
      />

      <section aria-label="All-SAI totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={`All-SAI revenue · ${period}`}
          value={formatMoneyShort(data.totals.revenueCents)}
          hint={
            data.totals.refundedCents
              ? `after ${formatMoneyShort(data.totals.refundedCents)} refunded`
              : 'no refunds'
          }
        />
        <Stat label={`Payments · ${period}`} value={formatNumber(data.totals.payments)} />
        <Stat
          label={`Work items · ${period}`}
          value={formatNumber(data.totals.workItems)}
          hint="from businesses whose module tracks them"
        />
        <Stat label={`Changes logged · ${period}`} value={formatNumber(data.totals.activity)} />
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <Card
          title="All-SAI revenue"
          description={`Completed payments per ${bucketWord}, ${period}`}
          className="lg:col-span-3"
        >
          <TrendChart data={data.totalTrend} format="money" label="Revenue" height={220} />
        </Card>
        <Card title="Revenue by business" description={period} className="lg:col-span-2">
          <BarList
            format="money"
            items={[...data.rows]
              .sort((a, b) => b.revenueCents - a.revenueCents)
              .map((r) => ({
                label: r.name,
                value: r.revenueCents,
                prefix: <Monogram code={r.code} color={r.accentColor} size="sm" />,
              }))}
          />
        </Card>
      </div>

      <Card
        title="By business"
        description={`Revenue is net of refunds. Trend: revenue per ${bucketWord}.`}
        className="mt-5"
        flush
      >
        <Table>
          <thead>
            <tr>
              <Th className="w-full">Business</Th>
              <Th className="text-right">Revenue</Th>
              <Th className="text-right">Payments</Th>
              <Th className="text-right">Work items</Th>
              <Th className="text-right">Activity</Th>
              <Th>Trend</Th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.businessId} className="hover:bg-zinc-50">
                <Td>
                  <Link
                    href={`/console/${r.slug}`}
                    className="flex items-center gap-2 font-medium text-zinc-900 hover:underline"
                  >
                    <Monogram code={r.code} color={r.accentColor} size="sm" />
                    <span className="whitespace-nowrap">{r.name}</span>
                  </Link>
                </Td>
                <Td className="text-right tabular-nums">{formatMoneyShort(r.revenueCents)}</Td>
                <Td className="text-right tabular-nums">{formatNumber(r.payments)}</Td>
                <Td className="text-right tabular-nums">
                  {r.workItems === null ? (
                    <span
                      className="text-zinc-400"
                      title="This business's module does not count work items yet"
                    >
                      —
                    </span>
                  ) : (
                    formatNumber(r.workItems)
                  )}
                </Td>
                <Td className="text-right tabular-nums">{formatNumber(r.activity)}</Td>
                <Td>
                  <Sparkline values={r.trend} />
                </Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-zinc-50 font-semibold">
              <Td>All SAI</Td>
              <Td className="text-right tabular-nums">
                {formatMoneyShort(data.totals.revenueCents)}
              </Td>
              <Td className="text-right tabular-nums">{formatNumber(data.totals.payments)}</Td>
              <Td className="text-right tabular-nums">{formatNumber(data.totals.workItems)}</Td>
              <Td className="text-right tabular-nums">{formatNumber(data.totals.activity)}</Td>
              <Td />
            </tr>
          </tfoot>
        </Table>
      </Card>
    </div>
  );
}
