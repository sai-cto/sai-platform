/**
 * Writes HHMC's catalog, discounts and automation rules (settings-pricing.ts) into its live data,
 * the same way load-templates.ts writes the templates: linked through hhmc_import_refs, so a
 * re-run changes nothing unless Movegistics changed, and a row a manager changed in SAI is kept.
 */
import { and, eq, type SQL } from 'drizzle-orm';
import type { Scope } from '../../src/core/db/scope';
import type { EntityDef } from '../../src/core/modules/contract';
import { createRecord, updateRecord } from '../../src/core/records/records';
import { automationRuleEntity, catalogItemEntity, discountEntity, importRefEntity } from '../../src/modules/hhmc/entities';
import { hhmcAutomationRules, hhmcCatalogItems, hhmcDiscounts, hhmcImportRefs } from '../../src/modules/hhmc/schema';
import type { Batch } from './load';
import { hashOf } from './movegistics';
import type { NPricing } from './settings-pricing';

export type SettingStats = { created: number; updated: number; unchanged: number; kept: number };
type Row = { id: string; updatedBy: string | null; updatedAt: Date };
type Kind = {
  sourceType: string;
  entity: EntityDef<never>;
  find: (s: Scope, id: string) => Promise<Row | undefined>;
};

const changedInSai = (row: Row, since: Date | null) => Boolean(row.updatedBy) || (since !== null && row.updatedAt.getTime() > since.getTime() + 1000);

async function loadOne(s: Scope, kind: Kind, sourceId: string, values: Record<string, unknown>): Promise<keyof SettingStats> {
  const hash = hashOf(values);
  const sourceData = { [kind.sourceType]: sourceId };
  const [ref] = await s.db
    .select()
    .from(hhmcImportRefs)
    .where(and(s.where(hhmcImportRefs), eq(hhmcImportRefs.source, 'movegistics'), eq(hhmcImportRefs.sourceType, kind.sourceType), eq(hhmcImportRefs.sourceId, sourceId)));
  const row = await kind.find(s, sourceId);
  if (ref) {
    if (!row || row.id !== ref.recordId) return 'kept';
    if (ref.contentHash === hash) return 'unchanged';
    if (changedInSai(row, ref.importedAt)) return 'kept';
    await updateRecord(s, kind.entity as never, row.id, values as never);
    await updateRecord(s, importRefEntity, ref.id, { contentHash: hash, importedAt: new Date(), sourceData });
    return 'updated';
  }
  const link = (recordId: string) =>
    createRecord(s, importRefEntity, { source: 'movegistics', sourceType: kind.sourceType, sourceId, entityKey: kind.entity.key, recordId, contentHash: hash, sourceData });
  if (!row) {
    const created = (await createRecord(s, kind.entity as never, values as never)) as { id: string };
    await link(created.id);
    return 'created';
  }
  // Set up by SAI and never changed: Movegistics' value replaces it. A manager's own is kept.
  if (changedInSai(row, null)) {
    await link(row.id);
    return 'kept';
  }
  await updateRecord(s, kind.entity as never, row.id, values as never);
  await link(row.id);
  return 'updated';
}

const first = async <T>(q: Promise<T[]>) => (await q)[0];
const finder =
  <T extends typeof hhmcCatalogItems | typeof hhmcDiscounts | typeof hhmcAutomationRules>(table: T, match: (id: string) => SQL) =>
  (s: Scope, id: string) =>
    first(s.db.select().from(table as typeof hhmcCatalogItems).where(and(s.where(table as typeof hhmcCatalogItems), match(id)))) as Promise<Row | undefined>;

const CATALOG: Kind = { sourceType: 'catalog_item', entity: catalogItemEntity as never, find: finder(hhmcCatalogItems, (id) => eq(hhmcCatalogItems.name, id)) };
const DISCOUNT: Kind = { sourceType: 'discount', entity: discountEntity as never, find: finder(hhmcDiscounts, (id) => eq(hhmcDiscounts.name, id)) };
const RULE: Kind = { sourceType: 'automation_rule', entity: automationRuleEntity as never, find: finder(hhmcAutomationRules, (id) => eq(hhmcAutomationRules.key, id)) };

export async function loadPricing(batch: Batch, p: NPricing): Promise<Record<'catalog_item' | 'discount' | 'automation_rule', SettingStats>> {
  const empty = (): SettingStats => ({ created: 0, updated: 0, unchanged: 0, kept: 0 });
  const stats = { catalog_item: empty(), discount: empty(), automation_rule: empty() };
  await batch(async (s) => {
    for (const c of p.catalog) stats.catalog_item[await loadOne(s, CATALOG, c.name, { ...c, isActive: true })]++;
    for (const d of p.discounts) stats.discount[await loadOne(s, DISCOUNT, d.name, d)]++;
    for (const r of p.rules) stats.automation_rule[await loadOne(s, RULE, r.key, r)]++;
  });
  return stats;
}
