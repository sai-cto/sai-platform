/**
 * Scheduling: appointments (pickup, delivery, packing, supplies), unavailability, and the
 * trucks and crews that carry them out. Built on the core's appointments, resources and
 * unavailability; BRSS's extra facts live in its own tables beside them.
 *
 * KI-6 (not copied): the old system checked lead time and unavailability only in the
 * customer's browser. Here the server checks them every time.
 */
import { and, asc, eq, gt, gte, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { appointments, customers, resources, unavailability } from '@/core/db/schema/tenant';
import { withScope, type Scope } from '@/core/db/scope';
import { NotFoundError, ValidationError } from '@/core/errors';
import { isUuid } from '@/core/ids';
import { sendNotification } from '@/core/notifications/notifications';
import { authorize, can } from '@/core/rbac/permissions';
import {
  appointmentEntity,
  customerName,
  resourceEntity,
  unavailabilityEntity,
} from '@/core/records/core-entities';
import { archiveRecord, createRecord, updateRecord } from '@/core/records/records';
import {
  bookAppointment as coreBook,
  rescheduleAppointment as coreReschedule,
} from '@/core/scheduling/scheduling';
import type { BusinessContext } from '@/core/tenancy/context';
import {
  appointmentDetailEntity,
  blockBuildingEntity,
  orderEntity,
  truckCrewEntity,
} from '../entities';
import { CORE, P } from '../permissions';
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  TIME_SLOTS,
  addDays,
  blockApplies,
  blockRanges,
  campusCategoryFor,
  earliestBookableDate,
  isDateText,
  isOrderActive,
  isSlotKey,
  labelOf,
  localDate,
  localTime,
  sendsConfirmationEmail,
  slotOf,
  slotRange,
  type AppointmentStatus,
  type SlotKey,
} from '../rules';
import {
  brssAppointments,
  brssBlockBuildings,
  brssBuildings,
  brssOrders,
  brssRegions,
  brssTruckCrew,
  type AppointmentType,
  type CrewMember,
} from '../schema';
import { loadSettings } from '../settings';
import { dateText, optionalId, optionalText, parse, requiredId, requiredText } from './input';

// ---------------------------------------------------------------- is the time free?

const whenInput = z.object({
  date: dateText('the date'),
  slot: z.string().refine(isSlotKey, 'Choose a time'),
  /** Ticked by someone with the override permission to book in spite of the rules below. */
  override: z.boolean().default(false),
  overrideReason: optionalText(300),
});

/**
 * Checks a date and time window against the booking rules:
 *  - never in the past;
 *  - R-SCH-026: not sooner than today plus the lead days;
 *  - R-SCH-060 to R-SCH-066: not inside an unavailability that applies to the building
 *    (or to the truck, or to everywhere).
 * The last two can be overridden by someone holding "book at a blocked time or at short
 * notice"; they must say why, and the reason is stored on the appointment and in the log.
 * Returns the reason when an override was used, otherwise null.
 */
