/** BRSS permissions. New staff start with the ones marked defaultForStaff. */
import type { PermissionDef } from '@/core/modules/contract';

export const P = {
  ordersRead: 'brss.orders.read',
  ordersWrite: 'brss.orders.write',
  discountAny: 'brss.orders.discount_any',
  articlesRead: 'brss.articles.read',
  articlesWrite: 'brss.articles.write',
  appointmentsRead: 'brss.appointments.read',
  appointmentsWrite: 'brss.appointments.write',
  appointmentsOverride: 'brss.appointments.override',
  catalogRead: 'brss.catalog.read',
  catalogWrite: 'brss.catalog.write',
} as const;

export const permissions: PermissionDef[] = [
  { key: P.ordersRead, label: 'See orders', kind: 'read', defaultForStaff: true },
  { key: P.ordersWrite, label: 'Create and change orders, prices and order status', kind: 'write', defaultForStaff: false },
  { key: P.discountAny, label: 'Give a discount above the staff limit', kind: 'write', defaultForStaff: false },
  { key: P.articlesRead, label: 'See articles (boxes and items)', kind: 'read', defaultForStaff: true },
  { key: P.articlesWrite, label: 'Take in articles and change their status and location', kind: 'write', defaultForStaff: true },
  { key: P.appointmentsRead, label: 'See the appointment schedule', kind: 'read', defaultForStaff: true },
  { key: P.appointmentsWrite, label: 'Book and change appointments, trucks and unavailability', kind: 'write', defaultForStaff: false },
  { key: P.appointmentsOverride, label: 'Book an appointment at a blocked time or at short notice', kind: 'write', defaultForStaff: false },
  { key: P.catalogRead, label: 'See prices, storage terms, zones, buildings and warehouses', kind: 'read', defaultForStaff: true },
  { key: P.catalogWrite, label: 'Change prices, storage terms, zones, buildings and warehouses', kind: 'write', defaultForStaff: false },
];
