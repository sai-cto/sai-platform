/**
 * Dashboard (prompt "Dashboard widgets"; ref §3.1, §8): how we are doing over a date range.
 * Every number is a link: it opens, on this page (?list=…), the people and jobs behind it.
 * The range and the open list live in the query (?from=yyyy-mm-dd&to=yyyy-mm-dd, ?range=all).
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { withScope } from '@/core/db/scope';
import type { PortalPageProps } from '@/core/modules/contract';
import { can } from '@/core/rbac/permissions';
import { Badge } from '@/ui/badge';
import { buttonClass } from '@/ui/button';
import { cn } from '@/ui/cn';
import { formatMoney, formatNumber } from '@/ui/format';
import { Card, EmptyState, Field, PageHeader, Stat, Table, Td, Th, inputClass } from '@/ui/layout';
import { P } from '../permissions';
import { LEAD_SOURCES } from '../schema';
import {
  DASHBOARD_LISTS,
  RANGE_PRESET_LABELS,
  RANGE_PRESETS,
  dashboardList,
  dashboardSummary,
  mayOpenList,
  parseRange,
  presetRange,
  rangeQuery,
  type DashboardList,
  type DashboardRange,
  type DashboardRow,
  type ListFilters,
  type PaidState,
} from '../services/dashboard';
import { EstimateStatusBadge, InvoiceStatusBadge, LeadStatusBadge, StageBadge, formatDay, hrefWith } from './parts';
import { formatMonth } from '@/ui/format';

const monthLabel = (month: string) => formatMonth(month, 'short');

function hoursText(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

function rangeText(range: DashboardRange): string {
  if (range.from && range.to) return `${formatDay(range.from)} – ${formatDay(range.to)}`;
  if (range.from) return `from ${formatDay(range.from)}`;
  if (range.to) return `up to ${formatDay(range.to)}`;
  return 'all time';
}

const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;

/** One headline number; the whole card links to its list. */
function NumberCard({ label, value, hint, href, active }: { label: string; value: string; hint?: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'group block min-w-0 rounded-lg border bg-white px-4 py-3 transition-colors hover:border-zinc-400',
        active ? 'border-zinc-900 ring-1 ring-zinc-900' : 'border-zinc-200',
      )}
    >
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold tracking-tight text-zinc-900 tabular-nums underline-offset-4 group-hover:underline">
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-zinc-500">{hint}</div> : null}
    </Link>
  );
}

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className="mb-5 min-w-0">
      <h2 className="mb-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">{title}</h2>
      <div className={cn('grid gap-3', className ?? 'grid-cols-2 lg:grid-cols-4')}>{children}</div>
    </section>
  );
}

/** A number in a breakdown table: a link to its list, or a plain zero. */
function NumLink({ href, value }: { href: string; value: number | null }) {
  return value ? (
    <Link className="tabular-nums hover:underline" href={href}>
      {formatNumber(value)}
    </Link>
  ) : (
    <span className="text-zinc-400 tabular-nums">0</span>
  );
}

function MoneyLink({ href, value }: { href: string; value: number | null }) {
  if (value === null) return null;
  return value ? (
    <Link className="tabular-nums hover:underline" href={href}>
      {formatMoney(value)}
    </Link>
  ) : (
    <span className="text-zinc-400 tabular-nums">{formatMoney(0)}</span>
  );
}

const PAID: Record<PaidState, { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' }> = {
  paid: { label: 'Paid', tone: 'green' },
  partly_paid: { label: 'Partly paid', tone: 'amber' },
  unpaid: { label: 'Unpaid', tone: 'red' },
  none: { label: 'No price agreed', tone: 'neutral' },
};

function StatusCell({ status }: { status: DashboardRow['status'] }) {
  switch (status.kind) {
    case 'lead':
      return <LeadStatusBadge status={status.value} />;
    case 'stage':
      return <StageBadge stage={status.value} />;
    case 'estimate':
      return <EstimateStatusBadge status={status.value} />;
    case 'invoice':
      return <InvoiceStatusBadge status={status.value} pastDue={status.pastDue} />;
    case 'payment':
      return <span className="whitespace-nowrap">{status.label}</span>;
  }
}

