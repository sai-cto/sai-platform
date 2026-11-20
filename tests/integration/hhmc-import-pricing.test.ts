/**
 * The Movegistics importer, pricing settings and automatic emails (settings/pricing.json,
 * automations.json, email-templates-extra.md): every rate copied exactly, the email automations
 * set up with Movegistics' triggers and delays, re-runs change nothing, a manager's change is kept.
 * Made-up JSON in the export's shape; the rates are HHMC's published ones (not personal data).
 */
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withScope, type Scope } from '@/core/db/scope';
import { updateRecord } from '@/core/records/records';
import { catalogItemEntity } from '@/modules/hhmc/entities';
import { hhmcAutomationRules, hhmcCatalogItems, hhmcDiscounts } from '@/modules/hhmc/schema';
import { loadPricing } from '../../scripts/hhmc-import/load-pricing';
import { pricingReport } from '../../scripts/hhmc-import/reconcile-pricing';
import { extraTemplates } from '../../scripts/hhmc-import/settings-docs';
import { parsePricingSettings } from '../../scripts/hhmc-import/settings-pricing';
import { gm } from './hhmc-helpers';
import { systemContext } from './helpers';

const item = (title: string, category: string, rate: number | null, unit: string | null, active = true) => ({ title, category, unit, rate, active, defaultQty: 1, taxable: false });
const PRICING = {
  lineItems: [
    item('2 Men', 'Move Charges', 195, 'Per Hour'),
    item('3 Men', 'Move Charges', 240, 'Per Hour'),
    item('Men', 'Move Charges', null, null),
    item("16' Truck Local", 'Equipment', 195, 'Per Day'),
    item("16' Truck Long Distance - Mileage", 'Equipment', 1.09, 'Per Mile'),
    item('Medium Moving Box', 'Packing Materials', 2.04, 'Each'),
    item('Dish Saver Packing Kit with Moving Box', 'Packing Materials', 14.95, null),
    item('Travel Charges', 'Additional Services', 195, 'Per Hour'),
    item('Old Box', 'Packing Materials', 1, 'Each', false),
  ],
  discounts: [
    { name: 'Friends & Family Discount', type: 'percent', value: 5, active: true },
    { name: 'Cornellian Discount', type: 'percent', value: 5, active: true },
    { name: 'Repeat Customer Discount', type: 'percent', value: 5, active: true },
  ],
};
const auto = (name: string, delayMinutes: number, type = 'Email', active = true) => ({ name, type, active, delayMinutes });
const AUTOMATIONS = [
  auto("Didn't Connect", 1440),
  auto('Last Check In', 2880),
  auto('Sorry we missed you', 0),
  auto('Same Day Estimate Follow Up', 120),
  auto('Is the price giving you pause?', 1440),
  auto('Quick note on your move date', 4320),
  auto('Still thinking it over?', 10080),
  auto('Past Due Reminder', 11520),
  auto('How did your move go?', 0),
  auto('Payment Receipt Automation', 0),
  auto('Lead Nurturing: Welcome New Lead', 0, 'Email', false),
  auto('Estimate Provided', 0, 'Tag'),
  auto('Estimate sent to customer', 0, 'System'),
];
const parse = (p: object = PRICING, a: object = AUTOMATIONS) => parsePricingSettings(JSON.stringify(p), JSON.stringify(a));

