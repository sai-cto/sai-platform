/** The handful of numbers shown on the business's Overview tab. */
import { and, eq, gte, inArray, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import { appointments } from '@/core/db/schema/tenant';
import type { Scope } from '@/core/db/scope';
import { brssAppointments, brssArticles, brssOrderItems, brssOrders } from '../schema';

/**
 * Counts only; no permission check of its own. Each widget in the manifest names the
 * permission needed to see its number, and the platform checks that before calling it.
 */
export async function openWorkSummary(s: Scope) {
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [[orders], [unpaid], [articles], [visits]] = await Promise.all([
    s.db
      .select({ n: sql<number>`count(*)::int` })
      .from(brssOrders)
      .where(and(s.where(brssOrders), inArray(brssOrders.status, ['open', 'activated']))),
    s.db
      .select({
        cents: sql<number>`coalesce(sum(${brssOrderItems.unitPriceCents} * ${brssOrderItems.quantity}), 0)::int`,
      })
      .from(brssOrderItems)
      .innerJoin(brssOrders, eq(brssOrders.id, brssOrderItems.orderId))
      .where(
        and(
          s.where(brssOrderItems),
          s.where(brssOrders),
          eq(brssOrderItems.status, 'new'),
          inArray(brssOrders.status, ['open', 'activated']),
        ),
      ),
    s.db
      .select({
        held: sql<number>`count(*)::int`,
        unplaced: sql<number>`count(*) filter (where ${brssArticles.warehouseId} is null)::int`,
      })
      .from(brssArticles)
      .where(
        and(
          s.where(brssArticles),
          or(isNull(brssArticles.status), notInArray(brssArticles.status, ['delivered', 'shipped'])),
        ),
      ),
    s.db
      .select({
        total: sql<number>`count(*)::int`,
        unconfirmed: sql<number>`count(*) filter (where ${appointments.status} = 'unconfirmed')::int`,
      })
      .from(brssAppointments)
      .innerJoin(appointments, eq(appointments.id, brssAppointments.appointmentId))
      .where(
        and(
          s.where(brssAppointments),
          s.where(appointments),
          gte(appointments.startsAt, now),
          lt(appointments.startsAt, weekAhead),
          ne(appointments.status, 'canceled'),
        ),
      ),
  ]);
  return {
    activeOrders: Number(orders?.n ?? 0),
    unpaidCents: Number(unpaid?.cents ?? 0),
    articlesHeld: Number(articles?.held ?? 0),
    articlesWithoutLocation: Number(articles?.unplaced ?? 0),
    appointmentsNext7Days: Number(visits?.total ?? 0),
    unconfirmedNext7Days: Number(visits?.unconfirmed ?? 0),
  };
}
