import { buttonClass } from '@/ui/button';
import { Field, inputClass } from '@/ui/layout';
import { ACTIVITY_ACTIONS, actionLabel } from './activity-table';

export type ActivitySearch = {
  q?: string;
  action?: string;
  from?: string;
  to?: string;
  business?: string;
  /** people (default) · system (the importer, seed, scheduled jobs) · all */
  who?: string;
  page?: string;
};

/** Turns the filter form's query-string values into filters for the core. */
/** Midnight at the start of a calendar day in a time zone, as a moment in time. */
export function startOfDayIn(day: string, timeZone: string): Date | undefined {
  const utcMidnight = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(utcMidnight.getTime())) return undefined;
  // What the wall clock in that zone shows at UTC midnight tells us the zone's offset that day.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(utcMidnight);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(utcMidnight.getTime() - (shown - utcMidnight.getTime()));
}

export function parseActivitySearch(
  raw: Record<string, string | string[] | undefined>,
  timeZone = 'America/New_York',
) {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const search: ActivitySearch = {
    q: first(raw.q),
    action: first(raw.action),
    from: first(raw.from),
    to: first(raw.to),
    business: first(raw.business),
    who: first(raw.who),
  };
  // "From" and "To" are days in the business's time zone (Ithaca time by default).
  const day = (value: string | undefined, endOfDay: boolean) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const calendar = new Date(`${value}T00:00:00Z`);
    // A date that does not exist (30 February) is ignored rather than quietly moved.
    if (Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value)
      return undefined;
    // A mistyped year (0026, 9999) is ignored too: it is outside what the log can hold.
    const year = calendar.getUTCFullYear();
    if (year < 2000 || year > 2100) return undefined;
    if (!endOfDay) return startOfDayIn(value, timeZone);
    // "To" includes the whole day: up to midnight at the start of the NEXT calendar day
    // (not "plus 24 hours", which is an hour out on the two days the clocks change).
    const nextDay = new Date(calendar.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return startOfDayIn(nextDay, timeZone);
  };
  const parsedPage = Number.parseInt(first(raw.page) ?? '1', 10);
  const page = Number.isInteger(parsedPage) && parsedPage >= 1 ? Math.min(parsedPage, 100_000) : 1;
  return {
    search,
    page,
    filters: {
      search: search.q || undefined,
      action: ACTIVITY_ACTIONS.includes(search.action ?? '') ? search.action : undefined,
      from: day(search.from, false),
      to: day(search.to, true),
      limit: 50,
      offset: (page - 1) * 50,
      // People's changes by default; the importer and other system jobs on request.
      actors: (search.who === 'system' || search.who === 'all' ? search.who : 'people') as 'people' | 'system' | 'all',
    },
  };
}

/** A plain GET form: filters live in the URL, so a filtered view can be bookmarked or shared. */
export function ActivityFilters({
  search,
  businesses,
}: {
  search: ActivitySearch;
  businesses?: { id: string; name: string }[];
}) {
  return (
    <form
      method="get"
      className="grid grid-cols-2 items-end gap-3 border-b border-zinc-200 p-3 md:grid-cols-[minmax(0,1fr)_10rem_9rem_9rem_auto]"
    >
      <Field label="Search" htmlFor="q" className="col-span-2 md:col-span-1">
        <input
          id="q"
          name="q"
          defaultValue={search.q ?? ''}
          placeholder="Person or description"
          className={inputClass}
        />
      </Field>
      <Field label="Action" htmlFor="action">
        <select id="action" name="action" defaultValue={search.action ?? ''} className={inputClass}>
          <option value="">All actions</option>
          {ACTIVITY_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {actionLabel(a)}
            </option>
          ))}
        </select>
      </Field>
      {businesses ? (
        <Field label="Business" htmlFor="business">
          <select
            id="business"
            name="business"
            defaultValue={search.business ?? ''}
            className={inputClass}
          >
            <option value="">All businesses</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label="Who" htmlFor="who">
        <select id="who" name="who" defaultValue={search.who ?? ''} className={inputClass}>
          <option value="">People</option>
          <option value="system">Import and system</option>
          <option value="all">Everyone</option>
        </select>
      </Field>
      <Field label="From" htmlFor="from">
        <input
          id="from"
          name="from"
          type="date"
          defaultValue={search.from ?? ''}
          className={inputClass}
        />
      </Field>
      <Field label="To" htmlFor="to">
        <input
          id="to"
          name="to"
          type="date"
          defaultValue={search.to ?? ''}
          className={inputClass}
        />
      </Field>
      <button type="submit" className={buttonClass({ variant: 'primary' })}>
        Filter
      </button>
    </form>
  );
}

export function activityHref(base: string, search: ActivitySearch, page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...search, page: String(page) }))
    if (value) params.set(key, value);
  return `${base}?${params.toString()}`;
}