describe('pricing settings: parsed from the export', () => {
  it('copies every active line item with its exact rate in cents and its unit', () => {
    const { catalog, skipped } = parse();
    const by = (name: string) => catalog.find((c) => c.name === name);
    expect(by('2 Men')).toMatchObject({ rateCents: 19500, unit: 'hour', section: 'transportation_labor', category: 'Move Charges' });
    expect(by("16' Truck Long Distance - Mileage")).toMatchObject({ rateCents: 109, unit: 'mile' });
    expect(by('Medium Moving Box')).toMatchObject({ rateCents: 204, unit: 'each', section: 'packing_materials' });
    expect(by('Dish Saver Packing Kit with Moving Box')).toMatchObject({ rateCents: 1495, unit: 'each' });
    expect(by('Travel Charges')).toMatchObject({ rateCents: 19500, section: 'additional_services' });
    expect(catalog.filter((c) => c.isDefaultForLocal).map((c) => c.name)).toEqual(["16' Truck Local"]);
    // SAI's own items, which Movegistics has no line item for.
    expect(by('Packing Labor')).toMatchObject({ section: 'packing_labor', rateCents: 19500 });
    expect(by('Men')).toBeUndefined();
    expect(by('Old Box')).toBeUndefined();
    expect(skipped.map((x) => x.what)).toEqual(expect.arrayContaining(['line item "Men"', 'line item "Old Box"']));
    expect(new Set(catalog.map((c) => c.sortOrder)).size).toBe(catalog.length);
  });

  it('copies the discounts, except the Cornellian one SAI prices per labor hour', () => {
    const { discounts, skipped } = parse();
    expect(discounts).toEqual([
      { name: 'Friends & Family', percentBp: 500, isActive: true },
      { name: 'Repeat Customer', percentBp: 500, isActive: true },
    ]);
    expect(skipped.find((x) => x.what === 'discount "Cornellian Discount"')?.why).toMatch(/labor hour/);
  });

  it("sets up each email automation with Movegistics' delay; tag-only and switched-off ones send nothing", () => {
    const { rules, skipped } = parse();
    const by = (key: string) => rules.find((r) => r.key === key);
    expect(by('lead_sorry')).toMatchObject({ trigger: 'lead_no_contact', delayMinutes: 0 });
    expect(by('lead_didnt_connect')).toMatchObject({ trigger: 'lead_no_contact', delayMinutes: 1440 });
    expect(by('lead_last_checkin')).toMatchObject({ trigger: 'lead_no_contact', delayMinutes: 2880 });
    expect(by('drip_same_day')).toMatchObject({ trigger: 'estimate_sent', delayMinutes: 120, respectsOptIn: true });
    expect(by('drip_day7')).toMatchObject({ delayMinutes: 10080 });
    expect(by('past_due')).toMatchObject({ trigger: 'invoice_sent', delayMinutes: 8 * 1440 });
    expect(by('review_request')).toMatchObject({ trigger: 'invoice_paid', delayMinutes: 0 });
    expect(by('payment_receipt')).toMatchObject({ trigger: 'payment_received', delayMinutes: 0, respectsOptIn: false });
    // SAI's additions: the booking confirmation and the move reminder.
    expect(by('booked')).toMatchObject({ trigger: 'job_booked' });
    expect(by('move_reminder_2d')).toMatchObject({ trigger: 'move_reminder', delayMinutes: -2880 });
    expect(rules).toHaveLength(12);
    expect(skipped.map((x) => x.what)).toContain('automation "Lead Nurturing: Welcome New Lead"');
  });

  it('refuses an export it does not understand rather than guess a price', () => {
    expect(() => parse({ ...PRICING, lineItems: [...PRICING.lineItems, item('Crate', 'Crating', 50, 'Each')] })).toThrow(/Refusing.*Crating/);
    expect(() => parse({ ...PRICING, lineItems: [...PRICING.lineItems, item('Ton', 'Equipment', 5, 'Per Ton')] })).toThrow(/Refusing.*Per Ton/);
    expect(() => parse(PRICING, AUTOMATIONS.filter((a) => a.name !== 'Past Due Reminder'))).toThrow(/Refusing.*Past Due Reminder/);
  });
});

