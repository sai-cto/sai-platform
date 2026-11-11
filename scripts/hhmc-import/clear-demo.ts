/**
 * One time, before the first real import: removes the FAKE demo data from HHMC live in the local
 * database (the same way a test-mode reset clears the sandbox) and re-creates only the settings
 * data: line items, discounts, templates, automation rules, trucks. Refuses as soon as live holds
 * a single record imported from Movegistics, so real data can never be wiped by it.
 */
import { and, eq, notLike } from 'drizzle-orm';
import { logActivity } from '../../src/core/audit/log';
import { txOf, type Scope } from '../../src/core/db/scope';
import { entitiesFor } from '../../src/core/modules/registry';
import { resourceEntity } from '../../src/core/records/core-entities';
import { seedRecords } from '../../src/core/sandbox/seeding';
import { automationRuleEntity, catalogItemEntity, discountEntity, templateEntity } from '../../src/modules/hhmc/entities';
import { hhmcImportRefs } from '../../src/modules/hhmc/schema';
import { CATALOG, DISCOUNTS, RULES, TEMPLATES } from '../../src/modules/hhmc/seed-data';

export async function clearLiveDemo(s: Scope): Promise<number> {
  if (s.ctx.environment !== 'live' || s.ctx.business.slug !== 'hhmc') throw new Error('Only for HHMC live.');
  const [real] = await s.db
    .select({ id: hhmcImportRefs.id })
    .from(hhmcImportRefs)
    .where(and(eq(hhmcImportRefs.businessId, s.ctx.business.id), eq(hhmcImportRefs.environment, 'live'), notLike(hhmcImportRefs.sourceId, 'DEMO-%')))
    .limit(1);
  if (real) throw new Error('Refusing: HHMC live already holds imported Movegistics records. Re-run the import without --clear-live-demo.');
  let removed = 0;
  for (const entity of [...entitiesFor('hhmc')].reverse()) {
    const rows = await txOf(s)
      .delete(entity.table)
      .where(and(eq(entity.table.businessId, s.ctx.business.id), eq(entity.table.environment, 'live')))
      .returning({ id: entity.table.id });
    removed += rows.length;
  }
  await seedRecords(s, catalogItemEntity, CATALOG.map((item, i) => ({ ...item, isDefaultForLocal: item.isDefaultForLocal ?? false, sortOrder: i })));
  await seedRecords(s, discountEntity, DISCOUNTS);
  await seedRecords(s, templateEntity, TEMPLATES);
  await seedRecords(s, automationRuleEntity, RULES.map((r) => ({ ...r, isActive: true })));
  // NEEDS JAI REVIEW: HHMC's real trucks (Movegistics › Resources › Vehicles were not exported).
  await seedRecords(s, resourceEntity, [
    { kind: 'truck', name: "Truck 1 · 16'", isActive: true },
    { kind: 'truck', name: "Truck 2 · 26'", isActive: true },
    { kind: 'truck', name: 'Van', isActive: true },
  ]);
  await logActivity(txOf(s), s.ctx, {
    action: 'sandbox_reset',
    entityType: 'live',
    entityId: 'hhmc',
    summary: 'Cleared the fake demo data from HHMC live before the first Movegistics import (settings data re-created)',
  });
  return removed;
}
