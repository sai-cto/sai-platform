/**
 * BRSS: the ported business rules (rules.ts) and the workflows built on them, end to end
 * against the real database with the seeded fake price list.
 */
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { listBusinessActivity } from '@/core/audit/read';
import { appointments, notifications, payments } from '@/core/db/schema';
import { withScope } from '@/core/db/scope';
import { ForbiddenError, NotFoundError, ValidationError } from '@/core/errors';
import { addMember, listMembers, setMemberPermissions } from '@/core/people/memberships';
import { buildBusinessContext, type BusinessContext } from '@/core/tenancy/context';
import { P } from '@/modules/brss/permissions';
import {
  addDays,
  addMonths,
  articleTypeChoices,
  becomesStored,
  billableWeight,
  billableWeightProblem,
  blockApplies,
  blockRanges,
  campusCategoryFor,
  computeTotals,
  dollarsToCents,
  earliestBookableDate,
  findRate,
  findZone,
  insurancePriceCents,
  isOverweight,
  localDate,
  localTime,
  maxDiscountCents,
  pickStorageTermProduct,
  priceArticle,
  slotOf,
  slotRange,
  storageExpirationDate,
  zipPrefix,
  type Catalog,
  type PricedArticle,
} from '@/modules/brss/rules';
import { brssArticles, brssBuildings, brssOrderItems, brssOrders, brssRegions } from '@/modules/brss/schema';
import {
  addCrewMember,
  assignTruck,
  bookAppointment,
  createBlock,
  createTruck,
  listSchedule,
  rescheduleAppointment,
  setAppointmentStatus,
} from '@/modules/brss/services/appointments';
import {
  attachArticle,
  detachArticle,
  intakeArticle,
  listArticles,
  setArticleLocation,
  setArticleStatus,
  setOrderArticlesStatus,
  updateArticleOnOrder,
} from '@/modules/brss/services/articles';
import {
  createProduct,
  createZipZone,
  getPlaces,
  getPriceList,
  lookupShipping,
  removeCatalogItem,
  setStorageTermProduct,
  setZoneRate,
  updateProduct,
} from '@/modules/brss/services/catalog';
import { addCharge, payOrder, pricingProblems, refundOrderPayment, removeCharge } from '@/modules/brss/services/charges';
import { createOrder, getOrder, listOrders, setOrderStatus, updateOrder } from '@/modules/brss/services/orders';
import { settingsDefaults } from '@/modules/brss/settings';
import { USERS, ctxFor } from './helpers';

const TZ = 'America/New_York';
let counter = 0;
const tag = () => `T${Date.now().toString(36)}${(counter += 1)}`;
const admin = () => ctxFor(USERS.brssAdmin, 'brss');
const key = () => `test-${tag()}`;

// ================================================================ the rules, on their own

describe('rules: billable weight (R-ORD-056, KI-2)', () => {
  it('is the larger of actual and dimensional weight (÷139), rounded up', () => {
    // 18 × 18 × 18 = 5,832 cubic inches ÷ 139 = 41.96 → 42 lb, more than the 30 lb on the scale.
    expect(billableWeight({ lengthIn: 18, widthIn: 18, heightIn: 18, weightLb: 30 }, 139)).toBe(42);
    // A small heavy box bills its real weight.
    expect(billableWeight({ lengthIn: 12, widthIn: 12, heightIn: 12, weightLb: 40 }, 139)).toBe(40);
    // The old phone screen used ÷166 and would have shown 36 lb for the first box. Not copied.
    expect(billableWeight({ lengthIn: 18, widthIn: 18, heightIn: 18, weightLb: 30 }, 166)).toBe(36);
    expect(settingsDefaults.dimensionalDivisor).toBe(139);
  });

  it('must be from 1 lb to the maximum (R-ORD-058, R-ORD-067)', () => {
    expect(billableWeightProblem(1, 150)).toBeNull();
    expect(billableWeightProblem(150, 150)).toBeNull();
    expect(billableWeightProblem(151, 150)).toMatch(/1 to 150 lb/);
    expect(billableWeightProblem(0, 150)).toMatch(/1 to 150 lb/);
  });

  it('a box is overweight from 70 lb (R-ORD-033)', () => {
    expect(isOverweight(69, 70)).toBe(false);
    expect(isOverweight(70, 70)).toBe(true);
  });
});

describe('rules: dates (R-ORD-089, KI-1)', () => {
  it('adds calendar months, clamping to the end of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-05-14', 4)).toBe('2026-09-14');
    expect(addMonths('2026-10-31', 4)).toBe('2027-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('never lands a year late: the three cases the old formula got wrong', () => {
    // KI-1: April + 8, June + 6 and August + 4 months gave December of the FOLLOWING year.
    expect(storageExpirationDate('2026-04-10', 8)).toBe('2026-12-10');
    expect(storageExpirationDate('2026-06-10', 6)).toBe('2026-12-10');
    expect(storageExpirationDate('2026-08-10', 4)).toBe('2026-12-10');
  });

  it('for every start month and every term, the result is that many months later', () => {
    for (let month = 1; month <= 12; month += 1) {
      for (const term of [4, 6, 8]) {
        const start = `2026-${String(month).padStart(2, '0')}-15`;
        const end = storageExpirationDate(start, term)!;
        const [y, m, d] = end.split('-').map(Number);
        expect((y - 2026) * 12 + m - month, `${start} + ${term}`).toBe(term);
        expect(d).toBe(15);
      }
    }
    expect(storageExpirationDate(null, 4)).toBeNull();
    expect(storageExpirationDate('2026-05-01', null)).toBeNull();
  });

  it('time windows are local Ithaca time, in summer and in winter', () => {
    expect(slotRange('2026-07-01', '09', TZ).startsAt.toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(slotRange('2026-12-01', '09', TZ).startsAt.toISOString()).toBe('2026-12-01T14:00:00.000Z');
    expect(slotRange('2026-12-01', '17', TZ).endsAt.toISOString()).toBe('2026-12-02T00:00:00.000Z');
    expect(slotOf(new Date('2026-07-01T17:00:00.000Z'), TZ)).toBe('13');
    expect(localDate(new Date('2026-07-02T02:30:00.000Z'), TZ)).toBe('2026-07-01');
    // The day the clocks change is 23 hours long.
    expect(localTime('2026-03-08', 24, TZ).getTime() - localTime('2026-03-08', 0, TZ).getTime()).toBe(23 * 3600_000);
    expect(earliestBookableDate('2026-05-30', 2)).toBe('2026-06-01');
  });
});

describe('rules: unavailability (R-SCH-060 to R-SCH-070)', () => {
  it('all day, or all five windows, is one range from the first midnight to the last', () => {
    const allDay = blockRanges({ startDate: '2026-07-01', endDate: '2026-07-03', allDay: true, slots: [] }, TZ);
    expect(allDay).toHaveLength(1);
    expect(allDay[0].startsAt.toISOString()).toBe('2026-07-01T04:00:00.000Z');
    expect(allDay[0].endsAt.toISOString()).toBe('2026-07-04T04:00:00.000Z');
    // R-SCH-068: ticking all five windows is the same as all day.
    expect(blockRanges({ startDate: '2026-07-01', endDate: '2026-07-03', allDay: false, slots: ['09', '11', '13', '15', '17'] }, TZ)).toEqual(allDay);
  });

  it('some windows give one range per day per run of neighbouring windows', () => {
    const ranges = blockRanges({ startDate: '2026-07-01', endDate: '2026-07-02', allDay: false, slots: ['09', '11', '15'] }, TZ);
    expect(ranges.map((r) => [r.startsAt.toISOString(), r.endsAt.toISOString()])).toEqual([
      ['2026-07-01T13:00:00.000Z', '2026-07-01T17:00:00.000Z'], // 9–1
      ['2026-07-01T19:00:00.000Z', '2026-07-01T21:00:00.000Z'], // 3–5
      ['2026-07-02T13:00:00.000Z', '2026-07-02T17:00:00.000Z'],
      ['2026-07-02T19:00:00.000Z', '2026-07-02T21:00:00.000Z'],
    ]);
    // R-SCH-070: not all day and no windows blocks nothing.
    expect(blockRanges({ startDate: '2026-07-01', endDate: '2026-07-02', allDay: false, slots: [] }, TZ)).toEqual([]);
  });

  it('a block with no buildings applies everywhere; with buildings, only there (R-SCH-061, R-SCH-065)', () => {
    expect(blockApplies([], 'b1')).toBe(true);
    expect(blockApplies([], null)).toBe(true);
    expect(blockApplies(['b1', 'b2'], 'b1')).toBe(true);
    expect(blockApplies(['b1', 'b2'], 'b3')).toBe(false);
    expect(blockApplies(['b1'], null)).toBe(false);
  });
});

