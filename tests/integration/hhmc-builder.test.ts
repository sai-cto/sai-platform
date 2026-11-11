/**
 * HHMC estimate builder (src/modules/hhmc/services/builder.ts): the managers' pricing rules
 * (Hired Hands Software Input, Nov 2026). Pure functions, the seeded catalog (HHMC's real line
 * items and rates); no database.
 */
import { describe, expect, it } from 'vitest';
import { buildLines, isTruckLine, sameName, type BuilderInput, type CatalogRow } from '@/modules/hhmc/services/builder';
import { computeTotals, lineTotalCents } from '@/modules/hhmc/services/pricing';
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
  truckCount: 1,
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
    expect(lines.filter((l) => l.name.startsWith('2 Men'))).toHaveLength(1);
  });

  it('Cornellian: the labor rate is $20/hr lower; the truck is not discounted', () => {
    const { lines } = buildLines({ ...base, cornellian: true }, catalog, settings);
    const labor = lines.filter((l) => l.name.startsWith('2 Men'));
    expect(labor.map((l) => l.rateCents)).toEqual([17500, 17500, 17500]);
    expect(labor.every((l) => l.discountType === null)).toBe(true);
    expect(lines.find((l) => l.name.includes('Truck'))!.rateCents).toBe(19500);
    expect(total(lines)).toBe(4 * (19500 - 2000) + 19500);
  });

  it('Cornellian stays right when the hours are changed later (it is a rate, not a fixed amount)', () => {
    const [load] = buildLines({ ...base, cornellian: true }, catalog, settings).lines;
    expect(lineTotalCents({ ...load, qtyHundredths: 500 })).toBe(5 * 17500);
  });

  it("customer's own truck: labor only, no truck fee", () => {
    const { lines, truckPricing } = buildLines({ ...base, ownTruck: true, distanceTenths: 4000 }, catalog, settings);
    expect(truckPricing).toBe('own_truck');
    expect(lines.some((l) => /truck/i.test(l.name))).toBe(false);
  });

  it('long distance over the threshold: small day fee plus the per-mile rate', () => {
    const { lines, truckPricing } = buildLines({ ...base, distanceTenths: 2834, truckSize: '22' }, catalog, settings);
    expect(truckPricing).toBe('long_distance');
    const day = lines.find((l) => l.name === "22' Truck Long Distance - Day")!;
    const mileage = lines.find((l) => l.name === "22' Truck Long Distance - Mileage")!;
    expect(day.rateCents).toBe(6500);
    expect(mileage.qtyHundredths).toBe(28340); // 283.4 miles
    expect(total([mileage])).toBe(Math.round(283.4 * 119)); // $337.25 at $1.19/mi
    expect(lines.some((l) => l.name.endsWith('Truck Local'))).toBe(false);
  });

  it('"over roughly 150 miles": exactly 150 is local, 150.1 is long distance', () => {
    expect(buildLines({ ...base, distanceTenths: 1500 }, catalog, settings).truckPricing).toBe('local');
    expect(buildLines({ ...base, distanceTenths: 1501 }, catalog, settings).truckPricing).toBe('long_distance');
  });

  it('two trucks pay two day fees (and both drive the miles)', () => {
    const local = buildLines({ ...base, truckCount: 2 }, catalog, settings).lines.find((l) => l.name === "16' Truck Local")!;
    expect(local.qtyHundredths).toBe(200);
    const ld = buildLines({ ...base, truckCount: 2, distanceTenths: 2000 }, catalog, settings).lines;
    expect(ld.find((l) => l.name.endsWith('- Day'))!.qtyHundredths).toBe(200);
    expect(ld.find((l) => l.name.endsWith('- Mileage'))!.qtyHundredths).toBe(40000);
  });

  it('unknown mileage is priced local with a warning', () => {
    const r = buildLines({ ...base, distanceTenths: null }, catalog, settings);
    expect(r.truckPricing).toBe('local');
    expect(r.warnings.join(' ')).toMatch(/No mileage/);
  });

  it('materials, packing help and valuation', () => {
    const box = catalog.find((c) => c.name === 'Medium Moving Box')!;
    const { lines } = buildLines({ ...base, materials: [{ catalogItemId: box.id, qtyHundredths: 1000 }], packingHundredths: 200, valuation: true }, catalog, settings);
    expect(lines.find((l) => l.name === 'Medium Moving Box')).toMatchObject({ qtyHundredths: 1000, rateCents: 204 });
    expect(lines.find((l) => l.name === 'Packing Labor')).toMatchObject({ qtyHundredths: 200, section: 'packing_labor' });
    expect(lines.find((l) => l.section === 'valuation')!.name).toMatch(/Basic Coverage/);
  });

  it('a missing line item is a clear error, not a wrong price', () => {
    expect(() => buildLines({ ...base, crewSize: 7 }, catalog, settings)).toThrow(/"7 Men" is missing/);
    expect(() => buildLines({ ...base, loadHundredths: 0, driveHundredths: 0, unloadHundredths: 0 }, catalog, settings)).toThrow(/labor hours/);
  });

  it('names match whatever dash or apostrophe a manager typed', () => {
    expect(sameName("16’ Truck Long Distance – Day", "16' Truck Long Distance - Day")).toBe(true);
    const typed = catalog.map((c) => (c.name === "16' Truck Local" ? { ...c, name: '16’  truck local' } : c));
    expect(buildLines(base, typed, settings).lines.at(-1)!.rateCents).toBe(19500);
  });

  it('knows which existing lines are truck lines (they are replaced, never doubled)', () => {
    expect(["16' Truck Local", "22' Truck Long Distance - Day", "26' Truck Long Distance - Mileage"].every(isTruckLine)).toBe(true);
    expect(['2 Men – Load', 'Medium Moving Box', 'Travel Charges'].some(isTruckLine)).toBe(false);
  });
});
