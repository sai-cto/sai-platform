/**
 * One appointment, with the things staff do to it: change its status, put it on a truck,
 * move it. Used on the order page and on the schedule.
 */
import type { ReactNode } from 'react';
import { can } from '@/core/rbac/permissions';
import type { BusinessContext } from '@/core/tenancy/context';
import { ActionForm } from '@/ui/action-form';
import { Field } from '@/ui/layout';
import { assignTruckAction, rescheduleAction, setAppointmentStatusAction } from '../actions';
import { CORE, P } from '../permissions';
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  TIME_SLOTS,
  labelOf,
  localDate,
  slotOf,
} from '../rules';
import type { brssAppointments } from '../schema';
import type { appointments } from '@/core/db/schema/tenant';
import { WhenFields } from './forms/appointment-form';
import { AppointmentStatusBadge, Select, formatWeekday } from './parts';

export type Visit = {
  appointment: typeof appointments.$inferSelect;
  detail: typeof brssAppointments.$inferSelect;
  truckName: string | null;
  regionName: string | null;
  buildingName: string | null;
};

export function placeText(visit: Visit): string {
  const { detail } = visit;
  const where = visit.buildingName
    ? [visit.regionName, visit.buildingName]
    : [visit.regionName, detail.address1, detail.address2, detail.city, detail.zip];
  return [...where, detail.room ? `Room ${detail.room}` : null].filter(Boolean).join(', ');
}

export function AppointmentRow({
  ctx,
  visit,
  trucks,
  earliest,
  heading,
}: {
  ctx: BusinessContext;
  visit: Visit;
  trucks: { id: string; name: string }[];
  earliest: string;
  /** Extra line under the title (the schedule shows the customer and order here). */
  heading?: ReactNode;
}) {
  const { appointment, detail } = visit;
  const slug = ctx.business.slug;
  const mode = ctx.environment;
  const timeZone = ctx.business.timeZone;
  const date = localDate(appointment.startsAt, timeZone);
  const slot = slotOf(appointment.startsAt, timeZone);
  const canWrite = can(ctx, CORE.schedulingWrite);
  const movable = appointment.status !== 'completed' && appointment.status !== 'canceled';
  const id = appointment.id;

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-zinc-900">
          {labelOf(APPOINTMENT_TYPES, detail.type)} · {formatWeekday(date)}
          {slot ? `, ${labelOf(TIME_SLOTS, slot)}` : ''}
        </span>
        <AppointmentStatusBadge status={appointment.status} />
      </div>
      {heading ? <div className="text-sm text-zinc-700">{heading}</div> : null}
      <p className="text-sm text-zinc-600">
        {placeText(visit) || 'No address'}
        {detail.hasElevator ? ' · elevator' : ''}
        {detail.phone ? ` · ${detail.phone}` : ''}
      </p>
      <p className="text-xs text-zinc-500">
        {visit.truckName ? `Truck: ${visit.truckName}` : 'No truck assigned'}
        {detail.crew.length > 0 ? ` (${detail.crew.map((member) => member.name).join(', ')})` : ''}
        {detail.estimatedBoxes + detail.estimatedOtherItems > 0
          ? ` · about ${detail.estimatedBoxes} boxes, ${detail.estimatedOtherItems} other items`
          : ''}
        {detail.packingHours > 0 ? ` · ${detail.packingHours} h packing` : ''}
      </p>
      {appointment.notes ? <p className="text-xs text-zinc-500">Note: {appointment.notes}</p> : null}
      {detail.overrideReason ? (
        <p className="text-xs text-amber-800">Booked in spite of the rules: {detail.overrideReason}</p>
      ) : null}

      {canWrite ? (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 pt-1">
          <ActionForm
            action={setAppointmentStatusAction.bind(null, slug, mode, id)}
            submitLabel="Save status"
            className="flex flex-wrap items-end gap-2 space-y-0"
            resetOnSuccess={false}
          >
            <Field label="Status" htmlFor={`status-${id}`}>
              <Select id={`status-${id}`} name="status" defaultValue={appointment.status} className="w-40">
                {APPOINTMENT_STATUSES.map((status) => (
                  <option key={status.key} value={status.key}>
                    {status.label}
                  </option>
                ))}
              </Select>
            </Field>
          </ActionForm>
          {movable ? (
            <ActionForm
              action={assignTruckAction.bind(null, slug, mode, id)}
              submitLabel="Save truck"
              className="flex flex-wrap items-end gap-2 space-y-0"
              resetOnSuccess={false}
            >
              <Field label="Truck" htmlFor={`truck-${id}`}>
                <Select id={`truck-${id}`} name="truckId" defaultValue={appointment.resourceId ?? ''} className="w-40">
                  <option value="">Not assigned</option>
                  {trucks.map((truck) => (
                    <option key={truck.id} value={truck.id}>
                      {truck.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </ActionForm>
          ) : null}
        </div>
      ) : null}
      {canWrite && movable ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-600 select-none hover:text-zinc-900">
            Move to another date or time
          </summary>
          <div className="mt-2 max-w-xl">
            <ActionForm
              action={rescheduleAction.bind(null, slug, mode, id)}
              submitLabel="Move appointment"
              resetOnSuccess={false}
            >
              <WhenFields
                idPrefix={`move-${id}`}
                earliest={earliest}
                canOverride={can(ctx, P.appointmentsOverride)}
                defaultDate={date}
                defaultSlot={slot ?? undefined}
              />
            </ActionForm>
          </div>
        </details>
      ) : null}
    </li>
  );
}