describe('pricing settings: loaded into the database', () => {
  it('creates the catalog, discounts and rules once; a re-run changes nothing; a manager change is kept; the report matches', async () => {
    const ctx = await systemContext('hhmc', 'sandbox');
    const batch = <T,>(fn: (s: Scope) => Promise<T>) => withScope(ctx, 'hhmc.import.run', fn);
    const p = parse();
    const first = await loadPricing(batch, p);
    expect(first.catalog_item.created + first.catalog_item.updated + first.catalog_item.kept + first.catalog_item.unchanged).toBe(p.catalog.length);

    const again = await loadPricing(batch, p);
    expect(again.catalog_item).toMatchObject({ created: 0, updated: 0 });
    expect(again.discount).toMatchObject({ created: 0, updated: 0 });
    expect(again.automation_rule).toMatchObject({ created: 0, updated: 0 });

    const rows = await batch((s) => s.db.select().from(hhmcCatalogItems).where(and(s.where(hhmcCatalogItems), eq(hhmcCatalogItems.name, '2 Men'))));
    expect(rows).toHaveLength(1);
    expect(rows[0].rateCents).toBe(19500);
    const rule = await batch(async (s) => (await s.db.select().from(hhmcAutomationRules).where(and(s.where(hhmcAutomationRules), eq(hhmcAutomationRules.key, 'drip_same_day'))))[0]);
    expect(rule).toMatchObject({ delayMinutes: 120, templateKey: 'drip_same_day', isActive: true });
    const discounts = await batch((s) => s.db.select().from(hhmcDiscounts).where(and(s.where(hhmcDiscounts), eq(hhmcDiscounts.name, 'Friends & Family'))));
    expect(discounts).toHaveLength(1);

    // A manager raises a box price in SAI; the next import keeps it and the report says so.
    const box = (await batch((s) => s.db.select().from(hhmcCatalogItems).where(and(s.where(hhmcCatalogItems), eq(hhmcCatalogItems.name, 'Medium Moving Box')))))[0];
    const manager = await gm('sandbox');
    await withScope(manager, 'hhmc.catalog.write', (s) => updateRecord(s, catalogItemEntity, box.id, { rateCents: 250 }));
    try {
      const third = await loadPricing(batch, p);
      expect(third.catalog_item).toMatchObject({ created: 0, updated: 0 });
      const kept = await batch((s) => s.db.select().from(hhmcCatalogItems).where(and(s.where(hhmcCatalogItems), eq(hhmcCatalogItems.id, box.id))));
      expect(kept[0].rateCents).toBe(250);
      const report = await batch((s) => pricingReport(s, p));
      expect(report.markdown).toMatch(/Medium Moving Box": Movegistics \$2\.04\/each, SAI \$2\.50\/each/);
    } finally {
      await withScope(manager, 'hhmc.catalog.write', (s) => updateRecord(s, catalogItemEntity, box.id, { rateCents: 204 }));
    }
  });
});

describe("Movegistics' own estimate emails", () => {
  const EXTRA = [
    '### System Generated Emails › ACTIVE Post-Signature Estimate Template (Estimates)',
    '',
    '- Subject: `Estimate #{{estimate.displayId}} has been signed by you.`',
    '',
    '```text',
    'Hello {{contacts.firstName}} {{contacts.lastName}},',
    'This is to inform that you have successfully e-signed Estimate {{estimate.displayId}}. Please click on the link below to review.',
    '',
    ' [{{reviewUrl}}]',
    '',
    'Please find the attached final copy of the estimate.',
    'Thank you,',
    '{{estimate.senderFirstName}} {{estimate.senderLastName}}',
    '',
    'Powered by Movegistics.com [https://example.com]',
    '```',
    '',
    '### System Generated Emails › ACTIVE Sent Estimate Template (Estimates)',
    '',
    '- Subject: `Please Review: {{estimate.title}}`',
    '',
    '```text',
    'Hello {{contacts.firstName}} {{contacts.lastName}},',
    'Thank you for allowing {{estimate.senderCompanyName}} the opportunity to assist. Please click on the link below to review and sign.',
    '',
    ' [{{url}}]',
    '',
    'Thank you,',
    '{{estimate.senderFirstName}} {{estimate.senderLastName}}',
    '```',
    '',
  ].join('\n');

  it('the estimate and its signed copy use the templates Movegistics sent, with our merge fields', () => {
    const [sent, signed] = extraTemplates(EXTRA);
    expect(sent).toMatchObject({ key: 'estimate_email', name: 'Sent Estimate Template', subject: 'Please Review: {{estimateTitle}}' });
    expect(sent.body).toBe('Hello {{customerName}},\nThank you for allowing {{businessName}} the opportunity to assist. Please click on the link below to review and sign.\n\n{{link}}\n\nThank you,\nThe Hired Hands Team');
    expect(signed).toMatchObject({ key: 'estimate_signed', subject: 'Estimate #{{estimateNumber}} has been signed by you.' });
    expect(signed.body).toContain('e-signed Estimate {{estimateNumber}}');
    expect(signed.body).not.toMatch(/attached|Movegistics|reviewUrl/);
    expect(() => extraTemplates(EXTRA.replace('ACTIVE Sent Estimate Template', 'Other'))).toThrow(/Refusing.*Sent Estimate/);
  });
});
