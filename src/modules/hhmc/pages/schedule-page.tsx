/**
 * The schedule: ONE calendar with Day, Week and Month views (ref §10: replaces Monthly
 * Schedule, Daily Job Chart, Availability, Weekly Schedule and Events). Each job reads
 * "time · customer · M:crew / T:trucks"; each day shows crew and truck capacity against what
 * is booked, and can be marked sold out (ref §3.12, §3.13).
 */
import Link from 'next/link';
import type { PortalPageProps } from '@/core/modules/contract';
import { can } from '@/core/rbac/permissions';
import { ActionForm } from '@/ui/action-form';
import { Badge } from '@/ui/badge';
import { buttonClass } from '@/ui/button';
import { cn } from '@/ui/cn';
import { ConfirmButton } from '@/ui/confirm-button';
import { Card, EmptyState, Field, PageHeader, inputClass } from '@/ui/layout';
import { soldOutAction, unSoldOutAction } from '../actions';
import { CORE } from '../permissions';
import { addDays, isDateText, localDate } from '../rules';
import { scheduleBetween, type ScheduleDay } from '../services/booking';
import { formatTime, formatWeekday } from './parts';

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
    ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${anchor.slice(0, 7)}-01T00:00:00Z`))
    : view === 'week'
      ? `Week of ${formatWeekday(from)}`
      : formatWeekday(anchor);

function Capacity({ day, crew, trucks }: { day: ScheduleDay; crew: number; trucks: number }) {
  const overCrew = day.crewBooked > crew;
  const overTrucks = day.trucksBooked > trucks;
  return (
    <span className="text-[11px] text-zinc-500 tabular-nums">
      <span className={cn(overCrew && 'font-semibold text-red-700')}>{`Crew ${day.crewBooked}/${crew}`}</span>
      {' · '}
      <span className={cn(overTrucks && 'font-semibold text-red-700')}>{`Trucks ${day.trucksBooked}/${trucks}`}</span>
    </span>
  );
}

export async function SchedulePage({ ctx, searchParams, basePath }: PortalPageProps) {
  const tz = ctx.business.timeZone;
  const today = localDate(new Date(), tz);
  const view: View = searchParams.view === 'day' || searchParams.view === 'week' ? searchParams.view : 'month';
  const anchor = searchParams.date && isDateText(searchParams.date) ? searchParams.date : today;
  const { from, to } = rangeFor(view, anchor);
  const schedule = await scheduleBetween(ctx, from, to);
  const canBlock = can(ctx, CORE.schedulingWrite);
  const base = `${basePath}/schedule`;
  const link = (v: View, d: string) => `${base}?view=${v}&date=${d}`;
  const thisMonth = anchor.slice(0, 7);

  const entry = (e: ScheduleDay['entries'][number]) => (
    <Link key={e.dayId} href={`${basePath}/jobs/${e.jobId}`} className="block rounded bg-sky-50 px-1.5 py-0.5 text-[11px] leading-tight text-sky-900 ring-1 ring-sky-200 hover:bg-sky-100" title={`${formatTime(e.startsAt, tz)} · ${e.customerName} · M:${e.crewSize} / T:${e.trucks} (${e.jobNumber})`}>
      <span className="block truncate">{`${formatTime(e.startsAt, tz)} · ${e.customerName}`}</span>
      <span className="block text-sky-700">{`M:${e.crewSize} / T:${e.trucks}`}</span>
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Schedule"
        description={`Booked job days. Capacity: ${schedule.crewCapacity} movers and ${schedule.truckCapacity} trucks a day.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label="Calendar view" className="flex rounded-md border border-zinc-300 bg-white p-0.5">
              {(['day', 'week', 'month'] as const).map((v) => (
                <Link key={v} href={link(v, anchor)} aria-current={v === view ? 'page' : undefined} className={cn('rounded px-2.5 py-1 text-xs capitalize', v === view ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-100')}>
                  {v}
                </Link>
              ))}
            </nav>
            <Link className={buttonClass({ variant: 'secondary', size: 'sm' })} href={link(view, step(view, anchor, -1))} aria-label="Previous">←</Link>
            <Link className={buttonClass({ variant: 'secondary', size: 'sm' })} href={link(view, today)}>Today</Link>
            <Link className={buttonClass({ variant: 'secondary', size: 'sm' })} href={link(view, step(view, anchor, 1))} aria-label="Next">→</Link>
          </div>
        }
      />
      <h2 className="mb-3 text-sm font-semibold text-zinc-900">{titleFor(view, anchor, from)}</h2>

      {view === 'month' ? (
        <>
          <div className="hidden overflow-hidden rounded-lg border border-zinc-200 bg-white md:block">
            <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="px-2 py-1.5">{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {schedule.days.map((d) => (
                <div key={d.date} className={cn('min-h-24 space-y-1 border-r border-b border-zinc-100 p-1.5', d.date.slice(0, 7) !== thisMonth && 'bg-zinc-50/60', d.soldOut && 'bg-red-50/60')}>
                  <div className="flex items-center justify-between gap-1">
                    <Link href={link('day', d.date)} className={cn('text-xs', d.date === today ? 'rounded-full bg-zinc-900 px-1.5 text-white' : 'text-zinc-600 hover:underline')}>{Number(d.date.slice(8))}</Link>
                    {d.soldOut ? <Badge tone="red">Sold out</Badge> : null}
                  </div>
                  {d.entries.map(entry)}
                  {d.entries.length ? <Capacity day={d} crew={schedule.crewCapacity} trucks={schedule.truckCapacity} /> : null}
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2 md:hidden">
            {schedule.days.filter((d) => d.date.slice(0, 7) === thisMonth && (d.entries.length || d.soldOut)).map((d) => (
              <Card key={d.date}>
                <div className="mb-1 flex items-center justify-between">
                  <Link href={link('day', d.date)} className="text-sm font-medium hover:underline">{formatWeekday(d.date)}</Link>
                  {d.soldOut ? <Badge tone="red">Sold out</Badge> : <Capacity day={d} crew={schedule.crewCapacity} trucks={schedule.truckCapacity} />}
                </div>
                <div className="space-y-1">{d.entries.map(entry)}</div>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <div className={cn('grid gap-3', view === 'week' ? 'md:grid-cols-7' : '')}>
          {schedule.days.map((d) => (
            <Card key={d.date} className={cn(d.soldOut && 'border-red-200')}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
                <Link href={link('day', d.date)} className="text-sm font-medium hover:underline">{formatWeekday(d.date)}</Link>
                {d.soldOut ? <Badge tone="red">Sold out</Badge> : null}
              </div>
              <Capacity day={d} crew={schedule.crewCapacity} trucks={schedule.truckCapacity} />
              <div className="mt-2 space-y-1">
                {d.entries.length ? d.entries.map(entry) : <p className="text-xs text-zinc-400">Nothing booked</p>}
              </div>
              {view === 'day' ? (
                <ul className="mt-3 space-y-1 text-sm">
                  {d.entries.map((e) => (
                    <li key={e.dayId}>
                      <Link className="font-medium hover:underline" href={`${basePath}/jobs/${e.jobId}`}>{e.jobNumber}</Link>
                      {` ${formatTime(e.startsAt, tz)}–${formatTime(e.endsAt, tz)} · ${e.customerName} · trucks: ${e.truckNames.join(', ') || '—'}${e.unassignedTrucks ? ` (+${e.unassignedTrucks} with no truck free)` : ''}`}
                    </li>
                  ))}
                </ul>
              ) : null}
              {canBlock && view === 'day' ? (
                <div className="mt-3 border-t border-zinc-100 pt-3">
                  {d.soldOut ? (
                    <ConfirmButton action={unSoldOutAction.bind(null, ctx.business.slug, ctx.environment, d.soldOut.id)}>Open this date again</ConfirmButton>
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
          {schedule.days.length === 0 ? <EmptyState title="Nothing in this range." /> : null}
        </div>
      )}
      {canBlock && view !== 'day' ? <p className="mt-3 text-xs text-zinc-500">To mark a date sold out, open it in the Day view.</p> : null}
    </>
  );
}
