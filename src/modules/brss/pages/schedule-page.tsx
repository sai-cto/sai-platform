/** The schedule: upcoming appointments day by day, and the times that are blocked. */
import Link from 'next/link';
import type { PortalPageProps } from '@/core/modules/contract';
import { can } from '@/core/rbac/permissions';
import { cn } from '@/ui/cn';
import { ActionForm } from '@/ui/action-form';
import { buttonClass } from '@/ui/button';
import { ConfirmButton } from '@/ui/confirm-button';
import { formatDateTime } from '@/ui/format';
import { Card, EmptyState, Field, PageHeader, inputClass } from '@/ui/layout';
import { createBlockAction, removeBlockAction } from '../actions';
import { CORE, P } from '../permissions';
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  TIME_SLOTS,
  earliestBookableDate,
  localDate,
} from '../rules';
import { loadSettings } from '../settings';
import {
  listBlocks,
  listSchedule,
  listTrucks,
  type ScheduleFilters,
} from '../services/appointments';
import { getPlaces } from '../services/catalog';
import { AppointmentRow } from './appointment-row';
import { Check, Disclosure, Select, formatWeekday } from './parts';

export async function SchedulePage({ ctx, searchParams, basePath }: PortalPageProps) {
  const days = Number.parseInt(searchParams.days ?? '14', 10);
  const filters: ScheduleFilters = {
    from: searchParams.from || undefined,
    days: Number.isInteger(days) ? days : 14,
    type: APPOINTMENT_TYPES.find((t) => t.key === searchParams.type)?.key,
    status:
      searchParams.status === 'all'
        ? 'all'
        : (APPOINTMENT_STATUSES.find((s) => s.key === searchParams.status)?.key ?? 'active'),
    regionId: searchParams.region || undefined,
    truckId: searchParams.truck || undefined,
  };
  const [schedule, blocks, trucks, places, settings] = await Promise.all([
    listSchedule(ctx, filters),
    listBlocks(ctx),
    listTrucks(ctx),
    can(ctx, P.catalogRead) ? getPlaces(ctx) : null,
    loadSettings(ctx),
  ]);
  const base = `${basePath}/schedule`;
  const canWrite = can(ctx, CORE.schedulingWrite);
  const activeTrucks = trucks.filter((truck) => truck.isActive);
  const today = localDate(new Date(), ctx.business.timeZone);
  const earliest = earliestBookableDate(today, settings.appointmentLeadDays);
  const dates = [...new Set(schedule.rows.map((row) => row.date))];

  return (
    <>
      <PageHeader
        title="Schedule"
        description="Appointments are booked from an order. Here you confirm them, put them on a truck, and block times when BRSS is not available."
      />
      <div className="space-y-5">
        <Card flush>
          <form
            method="get"
            action={base}
            className="grid grid-cols-2 items-end gap-3 border-b border-zinc-200 p-3 md:grid-cols-4 xl:grid-cols-7"
          >
            <Field label="From" htmlFor="s-from">
              <input
                id="s-from"
                name="from"
                type="date"
                defaultValue={schedule.from}
                className={inputClass}
              />
            </Field>
            <Field label="Days shown" htmlFor="s-days">
              <Select id="s-days" name="days" defaultValue={String(schedule.days)}>
                {[1, 7, 14, 31, 92].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? 'One day' : `${n} days`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Kind" htmlFor="s-type">
              <Select id="s-type" name="type" defaultValue={filters.type ?? ''}>
                <option value="">Any</option>
                {APPOINTMENT_TYPES.map((type) => (
                  <option key={type.key} value={type.key}>
                    {type.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" htmlFor="s-status">
              <Select id="s-status" name="status" defaultValue={filters.status}>
                <option value="active">All except cancelled</option>
                <option value="all">All</option>
                {APPOINTMENT_STATUSES.map((status) => (
                  <option key={status.key} value={status.key}>
                    {status.label}
                  </option>
                ))}
              </Select>
            </Field>
            {places ? (
              <Field label="Region" htmlFor="s-region">
                <Select id="s-region" name="region" defaultValue={filters.regionId ?? ''}>
                  <option value="">Any</option>
                  {places.regions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="Truck" htmlFor="s-truck">
              <Select id="s-truck" name="truck" defaultValue={filters.truckId ?? ''}>
                <option value="">Any</option>
                {trucks.map((truck) => (
                  <option key={truck.id} value={truck.id}>
                    {truck.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex gap-2">
              <button type="submit" className={buttonClass({ variant: 'primary' })}>
                Show
              </button>
              <Link href={base} className={buttonClass()}>
                Clear
              </Link>
            </div>
          </form>
          {dates.length === 0 ? (
            <EmptyState title="No appointments in these days">
              Book one from an order, or change the dates above.
            </EmptyState>
          ) : (
            dates.map((date) => {
              const rows = schedule.rows.filter((row) => row.date === date);
              return (
                <section key={date}>
                  <h2 className="border-b border-zinc-200 bg-zinc-50 px-4 py-1.5 text-xs font-semibold text-zinc-700">
                    {formatWeekday(date)}
                    {date === today ? ' · today' : ''}
                    <span className="ml-2 font-normal text-zinc-500">
                      {rows.length} appointment{rows.length === 1 ? '' : 's'}
                    </span>
                  </h2>
                  <ul className="divide-y divide-zinc-200 border-b border-zinc-200">
                    {rows.map((row) => (
                      <AppointmentRow
                        key={row.appointment.id}
                        ctx={ctx}
                        visit={row}
                        trucks={activeTrucks}
                        earliest={earliest}
                        heading={
                          <>
                            {row.customerName}
                            {row.orderNumber && row.detail.orderId ? (
                              <>
                                {' · '}
                                <Link
                                  href={`${basePath}/orders/${row.detail.orderId}`}
                                  className="underline underline-offset-2"
                                >
                                  Order {row.orderNumber}
                                </Link>
                              </>
                            ) : null}
                          </>
                        }
                      />
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </Card>

        <Card
          title="Unavailability"
          description="Times when appointments cannot be booked. Appointments that already exist are not changed."
          flush
        >
          {blocks.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">Nothing is blocked.</p>
          ) : (
            <ul className="divide-y divide-zinc-200">
              {blocks.map((block) => (
                <li
                  key={block.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <span>
                    <span className="font-medium text-zinc-900">
                      {block.reason || 'Unavailable'}
                    </span>
                    <span className="block text-zinc-600">
                      {formatDateTime(block.startsAt)} to {formatDateTime(block.endsAt)} ·{' '}
                      {block.buildings.length > 0 ? block.buildings.join(', ') : 'every location'}
                    </span>
                  </span>
                  {canWrite ? (
                    <ConfirmButton
                      action={removeBlockAction.bind(
                        null,
                        ctx.business.slug,
                        ctx.environment,
                        block.id,
                      )}
                      confirmTitle="Lift this unavailability?"
                      confirmBody="Appointments can be booked in this time again."
                      confirmLabel="Lift"
                    >
                      Lift
                    </ConfirmButton>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canWrite ? (
            <Disclosure summary="Block a time">
              <ActionForm
                action={createBlockAction.bind(null, ctx.business.slug, ctx.environment)}
                submitLabel="Block these times"
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="First day" htmlFor="b-start">
                    <input
                      id="b-start"
                      name="startDate"
                      type="date"
                      required
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Last day" htmlFor="b-end" help="Empty = one day.">
                    <input id="b-end" name="endDate" type="date" className={inputClass} />
                  </Field>
                  <Field label="Reason" htmlFor="b-reason">
                    <input
                      id="b-reason"
                      name="reason"
                      required
                      maxLength={200}
                      placeholder="Slope Day, staff training…"
                      className={inputClass}
                    />
                  </Field>
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-xs font-medium text-zinc-700">Times</legend>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    <Check name="allDay" label="All day" />
                    {TIME_SLOTS.map((slot) => (
                      <Check key={slot.key} name="slots" value={slot.key} label={slot.label} />
                    ))}
                  </div>
                </fieldset>
                {places ? (
                  <Field
                    label="Only these buildings"
                    htmlFor="b-buildings"
                    help="Leave empty to block every location. Hold Ctrl or ⌘ to choose several."
                  >
                    <select
                      id="b-buildings"
                      name="buildingIds"
                      multiple
                      size={6}
                      className={cn(inputClass, 'h-auto py-1')}
                    >
                      {places.regions.map((region) => (
                        <optgroup key={region.id} label={region.name}>
                          {places.buildings
                            .filter((building) => building.regionId === region.id)
                            .map((building) => (
                              <option key={building.id} value={building.id}>
                                {building.name}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                  </Field>
                ) : null}
              </ActionForm>
            </Disclosure>
          ) : null}
        </Card>
      </div>
    </>
  );
}