describe('rules: zones (R-ORD-009, R-SCH-146 to R-SCH-153)', () => {
  const zones = [
    { zipLow: 5, zipHigh: 99, zone: 3 },
    { zipLow: 100, zipHigh: 149, zone: 2 },
  ];
  it('uses the first three digits of the zip, read as a number', () => {
    expect(zipPrefix('14850')).toBe(148);
    expect(zipPrefix('02139')).toBe(21); // a leading zero
    expect(zipPrefix('14850-1234')).toBeNull(); // R-SCH-147: any non-digit means no zone
    expect(zipPrefix('')).toBeNull();
    expect(zipPrefix(null)).toBeNull();
    expect(findZone(zones, '14850')).toBe(2);
    expect(findZone(zones, '02139')).toBe(3);
    expect(findZone(zones, '99501')).toBeNull();
  });

  it('a rate needs exactly that zone and exactly that weight (R-SCH-153)', () => {
    const rates = [{ zone: 2, weightLb: 10, shipHomeCents: 1500, shipCornellCents: 1400 }];
    expect(findRate(rates, 2, 10)?.shipHomeCents).toBe(1500);
    expect(findRate(rates, 2, 9)).toBeNull(); // no "next weight up"
    expect(findRate(rates, 3, 10)).toBeNull();
  });
});

describe('rules: money (R-ORD-113 to R-ORD-116, R-ORD-043)', () => {
  it('tax is on (subtotal − discount); the tip is not taxed; halves round up', () => {
    expect(computeTotals({ subtotalCents: 10000, discountCents: 1000, tipCents: 500, taxPercent: 8 })).toEqual({
      subtotalCents: 10000,
      discountCents: 1000,
      taxCents: 720,
      tipCents: 500,
      totalCents: 10220,
    });
    // 4,620 × 8% = 369.6 → 370.   25 × 8% = 2.0;   31 × 8% = 2.48 → 2;   1,931 × 8% = 154.48 → 154; 19 × 50% = 9.5 → 10.
    expect(computeTotals({ subtotalCents: 4620, discountCents: 0, tipCents: 0, taxPercent: 8 }).taxCents).toBe(370);
    expect(computeTotals({ subtotalCents: 19, discountCents: 0, tipCents: 0, taxPercent: 50 }).taxCents).toBe(10);
    // A full discount leaves only the tip.
    expect(computeTotals({ subtotalCents: 5000, discountCents: 5000, tipCents: 300, taxPercent: 8 }).totalCents).toBe(300);
  });

  it('the discount cap is 5% for staff and the whole subtotal with the special permission', () => {
    expect(maxDiscountCents(10000, false, 5)).toBe(500);
    expect(maxDiscountCents(10000, true, 5)).toBe(10000);
    expect(maxDiscountCents(999, false, 5)).toBe(50); // 49.95 rounds half-up
  });

  it('insurance costs 10% of the declared value', () => {
    expect(insurancePriceCents(30000, 10)).toBe(3000);
    expect(dollarsToCents('12.5')).toBe(1250);
    expect(dollarsToCents('$7')).toBe(700);
    expect(dollarsToCents('1,000')).toBeNull();
    expect(dollarsToCents('-5')).toBeNull();
    expect(dollarsToCents('abc')).toBeNull();
  });
});

describe('rules: pricing an article (R-ORD-032 to R-ORD-043, KI-5)', () => {
  const product = (id: string, kind: Catalog['products'][number]['kind'], cents: number, role: Catalog['products'][number]['role'] = null, isActive = true) => ({ id, name: id, kind, role, unitPriceCents: cents, isActive });
  const catalog: Catalog = {
    products: [
      product('s4', 'storage_box', 110),
      product('s6', 'storage_box', 150),
      product('s4ow', 'storage_box', 140),
      product('lamp', 'storage_item', 1200),
      product('other', 'storage_item', 0, 'other_non_boxed'),
      product('flat', 'flat_rate_box', 900),
      product('home', 'shipping', 0, 'ship_to_home'),
      product('cu', 'shipping', 0, 'ship_to_cornell'),
      product('cufee', 'shipping', 1500, 'flat_rate_cornell'),
      product('3pfee', 'shipping', 2500, 'flat_rate_third_party'),
      product('ins', 'insurance', 0, 'insurance'),
    ],
    storageTerms: [
      { termMonths: 4, isOverweight: false, productId: 's4' },
      { termMonths: 6, isOverweight: false, productId: 's6' },
      { termMonths: 4, isOverweight: true, productId: 's4ow' },
    ],
    zipZones: [{ zipLow: 100, zipHigh: 149, zone: 2 }],
    zoneRates: [{ zone: 2, weightLb: 42, shipHomeCents: 3000, shipCornellCents: 2700 }],
  };
  const article = (over: Partial<PricedArticle> = {}): PricedArticle => ({
    id: 'a1',
    articleNumber: 'A-000001',
    type: 'standard_box',
    productId: null,
    billableWeightLb: 42,
    additionalInsuranceCents: 0,
    otherStoragePriceCents: null,
    ...over,
  });
  const price = (over: Partial<Parameters<typeof priceArticle>[0]> = {}) =>
    priceArticle({
      services: ['storage'],
      storageMonths: 4,
      shipToZone: null,
      article: article(),
      link: { cornellShippingAccount: false, receivedFromZip: null },
      catalog,
      settings: settingsDefaults,
      ...over,
    });
  const amounts = (result: ReturnType<typeof priceArticle>) => result.lines.map((l) => [l.rule, l.productId, l.unitPriceCents]);

  it('standard box storage = price per pound for the term × billable weight (R-ORD-033)', () => {
    expect(amounts(price())).toEqual([['storage', 's4', 110 * 42]]);
    expect(amounts(price({ storageMonths: 6 }))).toEqual([['storage', 's6', 150 * 42]]);
    // 70 lb and over uses the overweight product.
    expect(amounts(price({ article: article({ billableWeightLb: 70 }) }))).toEqual([['storage', 's4ow', 140 * 70]]);
  });

  it('a term with no row uses the nearest shorter term, never a longer one (R-ORD-034)', () => {
    expect(pickStorageTermProduct(catalog.storageTerms, 5, false)?.productId).toBe('s4');
    expect(pickStorageTermProduct(catalog.storageTerms, 8, false)?.productId).toBe('s6');
    expect(pickStorageTermProduct(catalog.storageTerms, 3, false)).toBeNull();
    expect(pickStorageTermProduct(catalog.storageTerms, 8, true)?.productId).toBe('s4ow');
    // With no shorter row there is no price, and the screen is told so (KI-5).
    const result = price({ storageMonths: 3 });
    expect(result.lines).toEqual([]);
    expect(result.problems[0]).toMatch(/no storage price is set up/);
  });

  it('non-boxed items and flat rate boxes = price per month × months (R-ORD-035, R-ORD-037)', () => {
    expect(amounts(price({ article: article({ type: 'non_boxed', productId: 'lamp', billableWeightLb: 0 }) }))).toEqual([['storage', 'lamp', 1200 * 4]]);
    expect(amounts(price({ storageMonths: 8, article: article({ type: 'flat_rate_box', productId: 'flat', billableWeightLb: 0 }) }))).toEqual([['storage', 'flat', 900 * 8]]);
  });

  it('an "Other" item uses the monthly price typed at intake (R-ORD-036)', () => {
    expect(amounts(price({ article: article({ type: 'non_boxed', productId: 'other', otherStoragePriceCents: 2000 }) }))).toEqual([['storage', 'other', 8000]]);
    expect(price({ article: article({ type: 'non_boxed', productId: 'other' }) }).problems[0]).toMatch(/monthly storage price/);
  });

  it('ship to home: standard boxes only, from the zone table (R-ORD-039)', () => {
    expect(amounts(price({ services: ['ship_to_home'], shipToZone: 2 }))).toEqual([['ship_to_home', 'home', 3000]]);
    // Non-boxed items get no shipping line.
    expect(price({ services: ['ship_to_home'], shipToZone: 2, article: article({ type: 'non_boxed', productId: 'lamp' }) }).lines).toEqual([]);
    // KI-5: no zone, or no rate row, is reported instead of silently charging nothing.
    expect(price({ services: ['ship_to_home'], shipToZone: null }).problems[0]).toMatch(/has no zone/);
    expect(price({ services: ['ship_to_home'], shipToZone: 2, article: article({ billableWeightLb: 43 }) }).problems[0]).toMatch(/no shipping rate for zone 2 at 43 lb/);
  });

  it('ship to Cornell: fee + zone price on the Cornell account; one flat fee for a third party (R-ORD-040, R-ORD-041)', () => {
    expect(amounts(price({ services: ['ship_to_cornell'], link: { cornellShippingAccount: true, receivedFromZip: '11215' } }))).toEqual([
      ['ship_to_cornell_fee', 'cufee', 1500],
      ['ship_to_cornell', 'cu', 2700],
    ]);
    expect(amounts(price({ services: ['ship_to_cornell'], article: article({ billableWeightLb: 0 }) }))).toEqual([['ship_to_cornell_fee', '3pfee', 2500]]);
    // The old system created the shipping line at $0 when the zone was missing. Here it is a problem.
    const noZone = price({ services: ['ship_to_cornell'], link: { cornellShippingAccount: true, receivedFromZip: '99999' } });
    expect(amounts(noZone)).toEqual([['ship_to_cornell_fee', 'cufee', 1500]]);
    expect(noZone.problems[0]).toMatch(/"received from" zip has no zone/);
  });

  it('insurance: one line at 10% of the declared value, on any order (R-ORD-043)', () => {
    expect(amounts(price({ services: ['packing'], article: article({ additionalInsuranceCents: 50000 }) }))).toEqual([['insurance', 'ins', 5000]]);
  });

  it('a storage + ship-to-home order prices both; inactive or missing products are reported (R-ORD-030)', () => {
    expect(amounts(price({ services: ['storage', 'ship_to_home'], shipToZone: 2 })).map((l) => l[0])).toEqual(['storage', 'ship_to_home']);
    const inactive = { ...catalog, products: catalog.products.map((p) => (p.id === 'home' || p.id === 's4' ? { ...p, isActive: false } : p)) };
    const result = price({ services: ['storage', 'ship_to_home'], shipToZone: 2, catalog: inactive });
    expect(result.lines).toEqual([]);
    expect(result.problems).toHaveLength(2);
    expect(price({ storageMonths: null }).problems[0]).toMatch(/no storage term/);
  });
});

