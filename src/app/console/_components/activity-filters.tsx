import { buttonClass } from '@/ui/button';
import { Field, inputClass } from '@/ui/layout';
import { ACTIVITY_ACTIONS, actionLabel } from './activity-table';

export type ActivitySearch = {
  q?: string;
  action?: string;
  from?: string;
  to?: string;
  business?: string;
  page?: string;
};

/** Turns the filter form's query-string values into filters for the core. */
export function parseActivitySearch(search: ActivitySearch) {
  const day = (value: string | undefined, endOfDay: boolean) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const date = new Date(`${value}T00:00:00-05:00`);
    if (endOfDay) date.setUTCDate(date.getUTCDate() + 1);
    return Number.isNaN(date.getTime()) ? undefined : date;
  };
  const page = Math.max(1, Number.parseInt(search.page ?? '1', 10) || 1);
  return {
    page,
    filters: {
      search: search.q || undefined,
      action: ACTIVITY_ACTIONS.includes(search.action ?? '') ? search.action : undefined,
      from: day(search.from, false),
      to: day(search.to, true),
      limit: 50,
      offset: (page - 1) * 50,
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