async function checkTime(
  s: Scope,
  input: z.infer<typeof whenInput>,
  place: { buildingId: string | null; truckId: string | null },
): Promise<{ startsAt: Date; endsAt: Date; overrideReason: string | null }> {
  const timeZone = s.ctx.business.timeZone;
  const settings = await loadSettings(s.ctx);
  const today = localDate(new Date(), timeZone);
  const range = slotRange(input.date, input.slot as SlotKey, timeZone);
  if (input.date < today) throw new ValidationError('That date is in the past.');

  const reasons: string[] = [];
  const earliest = earliestBookableDate(today, settings.appointmentLeadDays);
  if (input.date < earliest)
    reasons.push(
      `Appointments need ${settings.appointmentLeadDays} days' notice (the first open day is ${earliest}).`,
    );

  const blocks = await s.db
    .select()
    .from(unavailability)
    .where(
      and(
        s.where(unavailability),
        lt(unavailability.startsAt, range.endsAt),
        gt(unavailability.endsAt, range.startsAt),
        place.truckId
          ? or(isNull(unavailability.resourceId), eq(unavailability.resourceId, place.truckId))
          : isNull(unavailability.resourceId),
      ),
    );
  if (blocks.length > 0) {
    const limits = await s.db
      .select()
      .from(brssBlockBuildings)
      .where(
        and(
          s.where(brssBlockBuildings),
          inArray(
            brssBlockBuildings.unavailabilityId,
            blocks.map((b) => b.id),
          ),
        ),
      );
    const hit = blocks.find((block) =>
      blockApplies(
        limits.filter((l) => l.unavailabilityId === block.id).map((l) => l.buildingId),
        place.buildingId,
      ),
    );
    if (hit) reasons.push(`That time is blocked${hit.reason ? `: ${hit.reason}` : ''}.`);
  }

  if (reasons.length === 0) return { ...range, overrideReason: null };
  if (!input.override)
    throw new ValidationError(
      `${reasons.join(' ')}${can(s.ctx, P.appointmentsOverride) ? ' To book it anyway, tick "Book anyway" and say why.' : ' Choose another time.'}`,
    );
  authorize(s.ctx, P.appointmentsOverride);
  if (!input.overrideReason)
    throw new ValidationError('Say why this is being booked in spite of the rules.');
  return { ...range, overrideReason: `${input.overrideReason} (${reasons.join(' ')})` };
}

// ---------------------------------------------------------------- booking

const typeKeys = APPOINTMENT_TYPES.map((t) => t.key) as [AppointmentType, ...AppointmentType[]];

const bookingInput = whenInput.extend({
  orderId: requiredId('an order'),
  type: z.enum(typeKeys, { message: 'Choose the kind of appointment' }),
  regionId: requiredId('a region'),
  buildingId: optionalId,
  address1: optionalText(200),
  address2: optionalText(200),
  room: optionalText(20),
  city: optionalText(80),
  zip: optionalText(10),
  hasElevator: z.boolean().default(false),
  phone: requiredText('a phone number', 40),
  estimatedBoxes: z.coerce.number().int().min(0).max(999).default(0),
  estimatedOtherItems: z.coerce.number().int().min(0).max(999).default(0),
  packingHours: z.coerce.number().int().min(0).max(99).default(0),
  truckId: optionalId,
  notes: optionalText(2000),
});

async function crewOf(s: Scope, truckId: string | null): Promise<CrewMember[]> {
  if (!truckId) return [];
  const crew = await s.db
    .select({ name: brssTruckCrew.name })
    .from(brssTruckCrew)
    .where(and(s.where(brssTruckCrew), eq(brssTruckCrew.truckId, truckId)))
    .orderBy(asc(brssTruckCrew.name));
  return crew;
}

async function assertTruck(s: Scope, truckId: string | null): Promise<void> {
  if (!truckId) return;
  const [truck] = await s.db
    .select({ isActive: resources.isActive })
    .from(resources)
    .where(and(s.where(resources), eq(resources.id, truckId), eq(resources.kind, 'truck')))
    .limit(1);
  if (!truck?.isActive) throw new ValidationError('Choose a truck that is in use.');
}

/**
 * Books an appointment for an order.
 *
 *  - R-SCH-015: it starts Unconfirmed.
 *  - R-SCH-166: a region is needed; the building is needed when the region has buildings,
 *    otherwise the street address, city and zip are needed instead.
 *  - R-ORD-016: the first appointment gives the order its campus category, from the building.
 *  - R-SCH-091: if a truck is chosen, its crew is copied onto the appointment.
 *  - R-SCH-029: there is no limit on how many appointments share a time.
 * Booking changes the order, so it needs the order permission as well as scheduling.
 */