describe('rules: small decisions', () => {
  it('only a storage order that is not ship-to-Cornell offers all article types (R-ORD-065)', () => {
    expect(articleTypeChoices(['storage'])).toEqual(['standard_box', 'non_boxed', 'flat_rate_box']);
    expect(articleTypeChoices(['storage', 'ship_to_home'])).toHaveLength(3);
    expect(articleTypeChoices(['storage', 'ship_to_cornell'])).toEqual(['standard_box']);
    expect(articleTypeChoices(['ship_to_home'])).toEqual(['standard_box']);
  });

  it('an article becomes Stored when it gets its first location, not on later edits (R-ORD-076)', () => {
    const none = { warehouseId: null, section: null, row: null, pallet: null };
    expect(becomesStored(none, { ...none, row: 'C' })).toBe(true);
    expect(becomesStored(none, { ...none, pallet: 0 })).toBe(true);
    expect(becomesStored({ ...none, row: 'C' }, { ...none, row: 'D', pallet: 4 })).toBe(false);
    expect(becomesStored(none, none)).toBe(false);
  });

  it('campus category comes from the building; no building means off campus (R-SCH-200, KI-7)', () => {
    expect(campusCategoryFor({ campusCategory: 'on_campus' })).toBe('on_campus');
    expect(campusCategoryFor({ campusCategory: 'off_campus' })).toBe('off_campus');
    expect(campusCategoryFor(null)).toBe('off_campus');
  });
});

// ================================================================ the workflows

/** A new storage order for a new fake customer. */
async function storageOrder(ctx: BusinessContext, over: Record<string, unknown> = {}) {
  return createOrder(ctx, {
    services: ['storage'],
    storageTermMonths: 4,
    firstName: 'Test',
    lastName: tag(),
    email: '',
    phone: '607-555-0199',
    ...over,
  });
}
const box = (over: Record<string, unknown> = {}) => ({
  type: 'standard_box',
  description: 'Test box',
  lengthIn: 18,
  widthIn: 18,
  heightIn: 18,
  weightLb: 30,
  ...over,
});
const pay = (over: Record<string, unknown> = {}) => ({ method: 'card', cardToken: 'mock_ok', idempotencyKey: key(), ...over });

/** A staff member of BRSS with exactly these permissions switched on. */
async function staffWith(grants: string[]): Promise<BusinessContext> {
  const ctx = await admin();
  const t = tag().toLowerCase();
  const membershipId = await addMember(ctx, { name: `Staff ${t}`, email: `${t}@sai.example`, role: 'business_staff' });
  await setMemberPermissions(ctx, membershipId, grants);
  const member = (await listMembers(ctx)).find((m) => m.membershipId === membershipId)!;
  return buildBusinessContext(member.userId, 'brss', 'live');
}

async function place(ctx: BusinessContext, regionName: string) {
  const places = await getPlaces(ctx);
  const region = places.regions.find((r) => r.name === regionName)!;
  return { region, buildings: places.buildings.filter((b) => b.regionId === region.id) };
}

/** A date well clear of the lead time and of the seeded unavailability; each call a new day. */
let dayCursor = 40;
function freeDay(): string {
  dayCursor += 1;
  return addDays(localDate(new Date(), TZ), dayCursor);
}

