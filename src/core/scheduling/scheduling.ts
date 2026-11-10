/**
 * Scheduling primitives shared by every module: appointments, resources (trucks, crews,
 * rooms) and unavailability. Modules add their own fields in their own tables.
 *
 * Unavailability is enforced HERE, on the server (see known-issues KI-6).
 */
import { and, asc, eq, gt, gte, isNull, lt, ne, or, type SQL } from 'drizzle-orm';
import { appointments, unavailability } from '../db/schema';
import type { Scope } from '../db/scope';
import { ValidationError } from '../errors';
import { authorize } from '../rbac/permissions';
import { appointmentEntity } from '../records/core-entities';
import { createRecord, getRecord, updateRecord } from '../records/records';
import type { NewValues, Row } from '../records/types';

type TimeRange = { startsAt: Date; endsAt: Date };

function assertRange(range: TimeRange): void {
  if (
    !(range.startsAt instanceof Date) ||
    !(range.endsAt instanceof Date) ||
    Number.isNaN(range.startsAt.getTime()) ||
    Number.isNaN(range.endsAt.getTime())
  ) {
    throw new ValidationError('Enter a valid start and end time.');
  }
  if (range.endsAt <= range.startsAt)
    throw new ValidationError('The end time must be after the start time.');
}

/** Unavailability that overlaps a time range: business-wide blocks plus the given resource's. */
export async function findBlocks(
  s: Scope,
  range: TimeRange & { resourceId?: string | null },
): Promise<Row<typeof unavailability>[]> {
  authorize(s.ctx, 'scheduling.read');
  return blocksFor(s, range);
}

/** The lookup itself, also used when booking (which needs scheduling.write, not .read). */
async function blocksFor(
  s: Scope,
  range: TimeRange & { resourceId?: string | null },
): Promise<Row<typeof unavailability>[]> {
  const forResource: SQL | undefined = range.resourceId
    ? or(isNull(unavailability.resourceId), eq(unavailability.resourceId, range.resourceId))
    : isNull(unavailability.resourceId);
  return s.db
    .select()
    .from(unavailability)
    .where(
      and(
        s.where(unavailability),
        lt(unavailability.startsAt, range.endsAt),
        gt(unavailability.endsAt, range.startsAt),
        forResource,
      ),
    )
    .orderBy(asc(unavailability.startsAt));
}

/** Other active appointments for the same resource that overlap a time range. */
export async function findConflicts(
  s: Scope,
  range: TimeRange & { resourceId: string; excludeAppointmentId?: string },
): Promise<Row<typeof appointments>[]> {
  authorize(s.ctx, 'scheduling.read');
  return s.db
    .select()
    .from(appointments)
    .where(
      and(
        s.where(appointments),
        eq(appointments.resourceId, range.resourceId),
        ne(appointments.status, 'canceled'),
        lt(appointments.startsAt, range.endsAt),
        gt(appointments.endsAt, range.startsAt),
        range.excludeAppointmentId ? ne(appointments.id, range.excludeAppointmentId) : undefined,
      ),
    )
    .orderBy(asc(appointments.startsAt));
}

export async function listAppointments(
  s: Scope,
  range: { from: Date; to: Date },
): Promise<Row<typeof appointments>[]> {
  authorize(s.ctx, 'scheduling.read');
  return s.db
    .select()
    .from(appointments)
    .where(
      and(
        s.where(appointments),
        gte(appointments.startsAt, range.from),
        lt(appointments.startsAt, range.to),
      ),
    )
    .orderBy(asc(appointments.startsAt));
}

async function assertNotBlocked(
  s: Scope,
  range: TimeRange & { resourceId?: string | null },
  override: boolean,
): Promise<void> {
  if (override) return;
  const blocks = await blocksFor(s, range);
  if (blocks.length > 0) {
    throw new ValidationError(
      `That time is blocked: ${blocks[0].reason || 'unavailable'}. Choose another time.`,
    );
  }
}

/**
 * Books an appointment. Refuses a blocked time unless overrideBlocks is true
 * (the caller must check that the person is allowed to override).
 */
export async function bookAppointment(
  s: Scope,
  values: NewValues<typeof appointments>,
  options: { overrideBlocks?: boolean } = {},
): Promise<Row<typeof appointments>> {
  authorize(s.ctx, 'scheduling.write');
  assertRange(values);
  await assertNotBlocked(s, values, options.overrideBlocks ?? false);
  return createRecord(s, appointmentEntity, values);
}

/**
 * Moves an appointment. If no resource is given it stays on its current one, and that
 * resource's unavailability is checked as well as the business-wide blocks.
 */
export async function rescheduleAppointment(
  s: Scope,
  id: string,
  range: TimeRange & { resourceId?: string | null },
  options: { overrideBlocks?: boolean } = {},
): Promise<Row<typeof appointments>> {
  authorize(s.ctx, 'scheduling.write');
  assertRange(range);
  const existing = await getRecord(s, appointmentEntity, id);
  const resourceId = range.resourceId !== undefined ? range.resourceId : existing.resourceId;
  await assertNotBlocked(
    s,
    { startsAt: range.startsAt, endsAt: range.endsAt, resourceId },
    options.overrideBlocks ?? false,
  );
  return updateRecord(s, appointmentEntity, id, {
    startsAt: range.startsAt,
    endsAt: range.endsAt,
    resourceId,
  });
}
