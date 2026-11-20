/**
 * HHMC's pricing settings and automatic emails as Movegistics has them (the export's
 * settings/pricing.json and settings/automations.json, read from Movegistics' Settings pages):
 * every line item and rate, the discounts, and the email automations. They become the catalog,
 * discounts and automation rules of HHMC's live data. docs/hhmc-emails.md lists the emails.
 *
 * Where SAI deliberately differs, it says so here and in the reconciliation (SAI_ONLY, KEPT).
 */
import type { AutomationTrigger, CatalogCategory } from '../../src/modules/hhmc/schema';
import type { SectionKey } from '../../src/modules/hhmc/services/pricing';

export type NCatalogItem = { name: string; category: CatalogCategory; section: SectionKey; unit: string; rateCents: number; isDefaultForLocal: boolean; sortOrder: number };
export type NDiscount = { name: string; percentBp: number; isActive: boolean };
export type NRule = { key: string; name: string; trigger: AutomationTrigger; delayMinutes: number; templateKey: string; respectsOptIn: boolean; isActive: boolean };
export type NPricing = { catalog: NCatalogItem[]; discounts: NDiscount[]; rules: NRule[]; skipped: { what: string; why: string }[] };

type LineItem = { title: string; category: string; unit: string | null; rate: number | null; active: boolean };
type Discount = { name: string; type: string; value: number; active: boolean };
type Automation = { name: string; active: boolean; type: string; templateName?: string | null; delayMinutes?: number | null };

const SECTION: Record<string, { category: CatalogCategory; section: SectionKey }> = {
  'Move Charges': { category: 'Move Charges', section: 'transportation_labor' },
  Equipment: { category: 'Equipment', section: 'transportation_labor' },
  'Packing Materials': { category: 'Packing Materials', section: 'packing_materials' },
  'Additional Services': { category: 'Additional Services', section: 'additional_services' },
};
const UNIT: Record<string, string> = { 'Per Hour': 'hour', 'Per Day': 'day', 'Per Mile': 'mile', Each: 'each' };
/** The truck every new Local job starts with (ref §4.1). */
const DEFAULT_FOR_LOCAL = "16' Truck Local";

/** Items SAI needs that Movegistics has no line item for (seed-data.ts explains each). */
export const SAI_ONLY: Omit<NCatalogItem, 'sortOrder'>[] = [
  { name: 'Packing Labor', category: 'Packing Labor', section: 'packing_labor', unit: 'hour', rateCents: 19500, isDefaultForLocal: false },
  { name: 'Basic Coverage ($0.60/lb per article)', category: 'Valuation', section: 'valuation', unit: 'each', rateCents: 0, isDefaultForLocal: false },
];

/**
 * The managers price the Cornellian discount as $20 off every labor hour (setting
 * cornellianDiscountPerHour), not Movegistics' 5% (docs/DECISIONS.md).
 */
export const KEPT_DISCOUNTS: Record<string, string> = {
  'Cornellian Discount': 'Priced in SAI as $20 off every labor hour (the "Cornellian" box), not 5%: the managers\' decision.',
};

/**
 * Movegistics automation → our rule. `trigger` is when SAI starts the clock; `delay` is
 * Movegistics' own delay. Lead emails start when staff mark the lead "Couldn't reach" (in
 * Movegistics, by tagging it by hand). Tag-only automations send nothing and are left out.
 */
const RULES: Record<string, Omit<NRule, 'isActive' | 'delayMinutes' | 'name'>> = {
  "Didn't Connect": { key: 'lead_didnt_connect', trigger: 'lead_no_contact', templateKey: 'lead_didnt_connect', respectsOptIn: false },
  'Last Check In': { key: 'lead_last_checkin', trigger: 'lead_no_contact', templateKey: 'lead_last_checkin', respectsOptIn: false },
  'Sorry we missed you': { key: 'lead_sorry', trigger: 'lead_no_contact', templateKey: 'lead_sorry', respectsOptIn: false },
  'Same Day Estimate Follow Up': { key: 'drip_same_day', trigger: 'estimate_sent', templateKey: 'drip_same_day', respectsOptIn: true },
  'Is the price giving you pause?': { key: 'drip_day2', trigger: 'estimate_sent', templateKey: 'drip_day2', respectsOptIn: true },
  'Quick note on your move date': { key: 'drip_day3', trigger: 'estimate_sent', templateKey: 'drip_day3', respectsOptIn: true },
  'Still thinking it over?': { key: 'drip_day7', trigger: 'estimate_sent', templateKey: 'drip_day7', respectsOptIn: true },
  'Past Due Reminder': { key: 'past_due', trigger: 'invoice_sent', templateKey: 'past_due', respectsOptIn: false },
  'How did your move go?': { key: 'review_request', trigger: 'invoice_paid', templateKey: 'review_request', respectsOptIn: true },
  'Payment Receipt Automation': { key: 'payment_receipt', trigger: 'payment_received', templateKey: 'payment_receipt', respectsOptIn: false },
};

