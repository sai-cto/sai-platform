import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { STANDARD_COLUMN_KEYS } from '../db/tenant-table';

export type StandardKey = (typeof STANDARD_COLUMN_KEYS)[number];

/** Any table created with tenantTable(): it has the standard columns. */
export type TenantTable = PgTable & Record<StandardKey, AnyPgColumn>;

export type Row<T extends TenantTable> = T['$inferSelect'];
/** Values a caller supplies when creating a record. Standard columns are set by the core. */
export type NewValues<T extends TenantTable> = Omit<T['$inferInsert'], StandardKey>;
export type Patch<T extends TenantTable> = Partial<NewValues<T>>;