describe('orders', () => {
  it('a new order is Open, numbered, belongs to its (new) customer, and has its shipping zone', async () => {
    const ctx = await admin();
    const lastName = tag();
    const order = await createOrder(ctx, {
      services: ['ship_to_home'],
      firstName: 'Ship',
      lastName,
      email: 'Ship.Home@Example.com',
      shipToName: 'Ship Home',
      shipToAddress1: '1 Example Street',
      shipToCity: 'Sampletown',
      shipToState: 'NY',
      shipToZip: '10027',
    });
    expect(order.status).toBe('open'); // R-ORD-005
    expect(order.orderNumber).toMatch(/^O-\d{6}$/);
    expect(order.shipToZone).toBe(2); // R-ORD-009: zips 100–149 are zone 2 in the fake table
    expect(order.storageTermMonths).toBeNull();
    const detail = await getOrder(ctx, order.id);
    expect(detail.customer?.lastName).toBe(lastName);
    expect(detail.customer?.email).toBe('ship.home@example.com');
    // The next order gets the next number.
    const next = await storageOrder(ctx);
    expect(Number(next.orderNumber.slice(2))).toBe(Number(order.orderNumber.slice(2)) + 1);
  });

  it('refuses an order that is missing what its services need', async () => {
    const ctx = await admin();
    const base = { firstName: 'X', lastName: tag(), email: '' };
    await expect(createOrder(ctx, { ...base, services: [] })).rejects.toThrow(/at least one service/);
    await expect(createOrder(ctx, { ...base, services: ['storage'] })).rejects.toThrow(/storage term/);
    await expect(createOrder(ctx, { ...base, services: ['ship_to_home'] })).rejects.toThrow(/street address/);
    await expect(createOrder(ctx, { ...base, services: ['ship_to_home', 'ship_to_cornell'] })).rejects.toThrow(/not both/);
    await expect(createOrder(ctx, { services: ['supplies'], firstName: '', lastName: '', email: '' })).rejects.toThrow(/first name/);
    await expect(createOrder(ctx, { services: ['supplies'], customerId: '00000000-0000-4000-8000-000000000000' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('two orders created at the same moment get different numbers', async () => {
    const ctx = await admin();
    const orders = await Promise.all([1, 2, 3, 4].map(() => storageOrder(ctx)));
    expect(new Set(orders.map((o) => o.orderNumber)).size).toBe(4);
  });

  it('the dashboard filters by status, service, campus, region, date and text', async () => {
    const ctx = await admin();
    const all = await listOrders(ctx, { status: 'all' });
    expect(all.total).toBeGreaterThanOrEqual(16);
    const active = await listOrders(ctx, {});
    expect(active.rows.every((o) => o.status === 'open' || o.status === 'activated')).toBe(true);
    const closed = await listOrders(ctx, { status: 'closed' });
    expect(closed.total).toBeGreaterThanOrEqual(2);
    expect(closed.rows.every((o) => o.status === 'closed')).toBe(true);
    const shipping = await listOrders(ctx, { status: 'all', service: 'ship_to_home' });
    expect(shipping.rows.length).toBeGreaterThan(0);
    expect(shipping.rows.every((o) => o.services.includes('ship_to_home'))).toBe(true);
    const counter = await listOrders(ctx, { status: 'all', campus: 'counter' });
    expect(counter.rows.length).toBeGreaterThan(0);
    expect(counter.rows.every((o) => o.campusCategory === 'counter')).toBe(true);

    const { region } = await place(ctx, 'West Campus');
    const west = await listOrders(ctx, { status: 'all', regionId: region.id });
    expect(west.total).toBeGreaterThan(0);
    expect(west.total).toBeLessThan(all.total);

    const today = localDate(new Date(), TZ);
    const recent = await listOrders(ctx, { status: 'all', from: addDays(today, -7), to: today });
    const older = await listOrders(ctx, { status: 'all', to: addDays(today, -8) });
    expect(recent.total).toBeGreaterThan(0);
    expect(older.total).toBeGreaterThan(0);
    expect(recent.total + older.total).toBe(all.total);

    const one = await listOrders(ctx, { status: 'all', q: 'O-000003' });
    expect(one.rows.map((o) => o.orderNumber)).toEqual(['O-000003']);
    const byName = await listOrders(ctx, { status: 'all', q: one.rows[0].customerName });
    expect(byName.rows.some((o) => o.orderNumber === 'O-000003')).toBe(true);
    // Seeded numbers add up: a paid, closed order has nothing left to pay.
    expect(closed.rows.every((o) => o.unpaidCents === 0)).toBe(true);
  });

  it('closing an order marks its articles Delivered; only an open order can be cancelled (R-ORD-018, R-ORD-021)', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    await intakeArticle(ctx, order.id, box());
    await intakeArticle(ctx, order.id, box());
    await setOrderStatus(ctx, order.id, 'activated');
    await expect(setOrderStatus(ctx, order.id, 'cancelled')).rejects.toThrow(/Only an open order/);
    await setOrderStatus(ctx, order.id, 'closed');
    const closed = await getOrder(ctx, order.id);
    expect(closed.order.status).toBe('closed');
    expect(closed.articles!.map((a) => a.article.status)).toEqual(['delivered', 'delivered']);
    // A closed order is frozen until someone reopens it.
    await expect(intakeArticle(ctx, order.id, box())).rejects.toThrow(/closed/);
    await expect(updateOrder(ctx, order.id, { services: ['storage'], storageTermMonths: 6 })).rejects.toThrow(/closed/);
    await expect(payOrder(ctx, order.id, pay())).rejects.toThrow(/closed/);
    await setOrderStatus(ctx, order.id, 'open');
    await expect(setOrderStatus(ctx, order.id, 'nonsense')).rejects.toBeInstanceOf(ValidationError);
  });

  it('cancelling an order cancels its appointments (R-ORD-019)', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    const { region, buildings } = await place(ctx, 'North Campus');
    const visit = await bookAppointment(ctx, { orderId: order.id, type: 'pickup', date: freeDay(), slot: '11', regionId: region.id, buildingId: buildings[0].id, phone: '607-555-0101' });
    await setOrderStatus(ctx, order.id, 'cancelled');
    const after = await getOrder(ctx, order.id);
    expect(after.order.status).toBe('cancelled');
    expect(after.appointments!.find((a) => a.appointment.id === visit.id)!.appointment.status).toBe('canceled');
    await expect(bookAppointment(ctx, { orderId: order.id, type: 'pickup', date: freeDay(), slot: '11', regionId: region.id, buildingId: buildings[0].id, phone: '1' })).rejects.toThrow(/cancelled/);
  });
});

describe('article intake', () => {
  it('a standard box gets its billable weight, a number, a link to the order and its storage charge', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    // Sizes are rounded up to whole numbers (R-ORD-066): 17.2 → 18, 29.1 → 30.
    const { articles, problems } = await intakeArticle(ctx, order.id, box({ lengthIn: '17.2', weightLb: '29.1', insurance: 300 }));
    expect(problems).toEqual([]);
    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({ lengthIn: 18, weightLb: 30, billableWeightLb: 42, status: null, customerId: order.customerId, productId: null });
    expect(articles[0].articleNumber).toMatch(/^A-\d{6}$/);
    const detail = await getOrder(ctx, order.id);
    expect(detail.articles).toHaveLength(1);
    // Fake price list: 3–4 month box storage is $1.10 a pound; insurance is 10% of $300.
    expect(detail.items.map((i) => [i.rule, i.unitPriceCents, i.quantity, i.status])).toEqual([
      ['storage', 110 * 42, 1, 'new'],
      ['insurance', 3000, 1, 'new'],
    ]);
  });

  it('refuses a box that is too heavy, incomplete, or insured for an amount not on the list', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    await expect(intakeArticle(ctx, order.id, box({ weightLb: 151 }))).rejects.toThrow(/1 to 150 lb/);
    // 36 × 36 × 36 ÷ 139 = 336 lb of dimensional weight.
    await expect(intakeArticle(ctx, order.id, box({ lengthIn: 36, widthIn: 36, heightIn: 36 }))).rejects.toThrow(/1 to 150 lb/);
    await expect(intakeArticle(ctx, order.id, box({ heightIn: 0 }))).rejects.toThrow(/length, width, height and weight/);
    await expect(intakeArticle(ctx, order.id, box({ insurance: 150 }))).rejects.toThrow(/insurance from the list/);
    await expect(intakeArticle(ctx, order.id, box({ type: 'pallet' }))).rejects.toBeInstanceOf(ValidationError);
    expect((await getOrder(ctx, order.id)).articles).toEqual([]);
  });

  it('non-boxed items need their kind; an "Other" item needs a price; a flat rate box ×3 makes three articles', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx, { storageTermMonths: 6 });
    const { products } = await getPriceList(ctx);
    const byCode = (code: string) => products.find((p) => p.code === code)!;
    await expect(intakeArticle(ctx, order.id, { type: 'non_boxed' })).rejects.toThrow(/what kind of item/);
    await expect(intakeArticle(ctx, order.id, { type: 'non_boxed', productId: byCode('FLAT-S').id })).rejects.toThrow(/what kind of item/);
    await expect(intakeArticle(ctx, order.id, { type: 'non_boxed', productId: byCode('ITEM-OTHER').id })).rejects.toThrow(/monthly storage price/);

    await intakeArticle(ctx, order.id, { type: 'non_boxed', productId: byCode('ITEM-M').id, description: 'Mini fridge', lengthIn: 30, weightLb: 50 });
    await intakeArticle(ctx, order.id, { type: 'non_boxed', productId: byCode('ITEM-OTHER').id, otherStoragePrice: '20.00' });
    const flat = await intakeArticle(ctx, order.id, { type: 'flat_rate_box', productId: byCode('FLAT-L').id, quantity: 3 });
    expect(flat.articles).toHaveLength(3); // R-ORD-069
    expect(new Set(flat.articles.map((a) => a.articleNumber)).size).toBe(3);

    const detail = await getOrder(ctx, order.id);
    expect(detail.articles).toHaveLength(5);
    // Sizes typed for a non-boxed item are ignored (R-ORD-068).
    expect(detail.articles!.every((a) => a.article.weightLb === 0 && a.article.billableWeightLb === 0)).toBe(true);
    // Per month × 6 months: medium item $18.75, other $20.00, large flat rate box $12.25.
    expect(detail.items.map((i) => i.unitPriceCents).sort((a, b) => a - b)).toEqual([7350, 7350, 7350, 11250, 12000]);
  });

  it('an order that is not plain storage takes standard boxes only (R-ORD-065)', async () => {
    const ctx = await admin();
    const { products } = await getPriceList(ctx);
    const order = await createOrder(ctx, { services: ['ship_to_cornell'], firstName: 'To', lastName: tag(), email: '' });
    await expect(intakeArticle(ctx, order.id, { type: 'non_boxed', productId: products.find((p) => p.code === 'ITEM-S')!.id })).rejects.toThrow(/standard boxes only/);
  });

  it('ship to Cornell: a box on the Cornell account needs size and zip; a third-party box needs neither (R-ORD-071)', async () => {
    const ctx = await admin();
    const order = await createOrder(ctx, { services: ['ship_to_cornell'], firstName: 'To', lastName: tag(), email: '' });
    await expect(intakeArticle(ctx, order.id, box({ cornellShippingAccount: true }))).rejects.toThrow(/zip the box was sent from/);
    await intakeArticle(ctx, order.id, box({ cornellShippingAccount: true, receivedFromZip: '11215' }));
    // Third party: size and zip are thrown away, and the weight check does not apply (R-ORD-067).
    const third = await intakeArticle(ctx, order.id, box({ cornellShippingAccount: false, weightLb: 500, receivedFromZip: '11215' }));
    expect(third.articles[0]).toMatchObject({ weightLb: 0, billableWeightLb: 0 });
    const detail = await getOrder(ctx, order.id);
    expect(detail.articles!.map((a) => [a.cornellShippingAccount, a.receivedFromZip])).toEqual([[true, '11215'], [false, null]]);
    // Zone 2 at 42 lb, Cornell price = 90% of the fake home price; fees $15 and $25.
    const home = (await lookupShipping(ctx, '11215', 42)).rate!;
    expect(detail.items.map((i) => [i.rule, i.unitPriceCents])).toEqual([
      ['ship_to_cornell_fee', 1500],
      ['ship_to_cornell', home.shipCornellCents],
      ['ship_to_cornell_fee', 2500],
    ]);
  });

  it('correcting an article re-prices its unpaid charges; taking it off removes them', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    const { articles } = await intakeArticle(ctx, order.id, box());
    await updateArticleOnOrder(ctx, order.id, articles[0].id, box({ weightLb: 60, insurance: 100 }));
    let detail = await getOrder(ctx, order.id);
    expect(detail.articles![0].article.billableWeightLb).toBe(60);
    expect(detail.items.map((i) => [i.rule, i.unitPriceCents])).toEqual([['storage', 110 * 60], ['insurance', 1000]]);
    // Now overweight (70 lb): the overweight product applies, on the SAME line.
    const lineId = detail.items[0].id;
    await updateArticleOnOrder(ctx, order.id, articles[0].id, box({ weightLb: 70 }));
    detail = await getOrder(ctx, order.id);
    expect(detail.items.map((i) => [i.id, i.unitPriceCents])).toEqual([[lineId, 140 * 70]]);

    await detachArticle(ctx, order.id, articles[0].id);
    detail = await getOrder(ctx, order.id);
    expect(detail.articles).toEqual([]);
    expect(detail.items).toEqual([]);
    // The article itself is kept and can go on an order again (R-ORD-073), once.
    await attachArticle(ctx, order.id, articles[0].id);
    await expect(attachArticle(ctx, order.id, articles[0].id)).rejects.toThrow(/already on this order/);
    expect((await getOrder(ctx, order.id)).items).toHaveLength(1);
    // Another customer's article cannot be attached.
    const other = await storageOrder(ctx);
    await expect(attachArticle(ctx, other.id, articles[0].id)).rejects.toThrow(/different customer/);
  });

  it('changing the order re-prices unpaid charges; a missing price is reported, never billed at zero (KI-5)', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    await intakeArticle(ctx, order.id, box());
    const fields = { services: ['storage', 'ship_to_home'], storageTermMonths: 8, shipToName: 'A', shipToAddress1: '1 St', shipToCity: 'C', shipToState: 'NY' };
    // Alaska (995xx) is in zone 8 of the fake table; 42 lb has a rate there.
    let result = await updateOrder(ctx, order.id, { ...fields, shipToZip: '99501' });
    expect(result.problems).toEqual([]);
    expect(result.order.shipToZone).toBe(8);
    let detail = await getOrder(ctx, order.id);
    expect(detail.items.map((i) => i.rule)).toEqual(['storage', 'ship_to_home']);
    expect(detail.items[0].unitPriceCents).toBe(190 * 42); // the 7–8 month price
    // A zip in no zone: the shipping line goes, and the problem is reported.
    result = await updateOrder(ctx, order.id, { ...fields, shipToZip: '00123' });
    expect(result.order.shipToZone).toBeNull();
    expect(result.problems.join(' ')).toMatch(/has no zone/);
    detail = await getOrder(ctx, order.id);
    expect(detail.items.map((i) => i.rule)).toEqual(['storage']);
    expect((await pricingProblems(ctx, order.id)).join(' ')).toMatch(/has no zone/);
    // Paying is refused until the problem is fixed or explicitly accepted.
    await expect(payOrder(ctx, order.id, pay())).rejects.toThrow(/could not be worked out/);
    const outcome = await payOrder(ctx, order.id, pay({ acceptUnpriced: true }));
    expect(outcome.paid).toBe(true);
  });
});

