/**
 * BRSS permissions. New staff start with the ones marked defaultForStaff.
 *
 * BRSS also uses the shared core's permissions, so they are not repeated here:
 *   customers.read / customers.write    – the customer on an order
 *   payments.read / payments.write      – taking a payment, refunds
 *   scheduling.read / scheduling.write  – appointments, trucks and crews, unavailability
 *   notifications.write                 – the confirmation email sent when an appointment is confirmed
 */
import type { PermissionDef } from '@/core/modules/contract';

export const P = {
  ordersRead: 'brss.orders.read',
  ordersWrite: 'brss.orders.write',
  discountAny: 'brss.orders.discount_any',
  articlesRead: 'brss.articles.read',
  articlesWrite: 'brss.articles.write',
  appointmentsOverride: 'brss.appointments.override',
  catalogRead: 'brss.catalog.read',
  catalogWrite: 'brss.catalog.write',
} as const;

/** Core permissions BRSS relies on, named once so a typo cannot slip in. */
export const CORE = {
  customersRead: 'customers.read',
  customersWrite: 'customers.write',
  paymentsRead: 'payments.read',
  paymentsWrite: 'payments.write',
  schedulingRead: 'scheduling.read',
  schedulingWrite: 'scheduling.write',
} as const;

// prettier-ignore
export const permissions: PermissionDef[] = [
  { key: P.ordersRead, label: 'See orders', kind: 'read', defaultForStaff: true },
  { key: P.ordersWrite, label: 'Process orders: create and change orders, take in articles, add charges, change order status', kind: 'write', defaultForStaff: false },
  { key: P.discountAny, label: 'Give a discount above the staff limit', kind: 'write', defaultForStaff: false },
  { key: P.articlesRead, label: 'See articles (boxes and items)', kind: 'read', defaultForStaff: true },
  { key: P.articlesWrite, label: "Change an article's details, status and warehouse location", kind: 'write', defaultForStaff: true },
  { key: P.appointmentsOverride, label: 'Book an appointment at a blocked time or at short notice', kind: 'write', defaultForStaff: false },
  { key: P.catalogRead, label: 'See prices, storage terms, zones, buildings and warehouses', kind: 'read', defaultForStaff: true },
  { key: P.catalogWrite, label: 'Change prices, storage terms, zones, buildings and warehouses', kind: 'write', defaultForStaff: false },
];
