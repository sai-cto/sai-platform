/**
 * BRSS tables. How each maps to the Salesforce object it replaces: README.md in this folder.
 * Every table is a tenantTable(); links between them use sameTenant().
 */
import { sql } from 'drizzle-orm';
import { boolean, date, integer, jsonb, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import {
  appointments,
  customers,
  payments,
  resources,
  unavailability,
} from '@/core/db/schema/tenant';
import { sameTenant, tenantTable } from '@/core/db/tenant-table';

// ---- reference data (managed in the portal's Pricing, Zones and Operations pages) ----------

/** A pickup/delivery region ("North Campus", "Collegetown Apts / Dorms" …). */
export const brssRegions = tenantTable('brss_regions', {
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

/** A building inside a region. Each building carries its own campus category. */
export const brssBuildings = tenantTable(
  'brss_buildings',
  {
    regionId: uuid('region_id').notNull(),
    name: text('name').notNull(),
    campusCategory: text('campus_category').$type<'on_campus' | 'off_campus'>().notNull(),
  },
  (t) => [sameTenant('brss_buildings_region_fk', t, t.regionId, brssRegions)],
);

/** A real warehouse (the Salesforce object of this name was something else: see README). */
export const brssWarehouses = tenantTable('brss_warehouses', {
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export type ProductKind =
  | 'storage_box'
  | 'storage_item'
  | 'flat_rate_box'
  | 'shipping'
  | 'supply'
  | 'packing'
  | 'insurance'
  | 'fee';
export type ProductRole =
  | 'ship_to_home'
  | 'ship_to_cornell'
  | 'flat_rate_cornell'
  | 'flat_rate_third_party'
  | 'insurance'
  | 'other_non_boxed'
  | 'prearrival';

/** The price list. One list: the Salesforce org only ever used its standard price book. */
export const brssProducts = tenantTable('brss_products', {
  name: text('name').notNull(),
  code: text('code').notNull(),
  kind: text('kind').$type<ProductKind>().notNull(),
  /** Marks the product the pricing rules look for (replaces record ids pasted into settings). */
  role: text('role').$type<ProductRole>(),
  /** Storage boxes: per pound for the whole term. Storage items and flat-rate boxes: per month. Others: each. */
  unitPriceCents: integer('unit_price_cents').notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
});

/** Which storage product applies to a term, for normal and overweight boxes. */
export const brssStorageTermProducts = tenantTable(
  'brss_storage_term_products',
  {
    termMonths: integer('term_months').notNull(),
    isOverweight: boolean('is_overweight').notNull().default(false),
    productId: uuid('product_id').notNull(),
  },
  (t) => [sameTenant('brss_storage_terms_product_fk', t, t.productId, brssProducts)],
);

/** Zip prefix range → shipping zone. Low and high are the first three digits of the zip. */
export const brssZipZones = tenantTable('brss_zip_zones', {
  zipLow: integer('zip_low').notNull(),
  zipHigh: integer('zip_high').notNull(),
  zone: integer('zone').notNull(),
});

/** Shipping price for a zone and a billable weight. */
export const brssZoneRates = tenantTable('brss_zone_rates', {
  zone: integer('zone').notNull(),
  weightLb: integer('weight_lb').notNull(),
  shipHomeCents: integer('ship_home_cents').notNull().default(0),
  shipCornellCents: integer('ship_cornell_cents').notNull().default(0),
});

// ---- orders ---------------------------------------------------------------------------------

export type OrderStatus = 'open' | 'activated' | 'closed' | 'cancelled';
export type OrderService = 'storage' | 'ship_to_home' | 'ship_to_cornell' | 'packing' | 'supplies';

export const brssOrders = tenantTable(
  'brss_orders',
  {
    orderNumber: text('order_number').notNull(),
    customerId: uuid('customer_id').notNull(),
    status: text('status').$type<OrderStatus>().notNull().default('open'),
    /** What the customer bought. One order can hold several services. */
    services: text('services').array().$type<OrderService[]>().notNull(),
    campusCategory: text('campus_category').$type<'on_campus' | 'off_campus' | 'counter'>(),
    netId: text('net_id'),
    storageTermMonths: integer('storage_term_months'),
    /** Set once, when the first charge is taken on a storage order. */
    storageEffectiveDate: date('storage_effective_date'),
    shipToName: text('ship_to_name'),
    shipToAddress1: text('ship_to_address1'),
    shipToAddress2: text('ship_to_address2'),
    shipToCity: text('ship_to_city'),
    shipToState: text('ship_to_state'),
    shipToZip: text('ship_to_zip'),
    /** Looked up from shipToZip whenever the zip changes. */
    shipToZone: integer('ship_to_zone'),
    /** Running totals of what has been applied at payment time. */
    discountCents: integer('discount_cents').notNull().default(0),
    tipCents: integer('tip_cents').notNull().default(0),
    taxCents: integer('tax_cents').notNull().default(0),
    notes: text('notes'),
  },
  (t) => [
    sameTenant('brss_orders_customer_fk', t, t.customerId, customers),
    uniqueIndex('brss_orders_number').on(t.businessId, t.environment, t.orderNumber),
  ],
);

export type ArticleType = 'standard_box' | 'non_boxed' | 'flat_rate_box';
export type ArticleStatus =
  | 'on_truck_to_warehouse'
  | 'in_warehouse'
  | 'stored'
  | 'ready_for_delivery'
  | 'on_truck_to_delivery'
  | 'delivered'
  | 'ready_for_shipment'
  | 'shipped';

/** One physical box or item. It belongs to a customer and can be on several orders over time. */
export const brssArticles = tenantTable(
  'brss_articles',
  {
    articleNumber: text('article_number').notNull(),
    customerId: uuid('customer_id').notNull(),
    type: text('type').$type<ArticleType>().notNull(),
    description: text('description'),
    /** Non-boxed item: its kind (a storage_item product). Flat-rate box: the box product. */
    productId: uuid('product_id'),
    weightLb: integer('weight_lb').notNull().default(0),
    lengthIn: integer('length_in').notNull().default(0),
    widthIn: integer('width_in').notNull().default(0),
    heightIn: integer('height_in').notNull().default(0),
    /** Computed when the article is saved; every price uses this number. */
    billableWeightLb: integer('billable_weight_lb').notNull().default(0),
    /** Null until something sets it (as in the Salesforce org). */
    status: text('status').$type<ArticleStatus>(),
    additionalInsuranceCents: integer('additional_insurance_cents').notNull().default(0),
    /** Monthly price entered by staff for an "Other" non-boxed item. */
    otherStoragePriceCents: integer('other_storage_price_cents'),
    warehouseId: uuid('warehouse_id'),
    section: text('section'),
    row: text('row'),
    pallet: integer('pallet'),
  },
  (t) => [
    sameTenant('brss_articles_customer_fk', t, t.customerId, customers),
    sameTenant('brss_articles_product_fk', t, t.productId, brssProducts),
    sameTenant('brss_articles_warehouse_fk', t, t.warehouseId, brssWarehouses),
    uniqueIndex('brss_articles_number').on(t.businessId, t.environment, t.articleNumber),
  ],
);

/** Puts an article on an order, with the two facts that belong to that pairing. */
export const brssOrderArticles = tenantTable(
  'brss_order_articles',
  {
    orderId: uuid('order_id').notNull(),
    articleId: uuid('article_id').notNull(),
    /** Ship to Cornell: was the box sent on Cornell's shipping account? */
    cornellShippingAccount: boolean('cornell_shipping_account').notNull().default(false),
    receivedFromZip: text('received_from_zip'),
  },
  (t) => [
    sameTenant('brss_order_articles_order_fk', t, t.orderId, brssOrders),
    sameTenant('brss_order_articles_article_fk', t, t.articleId, brssArticles),
    uniqueIndex('brss_order_articles_pair')
      .on(t.businessId, t.environment, t.orderId, t.articleId)
      .where(sql`${t.archivedAt} is null`),
  ],
);

export type ChargeRule =
  'storage' | 'ship_to_home' | 'ship_to_cornell_fee' | 'ship_to_cornell' | 'insurance';

export const brssOrderItems = tenantTable(
  'brss_order_items',
  {
    orderId: uuid('order_id').notNull(),
    productId: uuid('product_id'),
    articleId: uuid('article_id'),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitPriceCents: integer('unit_price_cents').notNull(),
    status: text('status').$type<'new' | 'paid'>().notNull().default('new'),
    /** The payment that covered this line, once paid by card, cash or cheque. */
    paymentId: uuid('payment_id'),
    /**
     * Which pricing rule worked this line out (see priceArticle in rules.ts). Null for a line
     * staff added by hand. Recalculating prices only ever touches unpaid lines that have a rule.
     */
    rule: text('rule').$type<ChargeRule>(),
  },
  (t) => [
    sameTenant('brss_order_items_order_fk', t, t.orderId, brssOrders),
    sameTenant('brss_order_items_product_fk', t, t.productId, brssProducts),
    sameTenant('brss_order_items_article_fk', t, t.articleId, brssArticles),
    sameTenant('brss_order_items_payment_fk', t, t.paymentId, payments),
  ],
);

// ---- scheduling (extends the core's appointments, resources and unavailability) -------------

export type AppointmentType = 'pickup' | 'delivery' | 'packing' | 'supplies';
export type CrewMember = { name: string };

/** BRSS's extra facts about a core appointment (same row count: one per appointment). */
export const brssAppointments = tenantTable(
  'brss_appointments',
  {
    appointmentId: uuid('appointment_id').notNull(),
    orderId: uuid('order_id'),
    type: text('type').$type<AppointmentType>().notNull(),
    regionId: uuid('region_id'),
    buildingId: uuid('building_id'),
    address1: text('address1'),
    address2: text('address2'),
    room: text('room'),
    city: text('city'),
    state: text('state').notNull().default('New York'),
    zip: text('zip'),
    hasElevator: boolean('has_elevator').notNull().default(false),
    phone: text('phone'),
    estimatedBoxes: integer('estimated_boxes').notNull().default(0),
    estimatedOtherItems: integer('estimated_other_items').notNull().default(0),
    packingHours: integer('packing_hours').notNull().default(0),
    /** Why this was booked at a blocked time or at short notice (only people with the override permission can). */
    overrideReason: text('override_reason'),
    /** The truck's crew, copied here when the truck is assigned. */
    crew: jsonb('crew').$type<CrewMember[]>().notNull().default([]),
  },
  (t) => [
    sameTenant('brss_appointments_appointment_fk', t, t.appointmentId, appointments),
    sameTenant('brss_appointments_order_fk', t, t.orderId, brssOrders),
    sameTenant('brss_appointments_region_fk', t, t.regionId, brssRegions),
    sameTenant('brss_appointments_building_fk', t, t.buildingId, brssBuildings),
    uniqueIndex('brss_appointments_one_per_appointment').on(
      t.businessId,
      t.environment,
      t.appointmentId,
    ),
  ],
);

/**
 * Who normally rides a truck, by name. (In Salesforce these were Contacts, not logins; a link
 * to a user account can be added once crews sign in.) The truck itself is a core resource of
 * kind "truck".
 */
export const brssTruckCrew = tenantTable(
  'brss_truck_crew',
  {
    truckId: uuid('truck_id').notNull(),
    name: text('name').notNull(),
  },
  (t) => [sameTenant('brss_truck_crew_truck_fk', t, t.truckId, resources)],
);

/** Limits a core unavailability to some buildings. No rows = it applies everywhere. */
export const brssBlockBuildings = tenantTable(
  'brss_block_buildings',
  {
    unavailabilityId: uuid('unavailability_id').notNull(),
    buildingId: uuid('building_id').notNull(),
  },
  (t) => [
    sameTenant('brss_block_buildings_block_fk', t, t.unavailabilityId, unavailability),
    sameTenant('brss_block_buildings_building_fk', t, t.buildingId, brssBuildings),
  ],
);
