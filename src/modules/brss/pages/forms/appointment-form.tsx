'use client';

/**
 * The form for booking an appointment. A client component because the building list
 * depends on the region chosen. Every rule is checked again on the server.
 */
import { useState } from 'react';
import { ActionForm, type ActionResult } from '@/ui/action-form';
import { Field, inputClass } from '@/ui/layout';
import { APPOINTMENT_TYPES, TIME_SLOTS } from '../../rules';

export type Place = { id: string; name: string };

export function WhenFields({
  idPrefix,
  earliest,
  canOverride,
  defaultDate,
  defaultSlot,
}: {
  idPrefix: string;
  /** The first day that can be booked without an override. */
  earliest: string;
  canOverride: boolean;
  defaultDate?: string;
  defaultSlot?: string;
}) {
  const [override, setOverride] = useState(false);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Date"
          htmlFor={`${idPrefix}-date`}
          help={`First day open for booking: ${earliest}.`}
        >
          <input
            id={`${idPrefix}-date`}
            name="date"
            type="date"
            required
            defaultValue={defaultDate}
            className={inputClass}
          />
        </Field>
        <Field label="Time" htmlFor={`${idPrefix}-slot`}>
          <select
            id={`${idPrefix}-slot`}
            name="slot"
            defaultValue={defaultSlot ?? TIME_SLOTS[0].key}
            className={inputClass}
          >
            {TIME_SLOTS.map((slot) => (
              <option key={slot.key} value={slot.key}>
                {slot.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {canOverride ? (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-zinc-800">
            <input
              type="checkbox"
              name="override"
              checked={override}
              onChange={(event) => setOverride(event.target.checked)}
              className="size-4 rounded border-zinc-300"
            />
            Book anyway if the time is blocked or at short notice
          </label>
          {override ? (
            <Field
              label="Why"
              htmlFor={`${idPrefix}-why`}
              help="Kept with the appointment and in the activity log."
            >
              <input
                id={`${idPrefix}-why`}
                name="overrideReason"
                required
                maxLength={300}
                className={inputClass}
              />
            </Field>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function AppointmentForm({
  action,
  regions,
  buildings,
  trucks,
  earliest,
  canOverride,
  defaultPhone,
}: {
  action: (previous: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  regions: Place[];
  buildings: (Place & { regionId: string })[];
  trucks: Place[];
  earliest: string;
  canOverride: boolean;
  defaultPhone?: string;
}) {
  const [regionId, setRegionId] = useState(regions[0]?.id ?? '');
  const inRegion = buildings.filter((building) => building.regionId === regionId);
  const needsAddress = inRegion.length === 0;

  return (
    <ActionForm action={action} submitLabel="Book appointment">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind of appointment" htmlFor="appt-type">
          <select id="appt-type" name="type" className={inputClass}>
            {APPOINTMENT_TYPES.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Phone" htmlFor="appt-phone">
          <input
            id="appt-phone"
            name="phone"
            type="tel"
            required
            maxLength={40}
            defaultValue={defaultPhone}
            className={inputClass}
          />
        </Field>
      </div>
      <WhenFields idPrefix="appt" earliest={earliest} canOverride={canOverride} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Region" htmlFor="appt-region">
          <select
            id="appt-region"
            name="regionId"
            value={regionId}
            onChange={(event) => setRegionId(event.target.value)}
            className={inputClass}
          >
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.name}
              </option>
            ))}
          </select>
        </Field>
        {needsAddress ? null : (
          <Field label="Building" htmlFor="appt-building">
            <select id="appt-building" name="buildingId" required className={inputClass}>
              <option value="">Choose…</option>
              {inRegion.map((building) => (
                <option key={building.id} value={building.id}>
                  {building.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Room or apartment" htmlFor="appt-room">
          <input id="appt-room" name="room" maxLength={20} className={inputClass} />
        </Field>
      </div>
      {needsAddress ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Street address" htmlFor="appt-address1" className="sm:col-span-2">
            <input
              id="appt-address1"
              name="address1"
              required
              maxLength={200}
              className={inputClass}
            />
          </Field>
          <Field label="City" htmlFor="appt-city">
            <input id="appt-city" name="city" required maxLength={80} className={inputClass} />
          </Field>
          <Field label="Zip" htmlFor="appt-zip">
            <input id="appt-zip" name="zip" required maxLength={10} className={inputClass} />
          </Field>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Boxes (estimate)" htmlFor="appt-boxes">
          <input
            id="appt-boxes"
            name="estimatedBoxes"
            type="number"
            min="0"
            max="999"
            className={inputClass}
          />
        </Field>
        <Field label="Other items (estimate)" htmlFor="appt-items">
          <input
            id="appt-items"
            name="estimatedOtherItems"
            type="number"
            min="0"
            max="999"
            className={inputClass}
          />
        </Field>
        <Field label="Packing hours" htmlFor="appt-hours">
          <input
            id="appt-hours"
            name="packingHours"
            type="number"
            min="0"
            max="99"
            className={inputClass}
          />
        </Field>
        <Field label="Truck" htmlFor="appt-truck">
          <select id="appt-truck" name="truckId" className={inputClass}>
            <option value="">Not assigned yet</option>
            {trucks.map((truck) => (
              <option key={truck.id} value={truck.id}>
                {truck.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-800">
        <input type="checkbox" name="hasElevator" className="size-4 rounded border-zinc-300" />
        The building has an elevator
      </label>
      <Field label="Notes" htmlFor="appt-notes">
        <input id="appt-notes" name="notes" maxLength={2000} className={inputClass} />
      </Field>
    </ActionForm>
  );
}