describe('charges and payment', () => {
  it('one payment covers every unpaid charge, starts the storage clock, and cannot be taken twice', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    await intakeArticle(ctx, order.id, box());
    const { products } = await getPriceList(ctx);
    await addCharge(ctx, order.id, { productId: products.find((p) => p.code === 'SUP-TAPE')!.id, quantity: 2 });
    const idempotencyKey = key();
    const outcome = await payOrder(ctx, order.id, pay({ tip: '5.00', idempotencyKey }));
    // Subtotal 4,620 + 800 = 5,420; tax 8% = 433.6 → 434; tip 500; total 6,354.
    expect(outcome).toEqual({ paid: true, message: 'Payment of 63.54 taken.' });

    const detail = await getOrder(ctx, order.id);
    expect(detail.items.every((i) => i.status === 'paid' && i.paymentId === detail.payments![0].id)).toBe(true);
    expect(detail.payments).toHaveLength(1);
    expect(detail.payments![0]).toMatchObject({ amountCents: 6354, status: 'succeeded', method: 'card', provider: 'mock', customerId: order.customerId });
    expect(detail.order).toMatchObject({ taxCents: 434, tipCents: 500, discountCents: 0 });
    // R-ORD-086: the first charge on a storage order sets the effective date; expiry is +4 months.
    const today = localDate(new Date(), TZ);
    expect(detail.order.storageEffectiveDate).toBe(today);
    expect(detail.storageExpires).toBe(addMonths(today, 4));

    // The same form sent again (double click, retry) takes no second payment.
    await expect(payOrder(ctx, order.id, pay({ tip: '5.00', idempotencyKey }))).rejects.toThrow(/Nothing on this order is waiting/);
    expect((await getOrder(ctx, order.id)).payments).toHaveLength(1);

    // A later payment does not move the storage start date (R-ORD-086: set once).
    await addCharge(ctx, order.id, { productId: products.find((p) => p.code === 'FEE-PEAK')!.id, quantity: 1 });
    await payOrder(ctx, order.id, pay({ method: 'cash' }));
    const later = await getOrder(ctx, order.id);
    expect(later.order.storageEffectiveDate).toBe(today);
    expect(later.order.taxCents).toBe(434 + 160); // R-ORD-119: running totals
    expect(later.payments!.map((p) => p.method).sort()).toEqual(['card', 'cash']);
    // Paid charges are history: they are never re-priced or removed.
    await expect(removeCharge(ctx, later.items[0].id)).rejects.toThrow(/paid charge cannot be removed/);
    await expect(detachArticle(ctx, order.id, later.articles![0].article.id)).rejects.toThrow(/paid charges/);
    await updateProduct(ctx, products.find((p) => p.code === 'STOR-4')!.id, { price: '9.99', isActive: true });
    await updateArticleOnOrder(ctx, order.id, later.articles![0].article.id, box({ weightLb: 60 }));
    expect((await getOrder(ctx, order.id)).items.find((i) => i.rule === 'storage')!.unitPriceCents).toBe(4620);
    await updateProduct(ctx, products.find((p) => p.code === 'STOR-4')!.id, { price: '1.10', isActive: true });
  });

  it('two people paying the same order at the same moment produce one payment', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    await intakeArticle(ctx, order.id, box());
    const results = await Promise.allSettled([payOrder(ctx, order.id, pay()), payOrder(ctx, order.id, pay()), payOrder(ctx, order.id, pay())]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const detail = await getOrder(ctx, order.id);
    expect(detail.payments).toHaveLength(1);
    expect(detail.payments![0].amountCents).toBe(4620 + 370);
  });

  it('a declined card leaves every charge unpaid and a failed payment on record (KI-3)', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    await intakeArticle(ctx, order.id, box());
    const outcome = await payOrder(ctx, order.id, pay({ cardToken: 'mock_declined' }));
    expect(outcome.paid).toBe(false);
    expect(outcome.message).toMatch(/did not go through/);
    const detail = await getOrder(ctx, order.id);
    expect(detail.items.every((i) => i.status === 'new' && i.paymentId === null)).toBe(true);
    expect(detail.payments!.map((p) => p.status)).toEqual(['failed']);
    expect(detail.order.storageEffectiveDate).toBeNull();
    expect(detail.order.taxCents).toBe(0);
    // Trying again with a good card works.
    expect((await payOrder(ctx, order.id, pay())).paid).toBe(true);
  });

  it('discounts: staff up to 5%, more needs the special permission; a 100% discount takes no payment (R-ORD-116, R-ORD-118)', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    await intakeArticle(ctx, order.id, box()); // 4,620
    const clerk = await staffWith([P.ordersRead, P.ordersWrite, P.articlesRead, P.articlesWrite, 'payments.write', 'payments.read', 'customers.read']);
    // 5% of 4,620 is 231. One cent more is refused, not quietly reduced.
    await expect(payOrder(clerk, order.id, pay({ discount: '2.32' }))).rejects.toThrow(/largest discount you can give on this payment is 2.31/);
    await expect(payOrder(clerk, order.id, pay({ discount: 'lots' }))).rejects.toThrow(/discount in dollars/);
    expect((await getOrder(ctx, order.id)).payments).toEqual([]);

    const manager = await staffWith([P.ordersRead, P.ordersWrite, P.articlesRead, P.articlesWrite, P.discountAny, 'payments.write', 'payments.read']);
    await expect(payOrder(manager, order.id, pay({ discount: '46.21' }))).rejects.toThrow(/largest discount/);
    const outcome = await payOrder(manager, order.id, pay({ discount: '46.20' }));
    expect(outcome).toEqual({ paid: true, message: 'Nothing to pay after the discount; the charges are marked paid.' });
    const detail = await getOrder(ctx, order.id);
    expect(detail.payments).toEqual([]); // R-ORD-118: no payment is taken for a zero total
    expect(detail.items.every((i) => i.status === 'paid')).toBe(true);
    expect(detail.order.discountCents).toBe(4620);
    expect(detail.order.storageEffectiveDate).toBeNull(); // R-ORD-087: only a real charge starts the clock
  });

  it('a clerk discount of exactly the cap is accepted, and tax is on the discounted amount', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    await intakeArticle(ctx, order.id, box());
    const clerk = await staffWith([P.ordersRead, P.ordersWrite, P.articlesRead, P.articlesWrite, 'payments.write']);
    await payOrder(clerk, order.id, pay({ discount: '2.31', method: 'check' }));
    const [payment] = (await getOrder(ctx, order.id)).payments!;
    // (4,620 − 231) × 8% = 351.12 → 351;  4,620 + 351 − 231 = 4,740.
    expect(payment).toMatchObject({ amountCents: 4740, method: 'check', provider: 'manual', status: 'succeeded' });
  });

  it('hand-added charges: supplies, packing and fees only; price and quantity above zero (R-ORD-047)', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    const { products } = await getPriceList(ctx);
    const id = (code: string) => products.find((p) => p.code === code)!.id;
    await expect(addCharge(ctx, order.id, { productId: id('STOR-4'), quantity: 1 })).rejects.toThrow(/supplies, packing or fee/);
    await expect(addCharge(ctx, order.id, { productId: id('SUP-TAPE'), quantity: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(addCharge(ctx, order.id, { productId: id('SUP-TAPE'), quantity: 1, price: '0' })).rejects.toThrow(/above zero/);
    await expect(addCharge(ctx, order.id, { productId: id('SUP-TAPE'), quantity: 1, price: '-3' })).rejects.toThrow(/in dollars/);
    const line = await addCharge(ctx, order.id, { productId: id('PACK-HOUR'), quantity: 2, price: '175', description: 'Packing, peak season' });
    expect(line).toMatchObject({ unitPriceCents: 17500, quantity: 2, description: 'Packing, peak season', rule: null, status: 'new' });
    const fee = await addCharge(ctx, order.id, { productId: id('FEE-MISSED'), quantity: 1 });
    expect(fee).toMatchObject({ unitPriceCents: 4500, description: 'Missed appointment fee' });
    await removeCharge(ctx, fee.id);
    expect((await getOrder(ctx, order.id)).items.map((i) => i.id)).toEqual([line.id]);
    // A charge worked out from an article cannot be removed by hand.
    await intakeArticle(ctx, order.id, box());
    const automatic = (await getOrder(ctx, order.id)).items.find((i) => i.rule === 'storage')!;
    await expect(removeCharge(ctx, automatic.id)).rejects.toThrow(/worked out from an article/);
  });

  it('a refund is recorded against the order\'s own payment only', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    await intakeArticle(ctx, order.id, box());
    await payOrder(ctx, order.id, pay());
    const [payment] = (await getOrder(ctx, order.id)).payments!;
    const refund = await refundOrderPayment(ctx, order.id, payment.id, { amount: '10.00', reason: 'Damaged box' });
    expect(refund).toMatchObject({ amountCents: 1000, status: 'succeeded' });
    const detail = await getOrder(ctx, order.id);
    expect(detail.payments![0].refundedCents).toBe(1000);
    expect(detail.refunds).toHaveLength(1);
    await expect(refundOrderPayment(ctx, order.id, payment.id, { amount: '999', reason: 'Too much' })).rejects.toThrow(/left to refund/);
    // The payment of one order cannot be refunded through another order.
    const other = await storageOrder(ctx);
    await expect(refundOrderPayment(ctx, other.id, payment.id, { amount: '1', reason: 'Wrong order' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('article status and location', () => {
  it('a first location marks the article Stored; later location changes do not touch the status (R-ORD-076)', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    const { articles } = await intakeArticle(ctx, order.id, box());
    const { warehouses } = await getPlaces(ctx);
    const stored = await setArticleLocation(ctx, articles[0].id, { warehouseId: warehouses[0].id, section: 'Boxes', row: 'C', pallet: '7' });
    expect(stored).toMatchObject({ status: 'stored', warehouseId: warehouses[0].id, section: 'Boxes', row: 'C', pallet: 7 });
    await setArticleStatus(ctx, articles[0].id, 'ready_for_delivery');
    const moved = await setArticleLocation(ctx, articles[0].id, { warehouseId: warehouses[1].id, section: 'Boxes', row: 'D', pallet: '8' });
    expect(moved.status).toBe('ready_for_delivery');
    await expect(setArticleLocation(ctx, articles[0].id, { row: 'Z' })).rejects.toThrow(/row from the list/);
    await expect(setArticleLocation(ctx, articles[0].id, { warehouseId: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow(/warehouse from the list/);
  });

  it('any status may follow any other, one article or the whole order at once, and each change is logged (R-ORD-078, R-ORD-079)', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    const first = (await intakeArticle(ctx, order.id, box())).articles[0];
    await intakeArticle(ctx, order.id, box());
    expect(await setOrderArticlesStatus(ctx, order.id, 'on_truck_to_warehouse')).toBe(2);
    await setArticleStatus(ctx, first.id, 'delivered');
    await setArticleStatus(ctx, first.id, 'in_warehouse'); // backwards is allowed
    const detail = await getOrder(ctx, order.id);
    expect(detail.articles!.map((a) => a.article.status).sort()).toEqual(['in_warehouse', 'on_truck_to_warehouse']);
    await expect(setArticleStatus(ctx, first.id, 'lost')).rejects.toBeInstanceOf(ValidationError);
    const log = await listBusinessActivity(ctx, { entityType: 'brss.article', entityId: first.id, limit: 20 });
    expect(log.rows.filter((r) => r.action === 'update')).toHaveLength(3);
    expect(log.rows.every((r) => r.actorUserId !== null)).toBe(true);

    const found = await listArticles(ctx, { q: first.articleNumber });
    expect(found.rows.map((a) => a.id)).toEqual([first.id]);
    const waiting = await listArticles(ctx, { status: 'in_warehouse' });
    expect(waiting.rows.every((a) => a.status === 'in_warehouse')).toBe(true);
    expect(waiting.rows.some((a) => a.id === first.id)).toBe(true);
  });
});

describe('appointments', () => {
  it('books into a building, stamps the order\'s campus category once, and copies the truck\'s crew', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    const north = await place(ctx, 'North Campus');
    const west = await place(ctx, 'West Campus');
    const truck = await createTruck(ctx, { name: `Truck ${tag()}` });
    await addCrewMember(ctx, truck.id, { name: 'Avery Example' });
    await addCrewMember(ctx, truck.id, { name: 'Jordan Sample' });

    const date = freeDay();
    const visit = await bookAppointment(ctx, { orderId: order.id, type: 'pickup', date, slot: '13', regionId: north.region.id, buildingId: north.buildings[0].id, room: '214', phone: '607-555-0101', truckId: truck.id, estimatedBoxes: 6 });
    expect(visit).toMatchObject({ status: 'unconfirmed', kind: 'pickup', resourceId: truck.id, customerId: order.customerId });
    expect(visit.startsAt.toISOString()).toBe(slotRange(date, '13', TZ).startsAt.toISOString());
    let detail = await getOrder(ctx, order.id);
    expect(detail.order.campusCategory).toBe('on_campus'); // R-ORD-016, North Campus
    expect(detail.appointments![0].detail.crew.map((c) => c.name).sort()).toEqual(['Avery Example', 'Jordan Sample']);

    // R-SCH-199: a later appointment somewhere else does not change the category.
    const delivery = await bookAppointment(ctx, { orderId: order.id, type: 'delivery', date: freeDay(), slot: '09', regionId: west.region.id, buildingId: west.buildings[0].id, phone: '607-555-0101' });
    detail = await getOrder(ctx, order.id);
    expect(detail.order.campusCategory).toBe('on_campus');
    expect((await listOrders(ctx, { status: 'all', q: order.orderNumber })).rows[0].deliveryScheduled).toBe(true);

    // R-SCH-092: the crew on the appointment is a snapshot.
    await addCrewMember(ctx, truck.id, { name: 'Riley Demo' });
    expect((await getOrder(ctx, order.id)).appointments![0].detail.crew).toHaveLength(2);
    await assignTruck(ctx, delivery.id, truck.id);
    const crews = (await getOrder(ctx, order.id)).appointments!.map((a) => a.detail.crew.length);
    expect(crews).toEqual([2, 3]);
    await assignTruck(ctx, delivery.id, '');
    expect((await getOrder(ctx, order.id)).appointments![1].detail.crew).toEqual([]);

    const schedule = await listSchedule(ctx, { from: date, days: 1 });
    expect(schedule.rows.map((r) => r.appointment.id)).toContain(visit.id);
    expect(schedule.rows.find((r) => r.appointment.id === visit.id)).toMatchObject({ slot: '13', date, orderNumber: order.orderNumber, truckName: truck.name });
  });

  it('a region without buildings needs a street address, and its orders are off campus (R-SCH-166)', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    const other = await place(ctx, 'Other Address');
    const north = await place(ctx, 'North Campus');
    const base = { orderId: order.id, type: 'pickup', date: freeDay(), slot: '09', phone: '607-555-0101' };
    await expect(bookAppointment(ctx, { ...base, regionId: other.region.id })).rejects.toThrow(/street address, city and zip/);
    await expect(bookAppointment(ctx, { ...base, regionId: north.region.id })).rejects.toThrow(/Choose a building in North Campus/);
    await expect(bookAppointment(ctx, { ...base, regionId: north.region.id, buildingId: (await place(ctx, 'West Campus')).buildings[0].id })).rejects.toThrow(/Choose a building in North Campus/);
    await expect(bookAppointment(ctx, { ...base, regionId: other.region.id, address1: '1 Elm St', city: 'Ithaca', zip: '14850', phone: '' })).rejects.toThrow(/phone number/);
    await bookAppointment(ctx, { ...base, regionId: other.region.id, address1: '1 Elm St', city: 'Ithaca', zip: '14850' });
    expect((await getOrder(ctx, order.id)).order.campusCategory).toBe('off_campus');
  });

  it('the server enforces the lead time and unavailability; an override needs the permission and a reason (KI-6)', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    const { region, buildings } = await place(ctx, 'Collegetown Apts / Dorms');
    const today = localDate(new Date(), TZ);
    const base = { orderId: order.id, type: 'pickup', slot: '11', regionId: region.id, buildingId: buildings[0].id, phone: '607-555-0101' };

    await expect(bookAppointment(ctx, { ...base, date: addDays(today, -1) })).rejects.toThrow(/in the past/);
    await expect(bookAppointment(ctx, { ...base, date: addDays(today, -1), override: true, overrideReason: 'x' })).rejects.toThrow(/in the past/);
    await expect(bookAppointment(ctx, { ...base, date: 'tomorrow' })).rejects.toThrow(/as a date/);
    await expect(bookAppointment(ctx, { ...base, date: addDays(today, 5), slot: '10' })).rejects.toThrow(/Choose a time/);
    // R-SCH-026: two days' notice. Tomorrow is too soon; the day after is fine.
    await expect(bookAppointment(ctx, { ...base, date: addDays(today, 1) })).rejects.toThrow(/2 days' notice/);

    // A whole day blocked everywhere, and one window blocked for one building only.
    const blockedDay = freeDay();
    const partDay = freeDay();
    await createBlock(ctx, { startDate: blockedDay, endDate: blockedDay, allDay: true, reason: 'Slope Day' });
    await createBlock(ctx, { startDate: partDay, endDate: partDay, slots: ['11'], buildingIds: [buildings[0].id], reason: 'Elevator repair' });
    await expect(bookAppointment(ctx, { ...base, date: blockedDay })).rejects.toThrow(/blocked: Slope Day/);
    await expect(bookAppointment(ctx, { ...base, date: partDay })).rejects.toThrow(/blocked: Elevator repair/);
    // Same day: another window, or another building, is open (R-SCH-061, R-SCH-062).
    const moved = await bookAppointment(ctx, { ...base, date: partDay, slot: '13' });
    await bookAppointment(ctx, { ...base, date: partDay, buildingId: buildings[1].id });
    // Moving an appointment obeys the same rules.
    await expect(rescheduleAppointment(ctx, moved.id, { date: partDay, slot: '11' })).rejects.toThrow(/blocked: Elevator repair/);
    await expect(rescheduleAppointment(ctx, moved.id, { date: blockedDay, slot: '09' })).rejects.toThrow(/Slope Day/);
    const later = freeDay();
    expect((await rescheduleAppointment(ctx, moved.id, { date: later, slot: '15' })).startsAt.toISOString()).toBe(slotRange(later, '15', TZ).startsAt.toISOString());

    // The admin holds the override permission: a reason is still required, and is kept.
    await expect(bookAppointment(ctx, { ...base, date: blockedDay, override: true })).rejects.toThrow(/Say why/);
    const forced = await bookAppointment(ctx, { ...base, date: blockedDay, override: true, overrideReason: 'Customer leaves the country' });
    const forcedDetail = (await getOrder(ctx, order.id)).appointments!.find((a) => a.appointment.id === forced.id)!.detail;
    expect(forcedDetail.overrideReason).toMatch(/Customer leaves the country.*Slope Day/);
    await bookAppointment(ctx, { ...base, date: addDays(today, 1), override: true, overrideReason: 'Walk-in' });

    // A scheduler without the override permission cannot force it, even by ticking the box.
    const scheduler = await staffWith([P.ordersRead, P.ordersWrite, 'scheduling.read', 'scheduling.write', P.catalogRead]);
    await expect(bookAppointment(scheduler, { ...base, date: blockedDay, override: true, overrideReason: 'Please' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(bookAppointment(scheduler, { ...base, date: blockedDay })).rejects.toThrow(/Choose another time/);
    await bookAppointment(scheduler, { ...base, date: freeDay() });
  });

  it('unavailability needs a time and a reason, and never changes existing appointments (R-SCH-067, R-SCH-070)', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    const { region, buildings } = await place(ctx, 'Sorority');
    const day = freeDay();
    const visit = await bookAppointment(ctx, { orderId: order.id, type: 'pickup', date: day, slot: '09', regionId: region.id, buildingId: buildings[0].id, phone: '607-555-0101' });
    await expect(createBlock(ctx, { startDate: day, endDate: day, reason: 'Nothing ticked' })).rejects.toThrow(/All day/);
    await expect(createBlock(ctx, { startDate: day, endDate: addDays(day, -1), allDay: true, reason: 'Backwards' })).rejects.toThrow(/before the first day/);
    await expect(createBlock(ctx, { startDate: day, endDate: day, allDay: true, reason: '' })).rejects.toThrow(/reason/);
    await expect(createBlock(ctx, { startDate: day, endDate: day, allDay: true, reason: 'Bad building', buildingIds: ['00000000-0000-4000-8000-000000000000'] })).rejects.toThrow(/buildings from the list/);
    expect(await createBlock(ctx, { startDate: day, endDate: addDays(day, 1), slots: ['09', '11', '15'], reason: 'Two mornings' })).toBe(4);
    freeDay(); // the block also covers the next day, so later tests skip it
    const [row] = await withScope(ctx, 'scheduling.read', (s) => s.db.select().from(appointments).where(and(s.where(appointments), eq(appointments.id, visit.id))));
    expect(row.status).toBe('unconfirmed');
  });

  it('confirming emails the customer for pickups, deliveries and supplies, not for packing (R-SCH-036)', async () => {
    const ctx = await admin();
    const t = tag().toLowerCase();
    const order = await createOrder(ctx, { services: ['storage', 'packing'], storageTermMonths: 4, firstName: 'Mail', lastName: t, email: `${t}@example.com` });
    const { region, buildings } = await place(ctx, 'North Campus');
    const base = { orderId: order.id, regionId: region.id, buildingId: buildings[2].id, phone: '607-555-0101' };
    const pickup = await bookAppointment(ctx, { ...base, type: 'pickup', date: freeDay(), slot: '15' });
    const packing = await bookAppointment(ctx, { ...base, type: 'packing', date: freeDay(), slot: '09' });
    const sent = () => withScope(ctx, 'notifications.read', (s) => s.db.select().from(notifications).where(and(s.where(notifications), eq(notifications.recipient, `${t}@example.com`))));

    expect(await setAppointmentStatus(ctx, pickup.id, 'confirmed')).toEqual({ emailed: `${t}@example.com` });
    expect(await setAppointmentStatus(ctx, packing.id, 'confirmed')).toEqual({ emailed: null });
    const emails = await sent();
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toMatch(/pickup is confirmed/);
    expect(emails[0].body).toMatch(/3 PM – 5 PM/);
    // Saving the same status again sends nothing; other statuses send nothing.
    await setAppointmentStatus(ctx, pickup.id, 'confirmed');
    await setAppointmentStatus(ctx, pickup.id, 'in_progress');
    await setAppointmentStatus(ctx, pickup.id, 'completed');
    expect(await sent()).toHaveLength(1);
    // A completed appointment cannot be moved.
    await expect(rescheduleAppointment(ctx, pickup.id, { date: freeDay(), slot: '09' })).rejects.toThrow(/cannot be moved/);
    // Completing a pickup does not start the storage clock (that is the first payment's job).
    expect((await getOrder(ctx, order.id)).order.storageEffectiveDate).toBeNull();

    // Someone who may schedule but not send notifications is told why confirming fails.
    const scheduler = await staffWith(['scheduling.read', 'scheduling.write']);
    const delivery = await bookAppointment(ctx, { ...base, type: 'delivery', date: freeDay(), slot: '11' });
    await expect(setAppointmentStatus(scheduler, delivery.id, 'confirmed')).rejects.toThrow(/Send notifications/);
    expect((await getOrder(ctx, order.id)).appointments!.find((a) => a.appointment.id === delivery.id)!.appointment.status).toBe('unconfirmed');
  });
});

describe('reference data', () => {
  it('zip ranges cannot overlap; rates and storage terms are one per key; a role has one active product', async () => {
    const ctx = await ctxFor(USERS.brssAdmin, 'brss', 'sandbox');
    await expect(createZipZone(ctx, { zipLow: 90, zipHigh: 120, zone: 4 })).rejects.toThrow(/overlaps the range/);
    await expect(createZipZone(ctx, { zipLow: 9, zipHigh: 3, zone: 4 })).rejects.toThrow(/cannot be after/);
    const range = await createZipZone(ctx, { zipLow: 0, zipHigh: 4, zone: 9 });
    expect((await lookupShipping(ctx, '00401', 10)).zone).toBe(9);
    expect((await lookupShipping(ctx, '00401', 10)).rate).toBeNull();
    await setZoneRate(ctx, { zone: 9, weightLb: 10, shipHome: '50', shipCornell: '45.50' });
    await setZoneRate(ctx, { zone: 9, weightLb: 10, shipHome: '55', shipCornell: '45.50' }); // replaces, does not duplicate
    expect((await lookupShipping(ctx, '00401', 10)).rate).toMatchObject({ shipHomeCents: 5500, shipCornellCents: 4550 });
    await removeCatalogItem(ctx, 'brss.zip_zone', range.id);
    expect((await lookupShipping(ctx, '00401', 10)).zone).toBeNull();
    await expect(removeCatalogItem(ctx, 'brss.order', range.id)).rejects.toThrow(/cannot be removed here/);

    const { products, storageTerms } = await getPriceList(ctx);
    await expect(createProduct(ctx, { name: 'Second insurance', code: 'INS2', kind: 'insurance', role: 'insurance', price: '0' })).rejects.toThrow(/already the active product/);
    await expect(createProduct(ctx, { name: 'Bad price', code: 'BAD', kind: 'fee', price: 'free' })).rejects.toThrow(/price in dollars/);
    const twelve = await createProduct(ctx, { name: 'Box storage, 12 months', code: 'STOR-12', kind: 'storage_box', price: '2.75' });
    await setStorageTermProduct(ctx, { termMonths: 12, isOverweight: false, productId: twelve.id });
    await setStorageTermProduct(ctx, { termMonths: 12, isOverweight: false, productId: products.find((p) => p.code === 'STOR-8')!.id });
    expect((await getPriceList(ctx)).storageTerms).toHaveLength(storageTerms.length + 1);
    await expect(setStorageTermProduct(ctx, { termMonths: 12, isOverweight: false, productId: products.find((p) => p.code === 'SUP-TAPE')!.id })).rejects.toThrow(/Storage, standard box/);
  });
});

describe('who may do what', () => {
  it('new staff (default permissions) can look, and move articles, but not process orders or prices', async () => {
    const staff = await ctxFor(USERS.brssStaff, 'brss');
    const ctx = await admin();
    const order = await storageOrder(ctx);
    const { articles } = await intakeArticle(ctx, order.id, box());
    expect((await listOrders(staff, {})).total).toBeGreaterThan(0);
    expect((await getOrder(staff, order.id)).payments).toBeNull(); // no payments.read
    expect((await setArticleStatus(staff, articles[0].id, 'in_warehouse')).status).toBe('in_warehouse');
    for (const attempt of [
      () => storageOrder(staff),
      () => intakeArticle(staff, order.id, box()),
      () => addCharge(staff, order.id, { productId: articles[0].id, quantity: 1 }),
      () => payOrder(staff, order.id, pay()),
      () => setOrderStatus(staff, order.id, 'closed'),
      () => detachArticle(staff, order.id, articles[0].id),
      () => createTruck(staff, { name: 'Nope' }),
      () => createBlock(staff, { startDate: freeDay(), endDate: freeDay(), allDay: true, reason: 'Nope' }),
      () => createProduct(staff, { name: 'Nope', code: 'NOPE', kind: 'fee', price: '1' }),
      () => createZipZone(staff, { zipLow: 0, zipHigh: 1, zone: 1 }),
    ]) {
      await expect(attempt()).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('a new hire with nothing granted, an executive, and another business\'s admin', async () => {
    const ctx = await admin();
    const order = await storageOrder(ctx);
    const newHire = await ctxFor(USERS.brssNewHire, 'brss');
    await expect(listOrders(newHire, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getOrder(newHire, order.id)).rejects.toBeInstanceOf(ForbiddenError);

    // Executives read everything and change nothing.
    const executive = await ctxFor(USERS.executive, 'brss');
    expect((await getOrder(executive, order.id)).order.id).toBe(order.id);
    await expect(storageOrder(executive)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setOrderStatus(executive, order.id, 'closed')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(payOrder(executive, order.id, pay())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setArticleStatus(executive, order.id, 'stored')).rejects.toBeInstanceOf(ForbiddenError);

    // Another business's admin holds no BRSS permission at all, and super admins of the
    // platform see the order only inside BRSS.
    const outsider = await ctxFor(USERS.hhmcAdmin, 'hhmc');
    await expect(getOrder(outsider, order.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listOrders(outsider, {})).rejects.toBeInstanceOf(ForbiddenError);
    const superInOtherBusiness = await ctxFor(USERS.superAdmin, 'hhmc');
    await expect(withScope(superInOtherBusiness, 'business.overview.read', (s) => s.db.select().from(brssOrders).where(eq(brssOrders.id, order.id)))).resolves.toEqual([]);
  });

  it('live and test mode are separate: a sandbox order does not exist in live, and numbers count separately', async () => {
    const live = await admin();
    const sandbox = await ctxFor(USERS.brssAdmin, 'brss', 'sandbox');
    const order = await storageOrder(sandbox);
    await expect(getOrder(live, order.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(intakeArticle(live, order.id, box())).rejects.toBeInstanceOf(NotFoundError);
    await intakeArticle(sandbox, order.id, box());
    await payOrder(sandbox, order.id, pay());
    const [payment] = (await getOrder(sandbox, order.id)).payments!;
    expect(payment).toMatchObject({ environment: 'sandbox', provider: 'mock' });
    const liveRows = await withScope(live, 'payments.read', (s) => s.db.select().from(payments).where(eq(payments.id, payment.id)));
    expect(liveRows).toEqual([]);
  });

  it('every table has rows in live and sandbox, and the seeded charges match the pricing rules', async () => {
    for (const environment of ['live', 'sandbox'] as const) {
      const ctx = await ctxFor(USERS.brssAdmin, 'brss', environment);
      await withScope(ctx, 'business.overview.read', async (s) => {
        for (const table of [brssRegions, brssBuildings, brssOrders, brssArticles, brssOrderItems]) {
          expect(await s.db.$count(table, s.where(table)), `${environment}`).toBeGreaterThan(1);
        }
      });
      // O-000002: two stored boxes (22 → 42 lb and 38 → 42 lb billable) and a mini fridge, 4 months.
      const { rows } = await listOrders(ctx, { status: 'all', q: 'O-000002' });
      const detail = await getOrder(ctx, rows[0].id);
      const amounts = detail.items.map((i) => i.unitPriceCents).sort((a, b) => a - b);
      expect(amounts).toEqual([3000, 4620, 4620, 7500]);
      expect(await pricingProblems(ctx, rows[0].id)).toEqual([]);
    }
  });
});
