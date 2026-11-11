/** Dashboard (prompt "Dashboard widgets"; ref §3.1, §8): the sales and money snapshot. */
import Link from 'next/link';
import { withScope } from '@/core/db/scope';
import type { PortalPageProps } from '@/core/modules/contract';
import { can } from '@/core/rbac/permissions';
import { BarList } from '@/ui/charts';
import { formatMoney, formatNumber } from '@/ui/format';
import { Card, EmptyState, PageHeader, Stat } from '@/ui/layout';
import { P } from '../permissions';
import { bookedRevenue, estimateFunnel, invoiceTotals, leadsThisMonth, medianLeadToEstimateHours, upcomingMoves } from '../services/dashboard';

const monthLabel = (bucket: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(new Date(`${bucket}T00:00:00Z`));

function hoursText(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

export async function DashboardPage({ ctx, basePath }: PortalPageProps) {
  const seesLeads = can(ctx, P.leadsRead);
  const seesInvoices = can(ctx, P.invoicesRead);
  const data = await withScope(ctx, P.jobsRead, async (s) => ({
    leads: seesLeads ? await leadsThisMonth(s) : null,
    funnel: await estimateFunnel(s),
    revenue: await bookedRevenue(s, 6),
    invoices: seesInvoices ? await invoiceTotals(s) : null,
    median: seesLeads ? await medianLeadToEstimateHours(s) : null,
    moves: await upcomingMoves(s),
  }));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="This month's leads and estimates, booked revenue, and money still to collect."
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {data.leads ? (
          <Stat
            label="Leads this month"
            value={formatNumber(data.leads.leads)}
            hint={`${data.leads.converted} converted · ${data.leads.conversionPercent}% conversion`}
          />
        ) : null}
        <Stat
          label="Estimates sent this month"
          value={formatNumber(data.funnel.sent)}
          hint={`${data.funnel.viewed} viewed · ${data.funnel.signed} signed`}
        />
        <Stat label="Booked moves · next 7 days" value={formatNumber(data.moves)} hint={<Link className="hover:underline" href={`${basePath}/schedule`}>Open the schedule</Link>} />
        {data.leads ? (
          <Stat label="Lead to first estimate" value={hoursText(data.median)} hint="Median, leads from the last 90 days" />
        ) : null}
      </div>

      {data.invoices ? (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Open invoices" value={formatMoney(data.invoices.openCents)} hint="Balance still to collect" />
          <Stat
            label="Past due"
            value={formatMoney(data.invoices.pastDueCents)}
            hint={<Link className="hover:underline" href={`${basePath}/invoices?status=past_due`}>{`${data.invoices.pastDueCount} invoice${data.invoices.pastDueCount === 1 ? '' : 's'}`}</Link>}
          />
          <Stat label="Paid this month" value={formatMoney(data.invoices.paidThisMonthCents)} />
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Booked revenue by month" description={`Signed estimate totals of jobs booked · ${formatMoney(data.revenue.totalCents)} in 6 months`}>
          <BarList format="money" items={data.revenue.byMonth.map((m) => ({ label: monthLabel(m.bucket), value: m.value }))} />
        </Card>
        <Card title="Booked revenue by source" description="Last 6 months">
          {data.revenue.bySource.length ? (
            <BarList format="money" items={data.revenue.bySource} />
          ) : (
            <EmptyState title="No booked jobs yet" />
          )}
        </Card>
      </div>
    </>
  );
}
