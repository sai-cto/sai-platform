/**
 * One EntityDef per BRSS table, parents before children. Registering a table here puts it in
 * the Data tab (browse, search, export, archive, restore, permanent delete), in test-mode
 * resets, and in the automatic isolation and audit tests.
 */
import { and, eq } from 'drizzle-orm';
import type { Scope } from '@/core/db/scope';
import type { EntityDef } from '@/core/modules/contract';
import { CORE, P } from './permissions';
import {
  brssAppointments,
  brssArticles,
  brssBlockBuildings,
  brssBuildings,
  brssOrderArticles,
  brssOrderItems,
  brssOrders,
  brssProducts,
  brssRegions,
  brssStorageTermProducts,
  brssTruckCrew,
  brssWarehouses,
  brssZipZones,
  brssZoneRates,
} from './schema';

async function orderNotActive(s: Scope, orderId: string): Promise<string | null> {
  const [order] = await s.db.select({ status: brssOrders.status }).from(brssOrders).where(and(s.where(brssOrders, 'include'), eq(brssOrders.id, orderId))).limit(1);
  return order && order.status !== 'open' && order.status !== 'activated' ? 'The order is closed or cancelled: reopen it first.' : null;
}

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
const catalog = { readPermission: P.catalogRead, writePermission: P.catalogWrite };

export const regionEntity: EntityDef<typeof brssRegions> = {
  key: 'brss.region',
  label: 'region',
  labelPlural: 'Regions',
  table: brssRegions,
  ...catalog,
  titleOf: (row) => text(row.name),
  listColumns: [
    { key: 'name', label: 'Name' },
    { key: 'sortOrder', label: 'Order' },
  ],
  searchColumns: ['name'],
};

export const buildingEntity: EntityDef<typeof brssBuildings> = {
  key: 'brss.building',
  label: 'building',
  labelPlural: 'Buildings',
  table: brssBuildings,
  ...catalog,
  titleOf: (row) => text(row.name),
  listColumns: [
    { key: 'name', label: 'Name' },
    { key: 'campusCategory', label: 'Campus category' },
  ],
  searchColumns: ['name'],
};

export const warehouseEntity: EntityDef<typeof brssWarehouses> = {
  key: 'brss.warehouse',
  label: 'warehouse',
  labelPlural: 'Warehouses',
  table: brssWarehouses,
  ...catalog,
  titleOf: (row) => text(row.name),
  listColumns: [
    { key: 'name', label: 'Name' },
    { key: 'isActive', label: 'In use', format: 'boolean' },
  ],
  searchColumns: ['name'],
};

export const productEntity: EntityDef<typeof brssProducts> = {
  key: 'brss.product',
  label: 'product',
  labelPlural: 'Products and prices',
  table: brssProducts,
  ...catalog,
  titleOf: (row) => text(row.name),
  listColumns: [
    { key: 'name', label: 'Name' },
    { key: 'code', label: 'Code' },
    { key: 'kind', label: 'Kind' },
    { key: 'unitPriceCents', label: 'Price', format: 'money' },
    { key: 'isActive', label: 'Active', format: 'boolean' },
  ],
  searchColumns: ['name', 'code', 'description'],
};

export const storageTermEntity: EntityDef<typeof brssStorageTermProducts> = {
  key: 'brss.storage_term',
  label: 'storage term price',
  labelPlural: 'Storage term prices',
  table: brssStorageTermProducts,
  ...catalog,
  titleOf: (row) => `${text(row.termMonths)} months${row.isOverweight ? ', overweight' : ''}`,
  listColumns: [
    { key: 'termMonths', label: 'Term (months)' },
    { key: 'isOverweight', label: 'Overweight', format: 'boolean' },
  ],
  searchColumns: [],
};

export const zipZoneEntity: EntityDef<typeof brssZipZones> = {
  key: 'brss.zip_zone',
  label: 'zip zone',
  labelPlural: 'Zip zones',
  table: brssZipZones,
  ...catalog,
  titleOf: (row) => `Zips ${text(row.zipLow)}–${text(row.zipHigh)} → zone ${text(row.zone)}`,
  listColumns: [
    { key: 'zipLow', label: 'From (first 3 digits)' },
    { key: 'zipHigh', label: 'To (first 3 digits)' },
    { key: 'zone', label: 'Zone' },
  ],
  searchColumns: [],
};

export const zoneRateEntity: EntityDef<typeof brssZoneRates> = {
  key: 'brss.zone_rate',
  label: 'shipping rate',
  labelPlural: 'Shipping rates',
  table: brssZoneRates,
  ...catalog,
  titleOf: (row) => `Zone ${text(row.zone)}, ${text(row.weightLb)} lb`,
  listColumns: [
    { key: 'zone', label: 'Zone' },
    { key: 'weightLb', label: 'Weight (lb)' },
    { key: 'shipHomeCents', label: 'Ship to home', format: 'money' },
    { key: 'shipCornellCents', label: 'Ship to Cornell', format: 'money' },
  ],
  searchColumns: [],
};

export const orderEntity: EntityDef<typeof brssOrders> = {
  key: 'brss.order',
  label: 'order',
  labelPlural: 'Orders',
  table: brssOrders,
  // An order still in progress has articles, charges and appointments hanging off it.
  archiveGuard: async (_s, row) =>
    row.status === 'open' || row.status === 'activated'
      ? 'Close or cancel the order before archiving it.'
      : null,
  readPermission: P.ordersRead,
  writePermission: P.ordersWrite,
  titleOf: (row) => text(row.orderNumber),
  listColumns: [
    { key: 'orderNumber', label: 'Order' },
    { key: 'status', label: 'Status' },
    { key: 'campusCategory', label: 'Campus category' },
    { key: 'storageTermMonths', label: 'Storage term (months)' },
    { key: 'createdAt', label: 'Created', format: 'date' },
  ],
  searchColumns: ['orderNumber', 'netId', 'shipToName', 'notes'],
  // An order belongs to one customer for good; its number never changes.
  immutableFields: ['orderNumber', 'customerId'],
};

