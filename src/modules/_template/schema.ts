/**
 * TEMPLATE — the module's tables.
 *
 * Rules (docs/ARCHITECTURE.md):
 *  - every table is created with tenantTable(), never pgTable();
 *  - table names start with the module key ("template_…");
 *  - a link to another tenant table uses sameTenant(), never .references();
 *  - money is integer cents; times are timestamps with time zone.
 *
 * After changing this file: npm run db:generate && npm run db:migrate
 * (This template's tables are NOT migrated: drizzle.config.ts skips folders starting with "_".)
 */
import { integer, text, uuid } from 'drizzle-orm/pg-core';
import { customers } from '@/core/db/schema/tenant';
import { sameTenant, tenantTable } from '@/core/db/tenant-table';

export const templateItems = tenantTable(
  'template_items',
  {
    name: text('name').notNull(),
    priceCents: integer('price_cents').notNull().default(0),
    /** Optional link to a core customer. */
    customerId: uuid('customer_id'),
    notes: text('notes'),
  },
  (t) => [sameTenant('template_items_customer_fk', t, t.customerId, customers)],
);
