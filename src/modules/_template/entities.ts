/**
 * TEMPLATE — one EntityDef per table. Registering a table here is what makes it appear in
 * the Data tab (browse, search, export, archive, restore, permanent delete), in test-mode
 * resets, and in the automatic isolation and audit tests. EVERY table must be registered,
 * parents before children.
 */
import type { EntityDef } from '@/core/modules/contract';
import { P } from './permissions';
import { templateItems } from './schema';

export const itemEntity: EntityDef<typeof templateItems> = {
  key: 'template.item',
  label: 'item',
  labelPlural: 'Items',
  table: templateItems,
  readPermission: P.itemsRead,
  writePermission: P.itemsWrite,
  titleOf: (row) => String(row.name ?? 'Item'),
  listColumns: [
    { key: 'name', label: 'Name' },
    { key: 'priceCents', label: 'Price', format: 'money' },
    { key: 'createdAt', label: 'Created', format: 'date' },
  ],
  searchColumns: ['name', 'notes'],
};
