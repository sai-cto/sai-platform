/**
 * TEMPLATE — business logic. Plain functions that take the context first.
 *
 *  - Reads:  withScope(ctx, permission, (s) => …) and listRecords / getRecord, or a query
 *            on s.db that includes s.where(table).
 *  - Writes: createRecord / updateRecord / archiveRecord / restoreRecord. They check the
 *            permission, keep the row inside this business, and write the activity log.
 *  - Validate input with zod and throw ValidationError with a message a person can act on.
 */
import { z } from 'zod';
import { withScope } from '@/core/db/scope';
import { ValidationError } from '@/core/errors';
import { createRecord, listRecords } from '@/core/records/records';
import type { BusinessContext } from '@/core/tenancy/context';
import { itemEntity } from '../entities';
import { P } from '../permissions';

const itemInput = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120),
  // The form sends the price as typed ("12.50"); it is stored as whole cents.
  price: z
    .string()
    .trim()
    .regex(/^\d{1,7}(\.\d{1,2})?$/, 'Enter the price in dollars, like 12.50'),
  notes: z.string().trim().max(2000).nullish(),
});

function parse(raw: unknown) {
  const parsed = itemInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  const { price, ...rest } = parsed.data;
  return { ...rest, priceCents: Math.round(Number(price) * 100), notes: rest.notes || null };
}

export function listItems(ctx: BusinessContext) {
  return withScope(ctx, P.itemsRead, (s) => listRecords(s, itemEntity));
}

export function createItem(ctx: BusinessContext, raw: unknown) {
  return withScope(ctx, P.itemsWrite, (s) => createRecord(s, itemEntity, parse(raw)));
}