/** Emails SAI adds that Movegistics has no automation for (docs/hhmc-emails.md). */
export const SAI_RULES: NRule[] = [
  // HHMC's own "You're Booked!" template, which Movegistics never sent automatically.
  { key: 'booked', name: "You're Booked", trigger: 'job_booked', delayMinutes: 0, templateKey: 'booked', respectsOptIn: false, isActive: true },
  { key: 'move_reminder_2d', name: 'Move reminder (2 days before)', trigger: 'move_reminder', delayMinutes: -2 * 1440, templateKey: 'move_reminder', respectsOptIn: false, isActive: true },
];

const refuse = (why: string): never => {
  throw new Error(`Refusing: settings export: ${why}`);
};
const cents = (dollars: number) => Math.round(dollars * 100);

function catalogOf(items: LineItem[], skipped: NPricing['skipped']): NCatalogItem[] {
  const out: NCatalogItem[] = [];
  for (const li of items) {
    if (!li.active) {
      skipped.push({ what: `line item "${li.title}"`, why: 'inactive in Movegistics' });
      continue;
    }
    if (li.rate === null || li.rate === undefined) {
      skipped.push({ what: `line item "${li.title}"`, why: 'has no rate in Movegistics (an empty placeholder)' });
      continue;
    }
    const place = SECTION[li.category] ?? refuse(`line item "${li.title}" has an unknown category "${li.category}".`);
    const unit = li.unit === null ? 'each' : (UNIT[li.unit] ?? refuse(`line item "${li.title}" has an unknown unit "${li.unit}".`));
    out.push({ name: li.title, ...place, unit, rateCents: cents(li.rate), isDefaultForLocal: li.title === DEFAULT_FOR_LOCAL, sortOrder: 0 });
  }
  if (!out.some((c) => c.isDefaultForLocal)) refuse(`no "${DEFAULT_FOR_LOCAL}" line item.`);
  const all = [...out, ...SAI_ONLY.filter((x) => !out.some((c) => c.name === x.name)).map((x) => ({ ...x, sortOrder: 0 }))];
  // Same order as the estimate builder lists them: by section, then name.
  const order: SectionKey[] = ['transportation_labor', 'packing_labor', 'packing_materials', 'additional_services', 'valuation'];
  return all
    .sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section) || a.name.localeCompare(b.name, 'en', { numeric: true }))
    .map((c, i) => ({ ...c, sortOrder: i }));
}

function discountsOf(discounts: Discount[], skipped: NPricing['skipped']): NDiscount[] {
  const out: NDiscount[] = [];
  for (const d of discounts) {
    if (KEPT_DISCOUNTS[d.name]) {
      skipped.push({ what: `discount "${d.name}"`, why: KEPT_DISCOUNTS[d.name] });
      continue;
    }
    if (d.type !== 'percent') refuse(`discount "${d.name}" is not a percentage.`);
    // "Friends & Family Discount" → "Friends & Family", as staff pick it on a line.
    out.push({ name: d.name.replace(/ Discount$/, ''), percentBp: Math.round(d.value * 100), isActive: d.active });
  }
  return out;
}

function rulesOf(automations: Automation[], skipped: NPricing['skipped']): NRule[] {
  const out: NRule[] = [];
  for (const a of automations) {
    if (a.type === 'Tag' || a.type === 'System') continue;
    const map = RULES[a.name];
    if (!map) {
      skipped.push({ what: `automation "${a.name}"`, why: a.active ? 'no SAI trigger for it' : 'switched off in Movegistics; its template is listed in docs/hhmc-emails.md' });
      continue;
    }
    const delay = a.delayMinutes ?? refuse(`automation "${a.name}" has no delay.`);
    out.push({ ...map, name: a.name, delayMinutes: delay, isActive: a.active });
  }
  for (const name of Object.keys(RULES)) if (!automations.some((a) => a.name === name)) refuse(`no automation "${name}".`);
  return [...out, ...SAI_RULES];
}

export function parsePricingSettings(pricingJson: string, automationsJson: string): NPricing {
  const pricing = JSON.parse(pricingJson) as { lineItems?: LineItem[]; discounts?: Discount[] };
  const automations = JSON.parse(automationsJson) as Automation[];
  if (!Array.isArray(pricing.lineItems) || !Array.isArray(pricing.discounts)) refuse('pricing.json has no lineItems or discounts.');
  if (!Array.isArray(automations)) refuse('automations.json is not a list.');
  const skipped: NPricing['skipped'] = [];
  return {
    catalog: catalogOf(pricing.lineItems!, skipped),
    discounts: discountsOf(pricing.discounts!, skipped),
    rules: rulesOf(automations, skipped),
    skipped,
  };
}
