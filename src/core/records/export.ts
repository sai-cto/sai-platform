/** Exporting records to CSV. Every export is written to the activity log. */
import { logActivity } from '../audit/log';
import { txOf, withScope, type ArchivedFilter } from '../db/scope';
import type { EntityDef, ListColumn } from '../modules/contract';
import type { BusinessContext } from '../tenancy/context';
import { listRecords } from './records';

export const EXPORT_LIMIT = 5000;

/** Stops a spreadsheet from treating a cell that starts with = + - @ as a formula. */
export function safeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export async function exportRecords(
  ctx: BusinessContext,
  entity: EntityDef,
  options: { search?: string; archived?: ArchivedFilter },
): Promise<{ columns: ListColumn[]; rows: Record<string, unknown>[] }> {
  return withScope(ctx, 'business.data.export', async (s) => {
    const { rows } = await listRecords(s, entity, { ...options, limit: EXPORT_LIMIT });
    await logActivity(txOf(s), ctx, {
      action: 'export',
      entityType: entity.key,
      summary: `Exported ${rows.length} ${entity.labelPlural.toLowerCase()} to CSV`,
      after: {
        rows: rows.length,
        search: options.search ?? null,
        archived: options.archived ?? 'exclude',
      },
    });
    const columns: ListColumn[] = [
      { key: 'id', label: 'Id' },
      ...entity.listColumns,
      { key: 'archivedAt', label: 'Archived', format: 'datetime' },
    ];
    return { columns, rows: rows as Record<string, unknown>[] };
  });
}