function recordHref(basePath: string, href: DashboardRow['href']): string {
  // A payment with no work request opens the payment itself (console Data tab).
  if (href.kind === 'payment') return `${basePath.replace(/\/app$/, '')}/data/core.payment/${href.id}`;
  const section = href.kind === 'lead' ? 'leads' : href.kind === 'job' ? 'jobs' : 'invoices';
  return `${basePath}/${section}/${href.id}`;
}

export async function DashboardPage({ ctx, searchParams, basePath }: PortalPageProps) {
  const now = new Date();
  const tz = ctx.business.timeZone;
  const { range, preset } = parseRange(searchParams, now, tz);
  const requested = DASHBOARD_LISTS.find((l) => l === searchParams.list);
  const list: DashboardList | null = requested && mayOpenList(ctx, requested) ? requested : null;
  const filters: ListFilters = {
    source: (LEAD_SOURCES as readonly string[]).includes(searchParams.source ?? '') ? searchParams.source : undefined,
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.month ?? '') ? searchParams.month : undefined,
  };
  const seesMoney = can(ctx, P.invoicesRead);

  const { summary, detail } = await withScope(ctx, P.jobsRead, async (s) => ({
    summary: await dashboardSummary(s, range, now),
    detail: list ? await dashboardList(s, list, range, filters, now) : null,
  }));

  const q = rangeQuery(range);
  /** The dashboard with one list open (same range). */
  const listHref = (l: DashboardList, extra: ListFilters = {}) => `${hrefWith(basePath, q, { list: l, source: extra.source, month: extra.month })}#records`;
  const isOpen = (l: DashboardList) => list === l && !filters.source && !filters.month;
  const rangeLabel = rangeText(range);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`How we're doing, ${preset && preset !== 'all' ? `${RANGE_PRESET_LABELS[preset].toLowerCase()} (${rangeLabel})` : rangeLabel}. Click any number to see the people and jobs behind it.`}
      />
      <p data-testid="how-to-test-banner" className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 print:hidden">
        Testing the new app? Read <Link href={`${basePath}/how-to-test`} className="font-medium underline">How to test</Link>: what to try, how to use test mode, and how to send feedback.
      </p>

      <div className="mb-5 flex min-w-0 flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 lg:flex-row lg:items-end lg:justify-between">
        <nav aria-label="Date range" className="flex flex-wrap gap-1">
          {RANGE_PRESETS.map((p) => (
            <Link
              key={p}
              href={hrefWith(basePath, {}, { ...rangeQuery(presetRange(p, now, tz)), list: list ?? undefined })}
              aria-current={p === preset ? 'page' : undefined}
              className={buttonClass({ variant: p === preset ? 'primary' : 'ghost', size: 'sm' })}
            >
              {RANGE_PRESET_LABELS[p]}
            </Link>
          ))}
        </nav>
        <form action={basePath} method="get" className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
          {list ? <input type="hidden" name="list" value={list} /> : null}
          <Field label="From" htmlFor="dashboard-from">
            <input id="dashboard-from" type="date" name="from" defaultValue={range.from ?? ''} className={inputClass} />
          </Field>
          <Field label="To" htmlFor="dashboard-to">
            <input id="dashboard-to" type="date" name="to" defaultValue={range.to ?? ''} className={inputClass} />
          </Field>
          <button type="submit" className={buttonClass({ variant: 'secondary', size: 'md' })}>
            Show
          </button>
        </form>
      </div>

      {summary.leads ? (
        <Section title="Leads" className="grid-cols-2 lg:grid-cols-3">
          <NumberCard label="Leads created" value={formatNumber(summary.leads.count)} hint="Leads entered in this range" href={listHref('leads')} active={isOpen('leads')} />
          <NumberCard label="Became work requests" value={formatNumber(summary.leads.converted)} hint={`${summary.leads.conversionPercent}% of ${formatNumber(summary.leads.enquiries)} enquiries (leads + work requests opened directly)`} href={listHref('converted')} active={isOpen('converted')} />
          <Stat label="Lead to first estimate" value={hoursText(summary.medianHours)} hint="Median, leads created in this range" />
        </Section>
      ) : null}

      <Section title="Estimates and jobs">
        <NumberCard label="Estimates sent" value={formatNumber(summary.estimates.sent)} hint="Sent in this range" href={listHref('sent')} active={isOpen('sent')} />
        <NumberCard label="Viewed" value={formatNumber(summary.estimates.viewed)} hint="Of the estimates sent" href={listHref('viewed')} active={isOpen('viewed')} />
        <NumberCard label="Signed" value={formatNumber(summary.estimates.signed)} hint="Of the estimates sent" href={listHref('signed')} active={isOpen('signed')} />
        <NumberCard
          label="Jobs booked"
          value={formatNumber(summary.booked.count)}
          hint={summary.booked.amountCents !== null ? `${formatMoney(summary.booked.amountCents)} booked revenue` : 'Booked in this range'}
          href={listHref('booked')}
          active={isOpen('booked')}
        />
        <NumberCard label="Booked moves" value={formatNumber(summary.moves)} hint="Move date in this range" href={listHref('moves')} active={isOpen('moves')} />
      </Section>

      {summary.open && summary.pastDue && summary.invoicedCents !== null ? (
        <Section title="Money" className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <NumberCard label="Revenue invoiced" value={formatMoney(summary.invoicedCents)} hint={`${plural(summary.invoicedCount ?? 0, 'invoice')} dated in this range`} href={listHref('invoiced')} active={isOpen('invoiced')} />
          {summary.collectedCents !== null ? (
            <NumberCard label="Payments collected" value={formatMoney(summary.collectedCents)} hint={`${plural(summary.collectedCount ?? 0, 'payment')}, net of refunds`} href={listHref('collected')} active={isOpen('collected')} />
          ) : null}
          <NumberCard label="Open balance" value={formatMoney(summary.open.cents)} hint={`${plural(summary.open.count, 'invoice')}, drafts included · as of today`} href={listHref('open')} active={isOpen('open')} />
          <NumberCard label="Past due" value={formatMoney(summary.pastDue.cents)} hint={`${plural(summary.pastDue.count, 'invoice')} · as of today`} href={listHref('past_due')} active={isOpen('past_due')} />
        </Section>
      ) : null}

      {detail && list ? (
        <div id="records" className="mb-5 scroll-mt-4">
          <Card
            flush
            title={`${detail.def.label}${filters.source ? ` · ${filters.source}` : ''}${filters.month ? ` · ${monthLabel(filters.month)}` : ''}`}
            description={`${detail.def.asOfToday ? `As of today, ${formatDay(detail.today)}` : rangeLabel} · ${plural(detail.totals.count, 'record')}`}
            actions={
              <Link href={hrefWith(basePath, q, {})} className={buttonClass({ variant: 'ghost', size: 'sm' })}>
                Close
              </Link>
            }
          >
            {detail.rows.length === 0 ? (
              <EmptyState title="Nothing here for this range." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Customer</Th>
                    <Th>Record</Th>
                    <Th>Move date</Th>
                    <Th>{detail.def.dateLabel}</Th>
                    {seesMoney ? <Th className="text-right">Amount</Th> : null}
                    {seesMoney ? <Th>Paid</Th> : null}
                    {seesMoney ? <Th className="text-right">Balance</Th> : null}
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-zinc-50">
                      <Td className="min-w-36">{r.customerName}</Td>
                      <Td className="whitespace-nowrap">
                        <Link className="font-medium hover:underline" href={recordHref(basePath, r.href)}>
                          {r.reference}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap">{formatDay(r.moveDate)}</Td>
                      <Td className="whitespace-nowrap">{formatDay(r.date)}</Td>
                      {seesMoney ? <Td className="text-right whitespace-nowrap tabular-nums">{r.amountCents === null ? '—' : formatMoney(r.amountCents)}</Td> : null}
                      {seesMoney ? <Td>{r.paid ? <Badge tone={PAID[r.paid.state].tone}>{PAID[r.paid.state].label}</Badge> : '—'}</Td> : null}
                      {seesMoney ? (
                        <Td className="text-right whitespace-nowrap tabular-nums">{r.paid && r.paid.balanceCents !== null && r.paid.state !== 'paid' ? formatMoney(r.paid.balanceCents) : '—'}</Td>
                      ) : null}
                      <Td>
                        <StatusCell status={r.status} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-medium text-zinc-900">
                    <Td className="border-b-0">Total</Td>
                    <Td className="border-b-0 whitespace-nowrap">{plural(detail.totals.count, 'record')}</Td>
                    <Td className="border-b-0" />
                    <Td className="border-b-0" />
                    {seesMoney ? <Td className={cn('border-b-0 text-right whitespace-nowrap tabular-nums', detail.def.measure === 'amount' && 'font-semibold')}>{formatMoney(detail.totals.amountCents)}</Td> : null}
                    {seesMoney ? <Td className="border-b-0" /> : null}
                    {seesMoney ? <Td className={cn('border-b-0 text-right whitespace-nowrap tabular-nums', detail.def.measure === 'balance' && 'font-semibold')}>{formatMoney(detail.totals.balanceCents)}</Td> : null}
                    <Td className="border-b-0" />
                  </tr>
                </tfoot>
              </Table>
            )}
          </Card>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card flush title="By source" description={`Leads created and jobs booked, ${rangeLabel}`}>
          {summary.bySource.length === 0 ? (
            <EmptyState title="No leads or booked jobs in this range." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Source</Th>
                  {summary.leads ? <Th className="text-right">Leads</Th> : null}
                  <Th className="text-right">Jobs booked</Th>
                  {seesMoney ? <Th className="text-right">Booked revenue</Th> : null}
                </tr>
              </thead>
              <tbody>
                {summary.bySource.map((r) => (
                  <tr key={r.source} className="hover:bg-zinc-50">
                    <Td className="whitespace-nowrap">{r.source}</Td>
                    {summary.leads ? (
                      <Td className="text-right">
                        <NumLink href={listHref('leads', { source: r.source })} value={r.leads} />
                      </Td>
                    ) : null}
                    <Td className="text-right">
                      <NumLink href={listHref('booked', { source: r.source })} value={r.booked} />
                    </Td>
                    {seesMoney ? (
                      <Td className="text-right whitespace-nowrap">
                        <MoneyLink href={listHref('booked', { source: r.source })} value={r.bookedCents} />
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card flush title="By month" description="Booked revenue: signed estimate totals (no card fee) of the jobs booked that month">
          <Table>
            <thead>
              <tr>
                <Th>Month</Th>
                {summary.leads ? <Th className="text-right">Leads</Th> : null}
                <Th className="text-right">Jobs booked</Th>
                {seesMoney ? <Th className="text-right">Booked revenue</Th> : null}
                {seesMoney ? <Th className="text-right">Invoiced</Th> : null}
                {summary.collectedCents !== null ? <Th className="text-right">Collected</Th> : null}
              </tr>
            </thead>
            <tbody>
              {summary.byMonth.map((m) => (
                <tr key={m.month} className="hover:bg-zinc-50">
                  <Td className="whitespace-nowrap">{monthLabel(m.month)}</Td>
                  {summary.leads ? (
                    <Td className="text-right">
                      <NumLink href={listHref('leads', { month: m.month })} value={m.leads} />
                    </Td>
                  ) : null}
                  <Td className="text-right">
                    <NumLink href={listHref('booked', { month: m.month })} value={m.booked} />
                  </Td>
                  {seesMoney ? (
                    <Td className="text-right whitespace-nowrap">
                      <MoneyLink href={listHref('booked', { month: m.month })} value={m.bookedCents} />
                    </Td>
                  ) : null}
                  {seesMoney ? (
                    <Td className="text-right whitespace-nowrap">
                      <MoneyLink href={listHref('invoiced', { month: m.month })} value={m.invoicedCents} />
                    </Td>
                  ) : null}
                  {summary.collectedCents !== null ? (
                    <Td className="text-right whitespace-nowrap">
                      <MoneyLink href={listHref('collected', { month: m.month })} value={m.collectedCents} />
                    </Td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
