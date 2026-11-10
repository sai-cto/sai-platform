/**
 * tenantTable(): the ONLY way to define a table that belongs to a business.
 *
 * It adds the standard columns (business, environment, who/when, archive) and two
 * row-level-security policies, so the database itself refuses to return or change
 * another business's rows. See docs/ARCHITECTURE.md ("Tenancy: three layers").
 */
import { sql } from 'drizzle-orm';
import {
  index,
  pgPolicy,
  pgTable,
  timestamp,
  uuid,
  type PgColumnBuilderBase,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core';
import { appRole, businesses, environmentEnum } from './schema/platform';

export function standardColumns() {
  return {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    environment: environmentEnum('environment').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
    /** Set when the record is archived ("deleted"). Null means active. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by'),
  };
}

/** Names of the standard columns. Callers never set these; the core does. */
export const STANDARD_COLUMN_KEYS = [
  'id',
  'businessId',
  'environment',
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'archivedAt',
  'archivedBy',
] as const;

/** A row matches when it belongs to the business and environment set for this transaction. */
const ownRows = sql`business_id = nullif(current_setting('app.business_id', true), '')::uuid and environment::text = current_setting('app.environment', true)`;
const platformScope = sql`current_setting('app.scope', true) = 'platform'`;

export function tenantTable<
  TName extends string,
  TColumns extends Record<string, PgColumnBuilderBase>,
>(
  name: TName,
  columns: TColumns,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- column map type is too deep to spell out
  extra?: (table: any) => PgTableExtraConfigValue[],
) {
  return pgTable(name, { ...standardColumns(), ...columns }, (table) => [
    index(`${name}_scope_idx`).on(table.businessId, table.environment),
    // Reads: own rows, or everything for the explicit cross-business (platform) scope.
    pgPolicy(`${name}_read`, {
      for: 'select',
      to: appRole,
      using: sql`${platformScope} or (${ownRows})`,
    }),
    // Writes: own rows only. There is no cross-business write path.
    pgPolicy(`${name}_write`, { for: 'all', to: appRole, using: ownRows, withCheck: ownRows }),
    ...(extra ? extra(table) : []),
  ]);
}