export function bookAppointment(ctx: BusinessContext, raw: unknown) {
  const input = parse(bookingInput, raw);
  authorize(ctx, P.ordersWrite);
  return withScope(ctx, CORE.schedulingWrite, async (s) => {
    const [order] = await s.db
      .select()
      .from(brssOrders)
      .where(and(s.where(brssOrders), eq(brssOrders.id, input.orderId)))
      .limit(1);
    if (!order) throw new NotFoundError();
    if (!isOrderActive(order.status))
      throw new ValidationError(`This order is ${order.status}; appointments cannot be added.`);

    const [region] = await s.db
      .select()
      .from(brssRegions)
      .where(and(s.where(brssRegions), eq(brssRegions.id, input.regionId)))
      .limit(1);
    if (!region) throw new ValidationError('Choose a region from the list.');
    const buildings = await s.db
      .select()
      .from(brssBuildings)
      .where(and(s.where(brssBuildings), eq(brssBuildings.regionId, region.id)));
    const building = buildings.find((b) => b.id === input.buildingId) ?? null;
    if (buildings.length > 0 && !building)
      throw new ValidationError(`Choose a building in ${region.name}.`);
    if (buildings.length === 0 && !(input.address1 && input.city && input.zip))
      throw new ValidationError(
        `${region.name} has no building list, so enter the street address, city and zip.`,
      );

    await assertTruck(s, input.truckId);
    const time = await checkTime(s, input, {
      buildingId: building?.id ?? null,
      truckId: input.truckId,
    });

    // The building-aware check above replaces the core's own (which knows nothing of
    // buildings), so the core is told not to repeat it.
    const appointment = await coreBook(
      s,
      {
        customerId: order.customerId,
        kind: input.type,
        startsAt: time.startsAt,
        endsAt: time.endsAt,
        status: 'unconfirmed',
        resourceId: input.truckId,
        subjectType: orderEntity.key,
        subjectId: order.id,
        notes: input.notes,
      },
      { overrideBlocks: true },
    );
    await createRecord(s, appointmentDetailEntity, {
      appointmentId: appointment.id,
      orderId: order.id,
      type: input.type,
      regionId: region.id,
      buildingId: building?.id ?? null,
      address1: input.address1,
      address2: input.address2,
      room: input.room,
      city: input.city,
      zip: input.zip,
      hasElevator: input.hasElevator,
      phone: input.phone,
      estimatedBoxes: input.estimatedBoxes,
      estimatedOtherItems: input.estimatedOtherItems,
      packingHours: input.packingHours,
      overrideReason: time.overrideReason,
      crew: await crewOf(s, input.truckId),
    });
    if (order.campusCategory === null)
      await updateRecord(s, orderEntity, order.id, {
        campusCategory: campusCategoryFor(building),
      });
    return appointment;
  });
}