export const articleEntity: EntityDef<typeof brssArticles> = {
  key: 'brss.article',
  label: 'article',
  labelPlural: 'Articles',
  table: brssArticles,
  readPermission: P.articlesRead,
  writePermission: P.articlesWrite,
  titleOf: (row) => text(row.articleNumber),
  listColumns: [
    { key: 'articleNumber', label: 'Article' },
    { key: 'type', label: 'Type' },
    { key: 'description', label: 'Description' },
    { key: 'status', label: 'Status' },
    { key: 'billableWeightLb', label: 'Billable weight (lb)' },
    { key: 'createdAt', label: 'Created', format: 'date' },
  ],
  searchColumns: ['articleNumber', 'description'],
  immutableFields: ['articleNumber', 'customerId'],
};

export const orderArticleEntity: EntityDef<typeof brssOrderArticles> = {
  key: 'brss.order_article',
  label: 'article on an order',
  labelPlural: 'Articles on orders',
  table: brssOrderArticles,
  // Same rule as "take off the order" (services/articles.ts detachArticle).
  archiveGuard: async (s, row) => {
    const [paid] = await s.db
      .select({ id: brssOrderItems.id })
      .from(brssOrderItems)
      .where(
        and(
          s.where(brssOrderItems),
          eq(brssOrderItems.orderId, String(row.orderId)),
          eq(brssOrderItems.articleId, String(row.articleId)),
          eq(brssOrderItems.status, 'paid'),
        ),
      )
      .limit(1);
    return paid ? 'This article has paid charges on this order, so it cannot be taken off.' : null;
  },
  restoreGuard: async (s, row) => orderNotActive(s, String(row.orderId)),
  readPermission: P.articlesRead,
  writePermission: P.ordersWrite,
  titleOf: () => 'article on an order',
  listColumns: [
    { key: 'cornellShippingAccount', label: 'Cornell shipping account', format: 'boolean' },
    { key: 'receivedFromZip', label: 'Received from zip' },
    { key: 'createdAt', label: 'Added', format: 'date' },
  ],
  searchColumns: ['receivedFromZip'],
  immutableFields: ['orderId', 'articleId'],
};

export const orderItemEntity: EntityDef<typeof brssOrderItems> = {
  key: 'brss.order_item',
  label: 'charge',
  labelPlural: 'Order charges',
  table: brssOrderItems,
  // P4-3: a paid charge is never touched again.
  archiveGuard: async (_s, row) => (row.status === 'paid' ? 'A paid charge cannot be removed.' : null),
  // A charge cannot come back on an order that is closed or cancelled.
  restoreGuard: async (s, row) => orderNotActive(s, String(row.orderId)),
  readPermission: P.ordersRead,
  writePermission: P.ordersWrite,
  titleOf: (row) => text(row.description),
  listColumns: [
    { key: 'description', label: 'Description' },
    { key: 'quantity', label: 'Quantity' },
    { key: 'unitPriceCents', label: 'Unit price', format: 'money' },
    { key: 'status', label: 'Status' },
    { key: 'createdAt', label: 'Added', format: 'date' },
  ],
  searchColumns: ['description'],
  immutableFields: ['orderId'],
};

export const appointmentDetailEntity: EntityDef<typeof brssAppointments> = {
  key: 'brss.appointment_detail',
  label: 'appointment details',
  labelPlural: 'Appointment details',
  table: brssAppointments,
  readPermission: CORE.schedulingRead,
  writePermission: CORE.schedulingWrite,
  titleOf: (row) => `${text(row.type)} appointment details`,
  listColumns: [
    { key: 'type', label: 'Type' },
    { key: 'address1', label: 'Address' },
    { key: 'room', label: 'Room' },
    { key: 'phone', label: 'Phone' },
    { key: 'createdAt', label: 'Booked', format: 'date' },
  ],
  searchColumns: ['address1', 'room', 'phone'],
  immutableFields: ['appointmentId'],
};

export const truckCrewEntity: EntityDef<typeof brssTruckCrew> = {
  key: 'brss.truck_crew',
  label: 'truck crew member',
  labelPlural: 'Truck crews',
  table: brssTruckCrew,
  readPermission: CORE.schedulingRead,
  writePermission: CORE.schedulingWrite,
  titleOf: (row) => text(row.name),
  listColumns: [
    { key: 'name', label: 'Name' },
    { key: 'createdAt', label: 'Added', format: 'date' },
  ],
  searchColumns: ['name'],
};

export const blockBuildingEntity: EntityDef<typeof brssBlockBuildings> = {
  key: 'brss.block_building',
  label: 'unavailability building',
  labelPlural: 'Unavailability buildings',
  table: brssBlockBuildings,
  readPermission: CORE.schedulingRead,
  writePermission: CORE.schedulingWrite,
  titleOf: () => 'unavailability building',
  listColumns: [{ key: 'createdAt', label: 'Added', format: 'date' }],
  searchColumns: [],
};

/** Parents before children: a sandbox reset fills them in this order. */
export const entities: EntityDef[] = [
  regionEntity,
  buildingEntity,
  warehouseEntity,
  productEntity,
  storageTermEntity,
  zipZoneEntity,
  zoneRateEntity,
  orderEntity,
  articleEntity,
  orderArticleEntity,
  orderItemEntity,
  appointmentDetailEntity,
  truckCrewEntity,
  blockBuildingEntity,
] as EntityDef[];
