/**
 * The calendar: ONE calendar of booked moves, estimates, work requests and invoices due,
 * colour-coded with a legend (managers: "only the monthly calendar is useful and you can't
 * color code it"). Month is the main view; Week and Day remain (ref §10: replaces Monthly
 * Schedule, Daily Job Chart, Availability, Weekly Schedule and Events).
 *
 * - Every event carries a text label and a symbol as well as its colour (never colour alone).
 * - The legend's items show or hide a kind: plain links, the state is in the URL
 *   (?view=month&date=2026-11-01&hide=estimate,invoice).
 * - Each day still shows crew and truck capacity against what is booked, and can be marked
 *   sold out (ref §3.12, §3.13). A booked job day reads "time · customer · M:crew / T:trucks".
 */
import Link from 'next/link';
import type { PortalPageProps } from '@/core/modules/contract';
import { can } from '@/core/rbac/permissions';
import { ActionForm } from '@/ui/action-form';
import { Badge } from '@/ui/badge';
import { buttonClass } from '@/ui/button';
import { cn } from '@/ui/cn';
import { ConfirmButton } from '@/ui/confirm-button';
import { formatMoney } from '@/ui/format';
import { Card, EmptyState, Field, PageHeader, inputClass } from '@/ui/layout';
import { soldOutAction, unSoldOutAction } from '../actions';
import { CORE, P } from '../permissions';
import { ESTIMATE_STATUS_LABELS, INVOICE_STATUS_LABELS, addDays, isDateText, localDate } from '../rules';
import { scheduleBetween, type ScheduleDay } from '../services/booking';
import {
  CALENDAR_KIND_LABELS,
  CALENDAR_KINDS,
  calendarBetween,
  parseCalendarKinds,
  type CalendarEvent,
  type CalendarKind,
} from '../services/calendar';
import { formatTime, formatWeekday, hrefWith } from './parts';
import { formatMonth } from '@/ui/format';

type View = 'day' | 'week' | 'month';

function weekStart(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7)); // Monday
}

