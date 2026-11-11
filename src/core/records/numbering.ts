/**
 * nextRecordNumber(): human-friendly running numbers ("O-000123") for a business's records.
 *
 * Numbers count up separately for each business and for live and sandbox. Archived rows
 * still count, so a number is not handed out twice while its row exists. Call it inside the
 * same withScope() as the createRecord() that uses the number.
 */
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { takeLock } from '../db/lock';
import type { Scope } from '../db/scope';
import type { EntityDef } from '../modules/contract';
import type { TenantTable } from './types';

/**
 * @param column  the text column that holds the number, e.g. orders.orderNumber
 * @param prefix  letters before the digits, e.g. "O" gives "O-000001"
 * @param count   how many numbers to reserve (default 1); they are returned in order
 */
export async function nextRecordNumber<T extends TenantTable>(
  s: Scope,
  entity: EntityDef<T>,
  column: AnyPgColumn,
  prefix: string,
  count = 1,
): Promise<string[]> {
  if (!/^[A-Z]{1,4}$/.test(prefix)) throw new Error('A number prefix is 1 to 4 capital letters.');
  // One at a time, so two people creating records at once cannot get the same number.
  await takeLock(s, `number:${entity.key}`);
  const start = prefix.length + 2; // position of the first digit in "O-000001"
  const [row] = await s.db
    .select({
      highest: sql<number>`coalesce(max(substring(${column} from ${start}::int)::int), 0)`,
    })
    .from(entity.table as TenantTable)
    .where(sql`${s.where(entity.table, 'include')} and ${column} ~ ${`^${prefix}-[0-9]+$`}`);
  const highest = Number(row?.highest ?? 0);
  return Array.from(
    { length: count },
    (_, i) => `${prefix}-${String(highest + 1 + i).padStart(6, '0')}`,
  );
}
