/** Changing the settings data: catalog rates, templates. (Rules: automations.ts updateRule.) */
import { withScope } from '@/core/db/scope';
import { ValidationError } from '@/core/errors';
import { updateRecord } from '@/core/records/records';
import type { BusinessContext } from '@/core/tenancy/context';
import { asc } from 'drizzle-orm';
import { createRecord } from '@/core/records/records';
import { catalogItemEntity, templateEntity } from '../entities';
import { P } from '../permissions';
import { hhmcCatalogItems, type CatalogCategory } from '../schema';
import { parseMoney, type SectionKey } from './pricing';

/** Cost categories (the managers' dropdowns) and the estimate section each lands in. */
export const CATEGORY_SECTIONS: Record<CatalogCategory, SectionKey> = {
  'Move Charges': 'transportation_labor',
  Equipment: 'transportation_labor',
  'Packing Materials': 'packing_materials',
  'Packing Labor': 'packing_labor',
  Crating: 'crating',
  'Additional Services': 'additional_services',
  'Storage Charges': 'storage',
  Valuation: 'valuation',
};
export const CATEGORIES = Object.keys(CATEGORY_SECTIONS) as CatalogCategory[];
export const UNITS = ['hour', 'day', 'mile', 'each', 'lb', 'month', 'flat'] as const;

/** A new pre-generated line item (managers: "set up pregenerated line items … very important"). */
export async function createCatalogItem(ctx: BusinessContext, input: { name: string; category: string; unit: string; rate: string }) {
  const name = input.name.trim();
  if (!name || name.length > 120) throw new ValidationError('Enter a name for the line item (up to 120 characters).');
  const category = CATEGORIES.find((c) => c === input.category);
  if (!category) throw new ValidationError('Choose a cost category.');
  const unit = UNITS.find((u) => u === input.unit);
  if (!unit) throw new ValidationError('Choose a unit.');
  const rateCents = parseMoney(input.rate);
  if (rateCents === null || rateCents > 10_000_000) throw new ValidationError('Enter the rate in dollars, e.g. 195 or 1.09.');
  return withScope(ctx, P.catalogWrite, async (s) => {
    const existing = await s.db.select({ name: hhmcCatalogItems.name, sortOrder: hhmcCatalogItems.sortOrder }).from(hhmcCatalogItems).where(s.where(hhmcCatalogItems)).orderBy(asc(hhmcCatalogItems.sortOrder));
    if (existing.some((e) => e.name.trim().toLowerCase() === name.toLowerCase())) throw new ValidationError('A line item with that name already exists.');
    return createRecord(s, catalogItemEntity, { name, category, section: CATEGORY_SECTIONS[category], unit, rateCents, sortOrder: (existing.at(-1)?.sortOrder ?? 0) + 1 });
  });
}

export async function updateCatalogItem(ctx: BusinessContext, id: string, input: { rate: string; isActive: boolean }) {
  const rateCents = parseMoney(input.rate);
  if (rateCents === null || rateCents > 10_000_000) throw new ValidationError('Enter the rate in dollars, e.g. 195 or 1.09.');
  return withScope(ctx, P.catalogWrite, (s) => updateRecord(s, catalogItemEntity, id, { rateCents, isActive: input.isActive }));
}

export async function updateTemplate(ctx: BusinessContext, id: string, input: { subject: string; body: string }) {
  if (!input.body.trim()) throw new ValidationError('A template cannot be empty.');
  if (input.subject.length > 200 || input.body.length > 20_000) throw new ValidationError('That template is too long.');
  return withScope(ctx, P.catalogWrite, (s) => updateRecord(s, templateEntity, id, { subject: input.subject, body: input.body }));
}
