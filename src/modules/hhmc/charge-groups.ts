/**
 * The charge groups of the quote's Item picker (managers' feedback round 1, Nov 2026): pick a
 * group, then an item from that group. A reference picture from the managers comes later, so
 * the mapping is kept in this one file and is meant to be changed:
 *
 *   - ITEM_GROUPS     one line item, by its exact name (wins over everything else)
 *   - CATEGORY_GROUPS a whole cost category (Settings › Line items)
 *   - SECTION_GROUPS  the fallback, by the estimate section the item lands in
 *
 * Every catalog item gets exactly one group. Groups only change how items are found; the
 * estimate sections and prices are unchanged.
 */
import type { SectionKey } from './services/pricing';

export const CHARGE_GROUPS = ['Moving', 'Storage', 'Packing', 'Equipment', 'Additional Services'] as const;
export type ChargeGroup = (typeof CHARGE_GROUPS)[number];

/** Single items that belong somewhere other than their category's group. Empty for now. */
export const ITEM_GROUPS: Record<string, ChargeGroup> = {};

export const CATEGORY_GROUPS: Record<string, ChargeGroup> = {
  'Move Charges': 'Moving',
  Valuation: 'Moving',
  'Storage Charges': 'Storage',
  'Packing Materials': 'Packing',
  'Packing Labor': 'Packing',
  Crating: 'Packing',
  Equipment: 'Equipment',
  'Additional Services': 'Additional Services',
};

const SECTION_GROUPS: Record<SectionKey, ChargeGroup> = {
  transportation_labor: 'Moving',
  valuation: 'Moving',
  packing_materials: 'Packing',
  packing_labor: 'Packing',
  crating: 'Packing',
  additional_services: 'Additional Services',
  storage: 'Storage',
};

/** Where a typed-in line of a group goes on the estimate (the quote editor's "Section"). */
export const GROUP_SECTION: Record<ChargeGroup, SectionKey> = {
  Moving: 'transportation_labor',
  Storage: 'storage',
  Packing: 'packing_materials',
  Equipment: 'transportation_labor',
  'Additional Services': 'additional_services',
};

export function chargeGroupOf(item: { name: string; category: string; section: SectionKey }): ChargeGroup {
  return ITEM_GROUPS[item.name] ?? CATEGORY_GROUPS[item.category] ?? SECTION_GROUPS[item.section] ?? 'Additional Services';
}
