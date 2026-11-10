/**
 * Orders: the dashboard list, one order with everything attached to it, creating and
 * changing an order, and moving it through its statuses.
 */
import { and, asc, desc, eq, gte, ilike, inArray, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { appointments, customers, payments, refunds, resources } from '@/core/db/schema/tenant';
import { withScope, type Scope } from '@/core/db/scope';
import { NotFoundError, ValidationError } from '@/core/errors';
import { isUuid } from '@/core/ids';
import { can } from '@/core/rbac/permissions';
import { appointmentEntity, customerEntity, customerName } from '@/core/records/core-entities';
import { nextRecordNumber } from '@/core/records/numbering';
import { createRecord, listRecords, updateRecord } from '@/core/records/records';
import type { BusinessContext } from '@/core/tenancy/context';
import { articleEntity, orderEntity } from '../entities';
import { CORE, P } from '../permissions';
import {
  ORDER_SERVICES,
  ORDER_STATUSES,
  canCancelOrder,
  findZone,
  isDateText,
  localTime,
  storageExpirationDate,
  subtotalCents,
} from '../rules';
import {
  brssAppointments,
  brssArticles,
  brssBuildings,
  brssOrderArticles,
  brssOrderItems,
  brssOrders,
  brssProducts,
  brssRegions,
  brssWarehouses,
  brssZipZones,
  type OrderService,
  type OrderStatus,
} from '../schema';
import { recalculateCharges } from './charges';
import { optionalId, optionalText, parse, requiredText } from './input';

export const ORDERS_PAGE_SIZE = 25;

/** The order in which one article's charges are listed. */
const CHARGE_ORDER: string[] = ['storage', 'ship_to_home', 'ship_to_cornell_fee', 'ship_to_cornell', 'insurance'];

// ---------------------------------------------------------------- the dashboard

export type OrderFilters = {
  /** "active" = open or activated (the default view). */
  status?: OrderStatus | 'active' | 'all';
  service?: OrderService;
  campus?: 'on_campus' | 'off_campus' | 'counter';
  regionId?: string;
  /** Placed on or after / on or before this day (the business's time zone). */
  from?: string;
  to?: string;
  q?: string;
  page?: number;
};

function orderConditions(s: Scope, filters: OrderFilters): SQL | undefined {
  const timeZone = s.ctx.business.timeZone;
  const status = filters.status ?? 'active';
  const term = filters.q?.trim();
  const pattern = term ? `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  return and(
    status === 'all'
      ? undefined
      : status === 'active'
        ? inArray(brssOrders.status, ['open', 'activated'])
        : eq(brssOrders.status, status),
    filters.service ? sql`${filters.service} = any(${brssOrders.services})` : undefined,
    filters.campus ? eq(brssOrders.campusCategory, filters.campus) : undefined,
    // Region lives on appointments (R-SCH-194): an order matches if any of its appointments is there.
    filters.regionId && isUuid(filters.regionId)
      ? inArray(
          brssOrders.id,
          s.db
            .select({ id: brssAppointments.orderId })
            .from(brssAppointments)
            .where(
              and(s.where(brssAppointments), eq(brssAppointments.regionId, filters.regionId)),
            ),
        )
      : undefined,
    filters.from && isDateText(filters.from)
      ? gte(brssOrders.createdAt, localTime(filters.from, 0, timeZone))
      : undefined,
    filters.to && isDateText(filters.to)
      ? lt(brssOrders.createdAt, localTime(filters.to, 24, timeZone))
      : undefined,
    pattern
      ? or(
          ilike(brssOrders.orderNumber, pattern),
          ilike(brssOrders.netId, pattern),
          inArray(
            brssOrders.customerId,
            s.db
              .select({ id: customers.id })
              .from(customers)
              .where(
                and(
                  s.where(customers, 'include'),
                  or(
                    ilike(sql`${customers.firstName} || ' ' || ${customers.lastName}`, pattern),
                    ilike(customers.email, pattern),
                  ),
                ),
              ),
          ),
        )
      : undefined,
  );
}

export type OrderListRow = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  services: OrderService[];
  campusCategory: string | null;
  customerName: string;
  createdAt: Date;
  articleCount: number;
  totalCents: number;
  unpaidCents: number;
  storageExpires: string | null;
  deliveryScheduled: boolean;
  nextAppointment: { startsAt: Date; type: string; status: string } | null;
};

export async function listOrders(ctx: BusinessContext, filters: OrderFilters = {}) {
  return withScope(ctx, P.ordersRead, async (s) => {
    const page = Math.max(1, filters.page ?? 1);
    const { rows: orders, total } = await listRecords(s, orderEntity, {
      where: orderConditions(s, filters),
      limit: ORDERS_PAGE_SIZE,
      offset: (page - 1) * ORDERS_PAGE_SIZE,
    });
    const ids = orders.map((o) => o.id);
    if (ids.length === 0) return { rows: [] as OrderListRow[], total, page };

    const [people, articleCounts, items, visits] = await Promise.all([
      s.db
        .select()
        .from(customers)
        .where(
          and(
            s.where(customers, 'include'),
            inArray(
              customers.id,
              orders.map((o) => o.customerId),
            ),
          ),
        ),
      s.db
        .select({ orderId: brssOrderArticles.orderId, n: sql<number>`count(*)::int` })
        .from(brssOrderArticles)
        .where(and(s.where(brssOrderArticles), inArray(brssOrderArticles.orderId, ids)))
        .groupBy(brssOrderArticles.orderId),
      s.db
        .select({
          orderId: brssOrderItems.orderId,
          status: brssOrderItems.status,
          unitPriceCents: brssOrderItems.unitPriceCents,
          quantity: brssOrderItems.quantity,
        })
        .from(brssOrderItems)
        .where(and(s.where(brssOrderItems), inArray(brssOrderItems.orderId, ids))),
      // Appointments need their own permission; without it the column stays empty.
      can(ctx, CORE.schedulingRead)
        ? s.db
            .select({
              orderId: brssAppointments.orderId,
              type: brssAppointments.type,
              startsAt: appointments.startsAt,
              status: appointments.status,
            })
            .from(brssAppointments)
            .innerJoin(appointments, eq(appointments.id, brssAppointments.appointmentId))
            .where(
              and(
                s.where(brssAppointments),
                s.where(appointments),
                inArray(brssAppointments.orderId, ids),
                ne(appointments.status, 'canceled'),
              ),
            )
            .orderBy(asc(appointments.startsAt))
        : [],
    ]);

    const showNames = can(ctx, CORE.customersRead);
    const now = new Date();
    const rows: OrderListRow[] = orders.map((order) => {
      const lines = items.filter((i) => i.orderId === order.id);
      const own = visits.filter((v) => v.orderId === order.id);
      const person = people.find((c) => c.id === order.customerId);
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        services: order.services,
        campusCategory: order.campusCategory,
        customerName: showNames && person ? customerName(person) : '—',
        createdAt: order.createdAt,
        articleCount: articleCounts.find((a) => a.orderId === order.id)?.n ?? 0,
        totalCents: subtotalCents(lines),
        unpaidCents: subtotalCents(lines.filter((l) => l.status === 'new')),
        storageExpires: storageExpirationDate(order.storageEffectiveDate, order.storageTermMonths),
        deliveryScheduled: own.some((v) => v.type === 'delivery'),
        nextAppointment:
          own.find((v) => v.startsAt >= now && v.status !== 'completed') ?? own.at(-1) ?? null,
      };
    });
    return { rows, total, page };
  });
}

/** The numbers above the dashboard table. */
export async function orderCounts(ctx: BusinessContext) {
  return withScope(ctx, P.ordersRead, async (s) => {
    const byStatus = await s.db
      .select({ status: brssOrders.status, n: sql<number>`count(*)::int` })
      .from(brssOrders)
      .where(s.where(brssOrders))
      .groupBy(brssOrders.status);
    const [unpaid] = await s.db
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
      );
    const count = (status: OrderStatus) => byStatus.find((r) => r.status === status)?.n ?? 0;
    return {
      open: count('open'),
      activated: count('activated'),
      closed: count('closed'),
      cancelled: count('cancelled'),
      unpaidCents: Number(unpaid?.cents ?? 0),
    };
  });
}

// ---------------------------------------------------------------- one order

async function findOrder(s: Scope, id: string) {
  if (!isUuid(id)) throw new NotFoundError();
  const [order] = await s.db
    .select()
    .from(brssOrders)
    .where(and(s.where(brssOrders), eq(brssOrders.id, id)))
    .limit(1);
  if (!order) throw new NotFoundError();
  return order;
}

/**
 * One order with everything on its page. Each part needs its own permission; a part the
 * person may not see comes back as null and the page says so.
 */
export async function getOrder(ctx: BusinessContext, id: string) {
  return withScope(ctx, P.ordersRead, async (s) => {
    const order = await findOrder(s, id);

    const [customer] = can(ctx, CORE.customersRead)
      ? await s.db
          .select()
          .from(customers)
          .where(and(s.where(customers, 'include'), eq(customers.id, order.customerId)))
          .limit(1)
      : [];

    // Charges in a steady order: article by article (in article-number order), each article's
    // charges in the order of CHARGE_ORDER, then the charges added by hand, oldest first.
    const items = await s.db
      .select({ item: brssOrderItems, articleNumber: brssArticles.articleNumber })
      .from(brssOrderItems)
      .leftJoin(brssArticles, eq(brssArticles.id, brssOrderItems.articleId))
      .where(and(s.where(brssOrderItems), eq(brssOrderItems.orderId, id)))
      .orderBy(asc(brssOrderItems.createdAt), asc(brssOrderItems.id))
      .then((rows) =>
        rows
          .sort(
            (a, b) =>
              (a.articleNumber ?? '~').localeCompare(b.articleNumber ?? '~') ||
              CHARGE_ORDER.indexOf(a.item.rule ?? '') - CHARGE_ORDER.indexOf(b.item.rule ?? ''),
          )
          .map((row) => row.item),
      );

    const articles = can(ctx, P.articlesRead)
      ? await s.db
          .select({
            linkId: brssOrderArticles.id,
            cornellShippingAccount: brssOrderArticles.cornellShippingAccount,
            receivedFromZip: brssOrderArticles.receivedFromZip,
            article: brssArticles,
            productName: brssProducts.name,
            warehouseName: brssWarehouses.name,
          })
          .from(brssOrderArticles)
          .innerJoin(brssArticles, eq(brssArticles.id, brssOrderArticles.articleId))
          .leftJoin(brssProducts, eq(brssProducts.id, brssArticles.productId))
          .leftJoin(brssWarehouses, eq(brssWarehouses.id, brssArticles.warehouseId))
          .where(and(s.where(brssOrderArticles), eq(brssOrderArticles.orderId, id)))
          .orderBy(asc(brssArticles.articleNumber))
      : null;

    const paid = can(ctx, CORE.paymentsRead)
      ? await s.db
          .select()
          .from(payments)
          .where(
            and(
              s.where(payments),
              eq(payments.subjectType, orderEntity.key),
              eq(payments.subjectId, id),
            ),
          )
          .orderBy(desc(payments.createdAt))
      : null;
    const refunded =
      paid && paid.length > 0
        ? await s.db
            .select()
            .from(refunds)
            .where(
              and(
                s.where(refunds),
                inArray(
                  refunds.paymentId,
                  paid.map((p) => p.id),
                ),
              ),
            )
            .orderBy(desc(refunds.createdAt))
        : [];

    const visits = can(ctx, CORE.schedulingRead)
      ? await s.db
          .select({
            appointment: appointments,
            detail: brssAppointments,
            truckName: resources.name,
            regionName: brssRegions.name,
            buildingName: brssBuildings.name,
          })
          .from(brssAppointments)
          .innerJoin(appointments, eq(appointments.id, brssAppointments.appointmentId))
          .leftJoin(resources, eq(resources.id, appointments.resourceId))
          .leftJoin(brssRegions, eq(brssRegions.id, brssAppointments.regionId))
          .leftJoin(brssBuildings, eq(brssBuildings.id, brssAppointments.buildingId))
          .where(
            and(s.where(brssAppointments), s.where(appointments), eq(brssAppointments.orderId, id)),
          )
          .orderBy(asc(appointments.startsAt))
      : null;

    return {
      order,
      customer: customer ?? null,
      items,
      articles,
      payments: paid,
      refunds: refunded,
      appointments: visits,
      storageExpires: storageExpirationDate(order.storageEffectiveDate, order.storageTermMonths),
    };
  });
}

export type OrderDetail = Awaited<ReturnType<typeof getOrder>>;

// ---------------------------------------------------------------- creating and changing

const serviceKeys = ORDER_SERVICES.map((s) => s.key) as [OrderService, ...OrderService[]];

const orderFields = z.object({
  services: z.array(z.enum(serviceKeys)).min(1, 'Choose at least one service'),
  storageTermMonths: z.coerce.number().int().min(1).max(99).nullish(),
  netId: optionalText(100),
  counter: z.boolean().default(false),
  shipToName: optionalText(120),
  shipToAddress1: optionalText(200),
  shipToAddress2: optionalText(200),
  shipToCity: optionalText(80),
  shipToState: optionalText(40),
  shipToZip: optionalText(10),
  notes: optionalText(2000),
});

const newCustomer = z.object({
  firstName: requiredText("the customer's first name", 80),
  lastName: requiredText("the customer's last name", 80),
  email: z.union([z.literal(''), z.string().trim().email('That email address is not valid')]),
  phone: optionalText(40),
});

type OrderFields = z.infer<typeof orderFields>;

/** What must be filled in for the services chosen. */
function checkOrderFields(v: OrderFields): void {
  const services = [...new Set(v.services)];
  // R-ORD-010: one shipping direction per order.
  if (services.includes('ship_to_home') && services.includes('ship_to_cornell'))
    throw new ValidationError(
      'An order ships to home or to Cornell, not both. Make a second order.',
    );
  // R-ORD-084, R-SCH-170: a storage order needs its term.
  if (services.includes('storage') && !v.storageTermMonths)
    throw new ValidationError('Choose a storage term.');
  // R-SCH-169: a ship-to-home order needs the destination.
  if (
    services.includes('ship_to_home') &&
    !(v.shipToName && v.shipToAddress1 && v.shipToCity && v.shipToState && v.shipToZip)
  )
    throw new ValidationError(
      'A ship-to-home order needs who it is addressed to, the street address, city, state and zip.',
    );
}

/** R-ORD-009: the zone is looked up from the first three digits of the zip, every time the zip is saved. */
async function zoneFor(s: Scope, zip: string | null): Promise<number | null> {
  const zipZones = await s.db.select().from(brssZipZones).where(s.where(brssZipZones));
  return findZone(zipZones, zip);
}

function orderValues(v: OrderFields, shipToZone: number | null) {
  const storage = v.services.includes('storage');
  return {
    services: [...new Set(v.services)],
    storageTermMonths: storage ? (v.storageTermMonths ?? null) : null,
    netId: v.netId,
    shipToName: v.shipToName,
    shipToAddress1: v.shipToAddress1,
    shipToAddress2: v.shipToAddress2,
    shipToCity: v.shipToCity,
    shipToState: v.shipToState,
    shipToZip: v.shipToZip,
    shipToZone,
    notes: v.notes,
  };
}

/**
 * Creates an order: status Open (R-ORD-005), for an existing customer or a new one
 * (R-ORD-004: an order always has a customer). Creating a customer needs customers.write.
 */
export async function createOrder(ctx: BusinessContext, raw: Record<string, unknown>) {
  const fields = parse(orderFields, raw);
  checkOrderFields(fields);
  const existingId = parse(optionalId, raw.customerId);
  const person = existingId ? null : parse(newCustomer, raw);
  return withScope(ctx, P.ordersWrite, async (s) => {
    let customerId = existingId;
    if (person) {
      const created = await createRecord(s, customerEntity, {
        kind: 'person',
        firstName: person.firstName,
        lastName: person.lastName,
        email: person.email ? person.email.toLowerCase() : null,
        phone: person.phone,
      });
      customerId = created.id;
    }
    const [orderNumber] = await nextRecordNumber(s, orderEntity, brssOrders.orderNumber, 'O');
    return createRecord(s, orderEntity, {
      ...orderValues(fields, await zoneFor(s, fields.shipToZip)),
      orderNumber,
      customerId: customerId!,
      status: 'open',
      // Q-SCH-40: "Counter" is only ever set by hand. Otherwise the first appointment decides.
      campusCategory: fields.counter ? 'counter' : null,
    });
  });
}

/** Changes an order's details. Charges not yet paid are worked out again afterwards. */
export async function updateOrder(ctx: BusinessContext, id: string, raw: unknown) {
  const fields = parse(orderFields, raw);
  checkOrderFields(fields);
  return withScope(ctx, P.ordersWrite, async (s) => {
    const current = await findOrder(s, id);
    if (current.status === 'closed' || current.status === 'cancelled')
      throw new ValidationError(
        `This order is ${current.status}. Reopen it before changing it.`,
      );
    const order = await updateRecord(s, orderEntity, id, {
      ...orderValues(fields, await zoneFor(s, fields.shipToZip)),
      // The campus category is only touched by the Counter tick box.
      campusCategory: fields.counter
        ? 'counter'
        : current.campusCategory === 'counter'
          ? null
          : current.campusCategory,
    });
    const { problems } = await recalculateCharges(s, id);
    return { order, problems };
  });
}

const statusKeys = ORDER_STATUSES.map((s) => s.key) as [OrderStatus, ...OrderStatus[]];

/**
 * Moves an order to another status. In Salesforce this was a hand edit of the Status field
 * (R-ORD-020, R-ORD-021: no code sets Activated or Closed), so any change is allowed, with
 * two rules attached:
 *  - Cancelled: only an Open order (R-ORD-018); its appointments are cancelled too (R-ORD-019).
 *    Nothing is refunded automatically.
 *  - Closed: every article on the order becomes Delivered (R-ORD-021, R-ORD-077).
 */
export async function setOrderStatus(ctx: BusinessContext, id: string, raw: unknown) {
  const status = parse(z.enum(statusKeys, { message: 'Choose a status' }), raw);
  return withScope(ctx, P.ordersWrite, async (s) => {
    const current = await findOrder(s, id);
    if (current.status === status) return current;

    if (status === 'cancelled') {
      if (!canCancelOrder(current.status))
        throw new ValidationError('Only an open order can be cancelled.');
      const visits = await s.db
        .select({ id: appointments.id, status: appointments.status })
        .from(brssAppointments)
        .innerJoin(appointments, eq(appointments.id, brssAppointments.appointmentId))
        .where(
          and(s.where(brssAppointments), s.where(appointments), eq(brssAppointments.orderId, id)),
        );
      for (const visit of visits) {
        // A visit that already happened stays in the record as it was.
        if (visit.status === 'completed' || visit.status === 'canceled') continue;
        await updateRecord(s, appointmentEntity, visit.id, { status: 'canceled' });
      }
    }

    if (status === 'closed') {
      const linked = await s.db
        .select({ id: brssArticles.id })
        .from(brssOrderArticles)
        .innerJoin(brssArticles, eq(brssArticles.id, brssOrderArticles.articleId))
        .where(
          and(s.where(brssOrderArticles), s.where(brssArticles), eq(brssOrderArticles.orderId, id)),
        );
      for (const article of linked)
        await updateRecord(s, articleEntity, article.id, { status: 'delivered' });
    }

    return updateRecord(s, orderEntity, id, { status });
  });
}

/** Customers to choose from on the new-order form (newest first, optionally searched). */
export async function findCustomers(ctx: BusinessContext, search?: string) {
  return withScope(ctx, CORE.customersRead, async (s) => {
    const { rows } = await listRecords(s, customerEntity, { search, limit: 200 });
    return rows.map((row) => ({ id: row.id, name: customerName(row), email: row.email }));
  });
}
