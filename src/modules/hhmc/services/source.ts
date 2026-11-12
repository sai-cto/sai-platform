/**
 * "From Movegistics": the rows Movegistics exported for a record, exactly as exported (every
 * non-blank column). Kept with the import link (hhmc_import_refs.source_data), so nothing the
 * managers saw in Movegistics is lost even where HHMC has no field of its own for it.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Scope } from '@/core/db/scope';
import { hhmcImportRefs } from '../schema';

export type SourceRecord = { type: string; sourceId: string; data: Record<string, string> };

const ORDER = ['contact', 'lead', 'work_request', 'work_order', 'estimate', 'invoice', 'payment'];

/** Movegistics rows for these local records (the caller's scope decides what may be read). */
export async function sourceRecordsFor(s: Scope, recordIds: string[]): Promise<SourceRecord[]> {
  const ids = [...new Set(recordIds.filter(Boolean))];
  if (!ids.length) return [];
  const rows = await s.db
    .select({ type: hhmcImportRefs.sourceType, sourceId: hhmcImportRefs.sourceId, data: hhmcImportRefs.sourceData })
    .from(hhmcImportRefs)
    .where(and(s.where(hhmcImportRefs), eq(hhmcImportRefs.source, 'movegistics'), inArray(hhmcImportRefs.recordId, ids)))
    .orderBy(asc(hhmcImportRefs.sourceId));
  return rows
    .filter((r) => Object.keys(r.data ?? {}).length > 0)
    .sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || a.sourceId.localeCompare(b.sourceId, 'en', { numeric: true }));
}
