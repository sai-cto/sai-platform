/**
 * HHMC estimate builder (src/modules/hhmc/services/builder.ts): the managers' pricing rules
 * (Hired Hands Software Input, Nov 2026). Pure functions, fake catalog.
 */
import { describe, expect, it } from 'vitest';
import { buildLines, type BuilderInput, type CatalogRow } from '@/modules/hhmc/services/builder';
import { computeTotals } from '@/modules/hhmc/services/pricing';
import { CATALOG } from '@/modules/hhmc/seed-data';

const catalog: CatalogRow[] = CATALOG.map((c, i) => ({ id: `item-${i}`, name: c.name, section: c.section, unit: c.unit, rateCents: c.rateCents, isActive: true }));
const settings = { longDistanceMiles: 150, cornellianDiscountPerHour: 20 };
const base: BuilderInput = {
  crewSize: 2,
  hoursMode: 'split',
  totalHundredths: 0,
  loadHundredths: 200,
  driveHundredths: 50,
  unloadHundredths: 150,
  cornellian: false,
  ownTruck: false,
  truckSize: '16',
  truckDaysHundredths: 100,
  distanceTenths: 120, // 12 miles
  materials: [],
  packingHundredths: 0,
  valuation: false,
};
const total = (lines: ReturnType<typeof buildLines>['lines']) =>
  computeTotals(lines, { serviceTaxOn: false, convenienceFeeOn: false, serviceTaxBp: 0, convenienceFeeBp: 0 }).subtotalCents;

describe('estimate builder', () => {
  it('local move: load / drive / unload at the crew rate plus the local truck day fee', () => {
    const { lines, truckPricing } = buildLines(base, catalog, settings);
    expect(truckPricing).toBe('local');
    expect(lines.map((l) => l.name)).toEqual(['2 Men – Load', '2 Men – Drive', '2 Men – Unload', "16' Truck Local"]);
    // 4 h × $195 + $195 truck = $975.00
    expect(total(lines)).toBe(4 * 19500 + 19500);
  });

  it('one total labor line when asked', () => {
    const { lines } = buildLines({ ...base, hoursMode: 'total', totalHundredths: 350 }, catalog, settings);
    expect(lines[0]).toMatchObject({ name: '2 Men', qtyHundredths: 350 });
    expect(lines.filter((l) => l.section === 'transportation_labor' && l.name.startsWith('2 Men'))).toHaveLength(1);
  });

  it('Cornellian: $20 off every labor hour, nothing off the truck', () => {
    const { lines } = buildLines({ ...base, cornellian: true }, catalog, settings);
    const labor = lines.filter((l) => l.name.startsWith('2 Men'));
    expect(labor.map((l) => l.discountValue)).toEqual([4000, 1000, 3000]);
    expect(lines.find((l) => l.name.includes('Truck'))!.discountValue).toBeNull();
    expect(total(lines)).toBe(4 * (19500 - 2000) + 19500);
  });

  it("customer's own truck: labor only, no truck fee", () => {
    const { lines, truckPricing } = buildLines({ ...base, ownTruck: true, distanceTenths: 4000 }, catalog, settings);
    expect(truckPricing).toBe('own_truck');
    expect(lines.some((l) => /truck/i.test(l.name))).toBe(false);
  });

  it('long distance at or above the threshold: small day fee plus the per-mile rate', () => {
    const { lines, truckPricing } = buildLines({ ...base, distanceTenths: 2834, truckSize: '22' }, catalog, settings);
    expect(truckPricing).toBe('long_distance');
    const day = lines.find((l) => l.name === "22' Truck Long Distance – Day")!;
    const mileage = lines.find((l) => l.name === "22' Truck Long Distance – Mileage")!;
    expect(day.rateCents).toBe(6500);
    expect(mileage.qtyHundredths).toBe(28340); // 283.4 miles
    expect(total([mileage])).toBe(Math.round(283.4 * 119)); // $337.25 at $1.19/mi
    expect(lines.some((l) => l.name.endsWith('Truck Local'))).toBe(false);
  });

  it('just under the threshold is local', () => {
    expect(buildLines({ ...base, distanceTenths: 1499 }, catalog, settings).truckPricing).toBe('local');
    expect(buildLines({ ...base, distanceTenths: 1500 }, catalog, settings).truckPricing).toBe('long_distance');
  });

  it('unknown mileage is priced local with a warning', () => {
    const r = buildLines({ ...base, distanceTenths: null }, catalog, settings);
    expect(r.truckPricing).toBe('local');
    expect(r.warnings.join(' ')).toMatch(/No mileage/);
  });

  it('materials, packing help and valuation', () => {
    const box = catalog.find((c) => c.name === 'Medium Box')!;
    const { lines } = buildLines({ ...base, materials: [{ catalogItemId: box.id, qtyHundredths: 1000 }], packingHundredths: 200, valuation: true }, catalog, settings);
    expect(lines.find((l) => l.name === 'Medium Box')).toMatchObject({ qtyHundredths: 1000, rateCents: 350 });
    expect(lines.find((l) => l.name === 'Packing Labor')).toMatchObject({ qtyHundredths: 200, section: 'packing_labor' });
    expect(lines.find((l) => l.section === 'valuation')!.rateCents).toBe(0);
  });

  it('a missing line item is a clear error, not a wrong price', () => {
    expect(() => buildLines({ ...base, crewSize: 7 }, catalog, settings)).toThrow(/"7 Men" is missing/);
    expect(() => buildLines({ ...base, loadHundredths: 0, driveHundredths: 0, unloadHundredths: 0 }, catalog, settings)).toThrow(/labor hours/);
  });
});
