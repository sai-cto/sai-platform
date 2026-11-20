/**
 * Writes HHMC's own templates (settings-docs.ts) over the placeholders the business was set up
 * with. A template a manager changed in SAI is kept as it is, now and on every re-import; one the
 * import wrote follows the latest export. Linked through hhmc_import_refs like every other record.
 */
import { and, eq } from 'drizzle-orm';
import type { Scope } from '../../src/core/db/scope';
import { createRecord, updateRecord } from '../../src/core/records/records';
import { importRefEntity, templateEntity } from '../../src/modules/hhmc/entities';
import { hhmcImportRefs, hhmcTemplates } from '../../src/modules/hhmc/schema';
import type { Batch } from './load';
import { hashOf } from './movegistics';
import type { NTemplate } from './settings-docs';

export type TemplateStats = { created: number; updated: number; unchanged: number; kept: number };

const changedInSai = (row: { updatedBy: string | null; updatedAt: Date }, since: Date | null) =>
  Boolean(row.updatedBy) || (since !== null && row.updatedAt.getTime() > since.getTime() + 1000);

async function loadOne(s: Scope, t: NTemplate): Promise<keyof TemplateStats> {
  const values = { name: t.name, subject: t.subject, body: t.body };
  const hash = hashOf({ key: t.key, kind: t.kind, ...values });
  const sourceData = { Template: t.source };
  const [ref] = await s.db
    .select()
    .from(hhmcImportRefs)
    .where(and(s.where(hhmcImportRefs), eq(hhmcImportRefs.source, 'movegistics'), eq(hhmcImportRefs.sourceType, 'template'), eq(hhmcImportRefs.sourceId, t.key)));
  const [row] = await s.db.select().from(hhmcTemplates).where(and(s.where(hhmcTemplates), eq(hhmcTemplates.key, t.key)));
  if (row && row.kind !== t.kind) throw new Error(`Refusing: template "${t.key}" is a ${row.kind} template here, not ${t.kind}.`);

  if (ref) {
    // Archived or replaced in SAI since: someone decided; leave it.
    if (!row || row.id !== ref.recordId) return 'kept';
    if (ref.contentHash === hash) return 'unchanged';
    if (changedInSai(row, ref.importedAt)) return 'kept';
    await updateRecord(s, templateEntity, row.id, values);
    await updateRecord(s, importRefEntity, ref.id, { contentHash: hash, importedAt: new Date(), sourceData });
    return 'updated';
  }
  const link = (recordId: string) =>
    createRecord(s, importRefEntity, { source: 'movegistics', sourceType: 'template', sourceId: t.key, entityKey: templateEntity.key, recordId, contentHash: hash, sourceData });
  if (!row) {
    const created = (await createRecord(s, templateEntity, { key: t.key, kind: t.kind, ...values })) as { id: string };
    await link(created.id);
    return 'created';
  }
  // The set-up placeholder (nobody changed it) is replaced; a manager's own wording is kept.
  if (changedInSai(row, null)) {
    await link(row.id);
    return 'kept';
  }
  await updateRecord(s, templateEntity, row.id, values);
  await link(row.id);
  return 'updated';
}

export async function loadTemplates(batch: Batch, templates: NTemplate[]): Promise<TemplateStats> {
  const stats: TemplateStats = { created: 0, updated: 0, unchanged: 0, kept: 0 };
  await batch(async (s) => {
    for (const t of templates) stats[await loadOne(s, t)]++;
  });
  return stats;
}