async function findVisit(s: Scope, appointmentId: string) {
  if (!isUuid(appointmentId)) throw new NotFoundError();
  const [row] = await s.db
    .select({ appointment: appointments, detail: brssAppointments })
    .from(brssAppointments)
    .innerJoin(appointments, eq(appointments.id, brssAppointments.appointmentId))
    .where(
      and(
        s.where(brssAppointments),
        s.where(appointments),
        eq(brssAppointments.appointmentId, appointmentId),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError();
  return row;
}

/**
 * Moves an appointment to another date or time window, under the same rules as booking.
 * The status is left as it is (the old system reset it only when the CUSTOMER rescheduled
 * online, R-SCH-033; that page is not part of the staff portal).
 */
export function rescheduleAppointment(ctx: BusinessContext, appointmentId: string, raw: unknown) {
  const input = parse(whenInput, raw);
  return withScope(ctx, CORE.schedulingWrite, async (s) => {
    const { appointment, detail } = await findVisit(s, appointmentId);
    if (appointment.status === 'completed' || appointment.status === 'canceled')
      throw new ValidationError('A completed or cancelled appointment cannot be moved.');
    const time = await checkTime(s, input, {
      buildingId: detail.buildingId,
      truckId: appointment.resourceId,
    });
    if (time.overrideReason)
      await updateRecord(s, appointmentDetailEntity, detail.id, {
        overrideReason: time.overrideReason,
      });
    return coreReschedule(
      s,
      appointmentId,
      { startsAt: time.startsAt, endsAt: time.endsAt },
      { overrideBlocks: true },
    );
  });
}

const statusKeys = APPOINTMENT_STATUSES.map((s) => s.key) as [
  AppointmentStatus,
  ...AppointmentStatus[],
];

/**
 * Sets an appointment's status by hand (R-SCH-003: no code in the old system moves an
 * appointment to Confirmed, Truck en route or Completed).
 * R-SCH-036: moving to Confirmed emails the customer for pickup, delivery and supplies
 * appointments. Sending needs the "Send notifications" permission.
 */
export function setAppointmentStatus(ctx: BusinessContext, appointmentId: string, raw: unknown) {
  const status = parse(z.enum(statusKeys, { message: 'Choose a status' }), raw);
  return withScope(ctx, CORE.schedulingWrite, async (s) => {
    const { appointment, detail } = await findVisit(s, appointmentId);
    if (appointment.status === status) return { emailed: null as string | null };
    await updateRecord(s, appointmentEntity, appointmentId, { status });

    if (status !== 'confirmed' || !sendsConfirmationEmail(detail.type))
      return { emailed: null };
    const [customer] = appointment.customerId
      ? await s.db
          .select()
          .from(customers)
          .where(and(s.where(customers, 'include'), eq(customers.id, appointment.customerId)))
          .limit(1)
      : [];
    if (!customer?.email) return { emailed: null };
    if (!can(ctx, 'notifications.write'))
      throw new ValidationError(
        'Confirming emails the customer, which needs the "Send notifications" permission. Ask your business admin.',
      );
    const timeZone = ctx.business.timeZone;
    const slot = slotOf(appointment.startsAt, timeZone);
    const when = `${localDate(appointment.startsAt, timeZone)}, ${slot ? labelOf(TIME_SLOTS, slot) : ''}`;
    const kind = labelOf(APPOINTMENT_TYPES, detail.type).toLowerCase();
    await sendNotification(s, {
      recipient: customer.email,
      subject: `Your ${ctx.business.name} ${kind} is confirmed`,
      body: `Hello ${customerName(customer)},\n\nYour ${kind} appointment is confirmed for ${when}.\n\nIf you need to change it, reply to this email or call us.\n\n${ctx.business.name}`,
      subjectType: appointmentEntity.key,
      subjectId: appointmentId,
    });
    return { emailed: customer.email };
  });
}

/**
 * Puts an appointment on a truck (or takes it off).
 * R-SCH-091, R-SCH-092: the truck's crew is copied onto the appointment as it is now;
 * later changes to the truck's crew do not change appointments already assigned.
 */
export function assignTruck(ctx: BusinessContext, appointmentId: string, raw: unknown) {
  const truckId = parse(optionalId, raw);
  return withScope(ctx, CORE.schedulingWrite, async (s) => {
    const { detail } = await findVisit(s, appointmentId);
    await assertTruck(s, truckId);
    await updateRecord(s, appointmentEntity, appointmentId, { resourceId: truckId });
    await updateRecord(s, appointmentDetailEntity, detail.id, { crew: await crewOf(s, truckId) });
  });
}

// ---------------------------------------------------------------- the schedule

export type ScheduleFilters = {
  from?: string;
  days?: number;
  type?: AppointmentType;
  /** "active" (the default) hides cancelled appointments, like the old "Today → Future" view (R-SCH-084). */
  status?: AppointmentStatus | 'active' | 'all';
  regionId?: string;
  truckId?: string;
};

export function listSchedule(ctx: BusinessContext, filters: ScheduleFilters = {}) {
  return withScope(ctx, CORE.schedulingRead, async (s) => {
    const timeZone = ctx.business.timeZone;
    const from =
      filters.from && isDateText(filters.from) ? filters.from : localDate(new Date(), timeZone);
    const days = Math.min(Math.max(filters.days ?? 14, 1), 92);
    const status = filters.status ?? 'active';
    const rows = await s.db
      .select({
        appointment: appointments,
        detail: brssAppointments,
        orderNumber: brssOrders.orderNumber,
        truckName: resources.name,
        regionName: brssRegions.name,
        buildingName: brssBuildings.name,
        customer: customers,
      })
      .from(brssAppointments)
      .innerJoin(appointments, eq(appointments.id, brssAppointments.appointmentId))
      .leftJoin(brssOrders, eq(brssOrders.id, brssAppointments.orderId))
      .leftJoin(resources, eq(resources.id, appointments.resourceId))
      .leftJoin(brssRegions, eq(brssRegions.id, brssAppointments.regionId))
      .leftJoin(brssBuildings, eq(brssBuildings.id, brssAppointments.buildingId))
      .leftJoin(customers, eq(customers.id, appointments.customerId))
      .where(
        and(
          s.where(brssAppointments),
          s.where(appointments),
          gte(appointments.startsAt, localTime(from, 0, timeZone)),
          lt(appointments.startsAt, localTime(addDays(from, days - 1), 24, timeZone)),
          filters.type ? eq(brssAppointments.type, filters.type) : undefined,
          status === 'all'
            ? undefined
            : status === 'active'
              ? ne(appointments.status, 'canceled')
              : eq(appointments.status, status),
          filters.regionId && isUuid(filters.regionId)
            ? eq(brssAppointments.regionId, filters.regionId)
            : undefined,
          filters.truckId && isUuid(filters.truckId)
            ? eq(appointments.resourceId, filters.truckId)
            : undefined,
        ),
      )
      .orderBy(asc(appointments.startsAt), asc(appointments.id));
    const showNames = can(ctx, CORE.customersRead);
    const showOrders = can(ctx, P.ordersRead);
    return {
      from,
      days,
      rows: rows.map((row) => ({
        appointment: row.appointment,
        detail: row.detail,
        date: localDate(row.appointment.startsAt, timeZone),
        slot: slotOf(row.appointment.startsAt, timeZone),
        orderNumber: showOrders ? row.orderNumber : null,
        truckName: row.truckName,
        regionName: row.regionName,
        buildingName: row.buildingName,
        customerName: showNames && row.customer ? customerName(row.customer) : '—',
      })),
    };
  });
}

// ---------------------------------------------------------------- unavailability

const blockInput = z
  .object({
    startDate: dateText('the first day'),
    endDate: dateText('the last day'),
    allDay: z.boolean().default(false),
    slots: z.array(z.string().refine(isSlotKey, 'Choose times from the list')).default([]),
    buildingIds: z.array(requiredId('buildings from the list')).default([]),
    reason: requiredText('a reason', 200),
  })
  .refine((v) => v.startDate <= v.endDate, 'The last day cannot be before the first day');

/**
 * Blocks appointment times (R-SCH-058): a range of days, either all day or some of the five
 * time windows, for every location or only for some buildings.
 * R-SCH-068: ticking all five windows is the same as all day.
 * R-SCH-067: appointments that already exist are not changed.
 */
export function createBlock(ctx: BusinessContext, raw: unknown) {
  const input = parse(blockInput, raw);
  if (!input.allDay && input.slots.length === 0)
    throw new ValidationError('Tick "All day" or at least one time.'); // R-SCH-070
  if (input.endDate > addDays(input.startDate, 92))
    throw new ValidationError('An unavailability can cover at most three months.');
  const ranges = blockRanges(
    { ...input, slots: input.slots as SlotKey[] },
    ctx.business.timeZone,
  );
  return withScope(ctx, CORE.schedulingWrite, async (s) => {
    if (input.buildingIds.length > 0) {
      const known = await s.db
        .select({ id: brssBuildings.id })
        .from(brssBuildings)
        .where(and(s.where(brssBuildings), inArray(brssBuildings.id, input.buildingIds)));
      if (known.length !== new Set(input.buildingIds).size)
        throw new ValidationError('Choose buildings from the list.');
    }
    for (const range of ranges) {
      const block = await createRecord(s, unavailabilityEntity, {
        resourceId: null,
        startsAt: range.startsAt,
        endsAt: range.endsAt,
        reason: input.reason,
      });
      for (const buildingId of new Set(input.buildingIds))
        await createRecord(s, blockBuildingEntity, { unavailabilityId: block.id, buildingId });
    }
    return ranges.length;
  });
}

/** R-SCH-059: unavailability that has not ended yet, soonest first. */
export function listBlocks(ctx: BusinessContext) {
  return withScope(ctx, CORE.schedulingRead, async (s) => {
    const blocks = await s.db
      .select()
      .from(unavailability)
      .where(and(s.where(unavailability), gte(unavailability.endsAt, new Date())))
      .orderBy(asc(unavailability.startsAt))
      .limit(200);
    const limits =
      blocks.length > 0
        ? await s.db
            .select({
              unavailabilityId: brssBlockBuildings.unavailabilityId,
              buildingName: brssBuildings.name,
            })
            .from(brssBlockBuildings)
            .innerJoin(brssBuildings, eq(brssBuildings.id, brssBlockBuildings.buildingId))
            .where(
              and(
                s.where(brssBlockBuildings),
                inArray(
                  brssBlockBuildings.unavailabilityId,
                  blocks.map((b) => b.id),
                ),
              ),
            )
        : [];
    return blocks.map((block) => ({
      ...block,
      buildings: limits.filter((l) => l.unavailabilityId === block.id).map((l) => l.buildingName),
    }));
  });
}

/** Lifts an unavailability (archived, so it can be restored from the Data tab). */
export function removeBlock(ctx: BusinessContext, id: string) {
  return withScope(ctx, CORE.schedulingWrite, async (s) => {
    if (!isUuid(id)) throw new NotFoundError();
    const limits = await s.db
      .select({ id: brssBlockBuildings.id })
      .from(brssBlockBuildings)
      .where(and(s.where(brssBlockBuildings), eq(brssBlockBuildings.unavailabilityId, id)));
    for (const limit of limits) await archiveRecord(s, blockBuildingEntity, limit.id);
    await archiveRecord(s, unavailabilityEntity, id);
  });
}

// ---------------------------------------------------------------- trucks and crews

/** R-SCH-089: a truck has a name and a crew. It has no capacity, region or schedule of its own. */
export function listTrucks(ctx: BusinessContext) {
  return withScope(ctx, CORE.schedulingRead, async (s) => {
    const trucks = await s.db
      .select()
      .from(resources)
      .where(and(s.where(resources), eq(resources.kind, 'truck')))
      .orderBy(asc(resources.name));
    const crew = await s.db
      .select()
      .from(brssTruckCrew)
      .where(s.where(brssTruckCrew))
      .orderBy(asc(brssTruckCrew.name));
    return trucks.map((truck) => ({
      ...truck,
      crew: crew.filter((member) => member.truckId === truck.id),
    }));
  });
}

export function createTruck(ctx: BusinessContext, raw: unknown) {
  const { name } = parse(z.object({ name: requiredText('a name', 80) }), raw);
  return withScope(ctx, CORE.schedulingWrite, (s) =>
    createRecord(s, resourceEntity, { kind: 'truck', name }),
  );
}

export function setTruckActive(ctx: BusinessContext, id: string, isActive: boolean) {
  return withScope(ctx, CORE.schedulingWrite, async (s) => {
    const [truck] = isUuid(id)
      ? await s.db
          .select({ id: resources.id })
          .from(resources)
          .where(and(s.where(resources), eq(resources.id, id), eq(resources.kind, 'truck')))
          .limit(1)
      : [];
    if (!truck) throw new NotFoundError();
    return updateRecord(s, resourceEntity, id, { isActive });
  });
}

/** Adds someone, by name, to a truck's usual crew. */
export function addCrewMember(ctx: BusinessContext, truckId: string, raw: unknown) {
  const { name } = parse(z.object({ name: requiredText('a name', 120) }), raw);
  return withScope(ctx, CORE.schedulingWrite, async (s) => {
    await assertTruck(s, truckId);
    return createRecord(s, truckCrewEntity, { truckId, name });
  });
}

export function removeCrewMember(ctx: BusinessContext, crewId: string) {
  return withScope(ctx, CORE.schedulingWrite, (s) => archiveRecord(s, truckCrewEntity, crewId));
}