function rangeFor(view: View, anchor: string): { from: string; to: string } {
  if (view === 'day') return { from: anchor, to: addDays(anchor, 1) };
  if (view === 'week') {
    const from = weekStart(anchor);
    return { from, to: addDays(from, 7) };
  }
  const first = `${anchor.slice(0, 7)}-01`;
  const next = new Date(`${first}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const from = weekStart(first);
  const lastDay = addDays(next.toISOString().slice(0, 10), -1);
  return { from, to: addDays(weekStart(lastDay), 7) };
}

function step(view: View, anchor: string, direction: 1 | -1): string {
  if (view === 'day') return addDays(anchor, direction);
  if (view === 'week') return addDays(anchor, 7 * direction);
  const d = new Date(`${anchor.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + direction);
  return d.toISOString().slice(0, 10);
}

const titleFor = (view: View, anchor: string, from: string) =>
  view === 'month'
    ? formatMonth(anchor)
    : view === 'week'
      ? `Week of ${formatWeekday(from)}`
      : formatWeekday(anchor);

/**
 * One look per kind, from the tones the app's badges already use (StageBadge: Qualified is
 * neutral, Estimate Sent blue, Booked green, Completed amber). Text is the -900 shade on the
 * -50/-100 background (well above 7:1); the thick left border carries the colour, the symbol
 * and the label carry the meaning. Work requests have a dashed border (not yet estimated).
 */
const KIND_LOOK: Record<CalendarKind, { chip: string; sub: string; symbol: string; short: string }> = {
  booked: { chip: 'border-emerald-600 bg-emerald-50 text-emerald-950 hover:bg-emerald-100', sub: 'text-emerald-800', symbol: '■', short: 'Move' },
  estimate: { chip: 'border-sky-600 bg-sky-50 text-sky-950 hover:bg-sky-100', sub: 'text-sky-800', symbol: '◆', short: 'Estimate' },
  request: { chip: 'border-dashed border-zinc-500 bg-zinc-100 text-zinc-900 hover:bg-zinc-200', sub: 'text-zinc-700', symbol: '○', short: 'Request' },
  invoice: { chip: 'border-amber-600 bg-amber-50 text-amber-950 hover:bg-amber-100', sub: 'text-amber-900', symbol: '$', short: 'Due' },
};

function Capacity({ day, crew, trucks }: { day: ScheduleDay; crew: number; trucks: number }) {
  const overCrew = day.crewBooked > crew;
  const overTrucks = day.trucksBooked > trucks;
  return (
    <span className="text-[11px] text-zinc-600 tabular-nums">
      <span className={cn(overCrew && 'font-semibold text-red-700')}>{`Crew ${day.crewBooked}/${crew}`}</span>
      {' · '}
      <span className={cn(overTrucks && 'font-semibold text-red-700')}>{`Trucks ${day.trucksBooked}/${trucks}`}</span>
    </span>
  );
}

/** The two lines of an event: what and who, then the detail for its kind. */
function eventText(e: CalendarEvent, tz: string): { main: string; detail: string } {
  switch (e.kind) {
    case 'booked':
      return { main: `${formatTime(e.startsAt, tz)} · ${e.customerName}`, detail: `M:${e.crewSize} / T:${e.trucks} · ${e.jobNumber}` };
    case 'estimate': {
      const status = e.estimateStatus ? ESTIMATE_STATUS_LABELS[e.estimateStatus] : 'No live estimate';
      return { main: e.customerName, detail: `${status}${e.expired ? ', expired' : ''} · ${e.jobNumber}` };
    }
    case 'request':
      return { main: e.customerName, detail: `Not estimated · ${e.jobNumber}` };
    case 'invoice':
      return {
        main: `${formatMoney(e.balanceCents)} · ${e.customerName}`,
        detail: `${e.invoiceNumber} · ${e.pastDue ? 'Past due' : INVOICE_STATUS_LABELS[e.invoiceStatus]}`,
      };
  }
}

export async function SchedulePage({ ctx, searchParams, basePath }: PortalPageProps) {
  const tz = ctx.business.timeZone;
  const today = localDate(new Date(), tz);
  const view: View = searchParams.view === 'day' || searchParams.view === 'week' ? searchParams.view : 'month';
  const anchor = searchParams.date && isDateText(searchParams.date) ? searchParams.date : today;
  const hidden = parseCalendarKinds(searchParams.hide);
  const { from, to } = rangeFor(view, anchor);
  const canSeeCapacity = can(ctx, P.jobsRead) && can(ctx, CORE.schedulingRead);
  const [schedule, calendar] = await Promise.all([
    canSeeCapacity ? scheduleBetween(ctx, from, to) : Promise.resolve(null),
    calendarBetween(ctx, from, to, { kinds: CALENDAR_KINDS.filter((k) => !hidden.has(k)) }),
  ]);
  const canBlock = can(ctx, CORE.schedulingWrite);
  const base = `${basePath}/schedule`;
  const hideText = (set: Set<CalendarKind>) => CALENDAR_KINDS.filter((k) => set.has(k)).join(',') || undefined;
  const current = { view, date: anchor, hide: hideText(hidden) };
  const link = (v: View, d: string) => hrefWith(base, current, { view: v, date: d });
  const toggle = (k: CalendarKind) => {
    const next = new Set(hidden);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    return hrefWith(base, current, { hide: hideText(next) });
  };
  const thisMonth = anchor.slice(0, 7);
  const inPeriod = (date: string) => view !== 'month' || date.slice(0, 7) === thisMonth;
  const scheduleByDate = new Map((schedule?.days ?? []).map((d) => [d.date, d]));
  const days = calendar.days.map((d) => ({ ...d, schedule: scheduleByDate.get(d.date) ?? null }));
  const counts = new Map<CalendarKind, number>();
  for (const d of days) if (inPeriod(d.date)) for (const e of d.events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);

  const href = (e: CalendarEvent) => (e.kind === 'invoice' ? `${basePath}/invoices/${e.invoiceId}` : `${basePath}/jobs/${e.jobId}`);
  const event = (e: CalendarEvent) => {
    const look = KIND_LOOK[e.kind];
    const text = eventText(e, tz);
    const label = `${CALENDAR_KIND_LABELS[e.kind]}: ${text.main} · ${text.detail}`;
    return (
      <Link key={e.key} href={href(e)} title={label} aria-label={label} className={cn('block min-w-0 rounded-r border border-l-4 px-1.5 py-0.5 text-[11px] leading-tight max-md:min-h-11 max-md:py-1.5 max-md:text-xs', look.chip)}>
        <span className="flex min-w-0 items-baseline gap-1">
          <span aria-hidden="true" className="shrink-0">{look.symbol}</span>
          <span className="shrink-0 font-semibold">{look.short}</span>
          <span className="truncate">{text.main}</span>
        </span>
        <span className={cn('block truncate', look.sub)}>{text.detail}</span>
      </Link>
    );
  };
  const capacity = (s: ScheduleDay | null) => (s && schedule ? <Capacity day={s} crew={schedule.crewCapacity} trucks={schedule.truckCapacity} /> : null);

  return (
    <>
      <PageHeader
        title="Calendar"
        description={`Booked moves, estimates, work requests and invoices due.${schedule ? ` Capacity: ${schedule.crewCapacity} movers and ${schedule.truckCapacity} trucks a day.` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label="Calendar view" className="flex rounded-md border border-zinc-300 bg-white p-0.5">
              {(['month', 'week', 'day'] as const).map((v) => (
                <Link key={v} href={link(v, anchor)} aria-current={v === view ? 'page' : undefined} className={cn('flex min-h-11 items-center rounded px-3 py-1 text-sm capitalize sm:min-h-0 sm:px-2.5 sm:text-xs', v === view ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-100')}>
                  {v}
                </Link>
              ))}
            </nav>
            <Link className={buttonClass({ variant: 'secondary', size: 'sm', className: 'min-w-11 sm:min-w-0' })} href={link(view, step(view, anchor, -1))} aria-label="Previous">←</Link>
            <Link className={buttonClass({ variant: 'secondary', size: 'sm' })} href={link(view, today)}>Today</Link>
            <Link className={buttonClass({ variant: 'secondary', size: 'sm', className: 'min-w-11 sm:min-w-0' })} href={link(view, step(view, anchor, 1))} aria-label="Next">→</Link>
          </div>
        }
      />
      <h2 className="mb-2 text-sm font-semibold text-zinc-900">{titleFor(view, anchor, from)}</h2>

      <nav aria-label="Show or hide on the calendar" className="mb-3">
        <ul className="flex flex-wrap gap-2">
          {calendar.allowed.map((k) => {
            const shown = !hidden.has(k);
            const look = KIND_LOOK[k];
            return (
              <li key={k}>
                <Link
                  href={toggle(k)}
                  aria-label={`${CALENDAR_KIND_LABELS[k]}: ${shown ? 'shown' : 'hidden'}. ${shown ? 'Hide' : 'Show'} them.`}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-1.5 rounded-md border px-2 py-1 text-xs sm:min-h-0',
                    shown ? 'border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50' : 'border-dashed border-zinc-300 bg-zinc-50 text-zinc-600 hover:bg-white',
                  )}
                >
                  <span aria-hidden="true" className="w-3 text-center">{shown ? '✓' : ''}</span>
                  <span aria-hidden="true" className={cn('inline-flex size-4 items-center justify-center rounded-r border border-l-4 text-[10px] leading-none', look.chip, !shown && 'opacity-50')}>
                    {look.symbol}
                  </span>
                  <span className={cn(!shown && 'line-through')}>{CALENDAR_KIND_LABELS[k]}</span>
                  {shown ? <span className="text-zinc-500 tabular-nums">{counts.get(k) ?? 0}</span> : <span className="text-zinc-600">(hidden)</span>}
                </Link>
              </li>
            );
          })}
          <li className="inline-flex items-center gap-1.5 px-1 text-xs text-zinc-600">
            <Badge tone="red">Sold out</Badge> date closed to bookings
          </li>
        </ul>
      </nav>

      {view === 'month' ? (
        <>
          <div className="hidden overflow-hidden rounded-lg border border-zinc-200 bg-white md:block">
            <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-600">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="px-2 py-1.5">{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => (
                <div key={d.date} className={cn('min-h-24 min-w-0 space-y-1 border-r border-b border-zinc-100 p-1.5', d.date.slice(0, 7) !== thisMonth && 'bg-zinc-50/60', d.schedule?.soldOut && 'bg-red-50/60')}>
                  <div className="flex items-center justify-between gap-1">
                    <Link href={link('day', d.date)} aria-label={formatWeekday(d.date)} className={cn('text-xs', d.date === today ? 'rounded-full bg-zinc-900 px-1.5 text-white' : 'text-zinc-700 hover:underline')}>{Number(d.date.slice(8))}</Link>
                    {d.schedule?.soldOut ? <Badge tone="red">Sold out</Badge> : null}
                  </div>
                  {d.events.map(event)}
                  {d.schedule?.entries.length ? capacity(d.schedule) : null}
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2 md:hidden">
            {days.filter((d) => d.date.slice(0, 7) === thisMonth && (d.events.length || d.schedule?.soldOut)).map((d) => (
              <Card key={d.date}>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
                  <Link href={link('day', d.date)} className="inline-flex min-h-11 items-center text-sm font-medium hover:underline md:min-h-0">{formatWeekday(d.date)}</Link>
                  {d.schedule?.soldOut ? <Badge tone="red">Sold out</Badge> : d.schedule?.entries.length ? capacity(d.schedule) : null}
                </div>
                <div className="space-y-1">{d.events.map(event)}</div>
              </Card>
            ))}
            {days.every((d) => d.date.slice(0, 7) !== thisMonth || (!d.events.length && !d.schedule?.soldOut)) ? <EmptyState title="Nothing on the calendar this month." /> : null}
          </div>
        </>
      ) : (
        <div className={cn('grid gap-3', view === 'week' ? 'md:grid-cols-7' : '')}>
          {days.map((d) => (
            <Card key={d.date} className={cn('min-w-0', d.schedule?.soldOut && 'border-red-200')}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
                <Link href={link('day', d.date)} className="inline-flex min-h-11 items-center text-sm font-medium hover:underline md:min-h-0">{formatWeekday(d.date)}</Link>
                {d.schedule?.soldOut ? <Badge tone="red">Sold out</Badge> : null}
              </div>
              {capacity(d.schedule)}
              <div className="mt-2 space-y-1">
                {d.events.length ? d.events.map(event) : <p className="text-xs text-zinc-500">Nothing on the calendar</p>}
              </div>
              {view === 'day' && d.schedule?.entries.length ? (
                <ul className="mt-3 space-y-1 text-sm">
                  {d.schedule.entries.map((e) => (
                    <li key={e.dayId}>
                      <Link className="font-medium hover:underline" href={`${basePath}/jobs/${e.jobId}`}>{e.jobNumber}</Link>
                      {` ${formatTime(e.startsAt, tz)}–${formatTime(e.endsAt, tz)} · ${e.customerName} · trucks: ${e.truckNames.join(', ') || '—'}${e.unassignedTrucks ? ` (+${e.unassignedTrucks} with no truck free)` : ''}`}
                    </li>
                  ))}
                </ul>
              ) : null}
              {canBlock && view === 'day' && schedule ? (
                <div className="mt-3 border-t border-zinc-100 pt-3">
                  {d.schedule?.soldOut ? (
                    <ConfirmButton action={unSoldOutAction.bind(null, ctx.business.slug, ctx.environment, d.schedule.soldOut.id)}>Open this date again</ConfirmButton>
                  ) : (
                    <ActionForm action={soldOutAction.bind(null, ctx.business.slug, ctx.environment)} submitLabel="Mark date sold out" submitVariant="danger">
                      <input type="hidden" name="date" value={d.date} />
                      <Field label="Reason (optional)" htmlFor={`so-${d.date}`}><input id={`so-${d.date}`} name="reason" placeholder="Sold out" className={inputClass} /></Field>
                    </ActionForm>
                  )}
                </div>
              ) : null}
            </Card>
          ))}
          {days.length === 0 ? <EmptyState title="Nothing in this range." /> : null}
        </div>
      )}
      {canBlock && view !== 'day' ? <p className="mt-3 text-xs text-zinc-600">To mark a date sold out, open it in the Day view.</p> : null}
    </>
  );
}
