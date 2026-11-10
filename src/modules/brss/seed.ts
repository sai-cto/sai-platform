/**
 * FAKE data for BRSS: fills the sandbox (test mode) and the local demo database.
 *
 * Nothing here is real. Customers come from the core's fake-person helper. Region and
 * building names are the public ones from the old system's picklists. EVERY PRICE, ZONE AND
 * RATE IS INVENTED: the real ones are data inside the Salesforce org, which this project
 * never reads (see README.md, "Before going live").
 *
 * Charges are worked out with the same pricing rules the app uses (rules.ts), so the demo
 * orders add up the way real ones would.
 */
import type { Scope } from '@/core/db/scope';
import {
  appointmentEntity,
  customerEntity,
  paymentEntity,
  resourceEntity,
  unavailabilityEntity,
} from '@/core/records/core-entities';
import { fakePerson, pick, seedRecords, seededRandom } from '@/core/sandbox/seeding';
import {
  appointmentDetailEntity,
  articleEntity,
  blockBuildingEntity,
  buildingEntity,
  orderArticleEntity,
  orderEntity,
  orderItemEntity,
  productEntity,
  regionEntity,
  storageTermEntity,
  truckCrewEntity,
  warehouseEntity,
  zipZoneEntity,
  zoneRateEntity,
} from './entities';
import {
  SECTIONS,
  addDays,
  billableWeight,
  campusCategoryFor,
  computeTotals,
  findZone,
  localDate,
  localTime,
  priceArticle,
  slotRange,
  subtotalCents,
  type AppointmentStatus,
  type SlotKey,
} from './rules';
import type {
  AppointmentType,
  ArticleStatus,
  ArticleType,
  OrderService,
  OrderStatus,
  ProductKind,
  ProductRole,
} from './schema';
import { settingsDefaults } from './settings';

const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- reference data

const REGIONS: { name: string; campus: 'on_campus' | 'off_campus'; buildings: string[] }[] = [
  {
    name: 'North Campus',
    // KI-7: seeded the way the old system behaves today: only North Campus is on campus.
    campus: 'on_campus',
    buildings: [
      'Risley', 'Balch', 'Clara Dickson / MCLLU', 'Court', 'Kay', 'Baur', 'Mews', 'Donlon',
      'Jameson', 'Toni Morrison', 'Ganędagǫ:', 'High Rise #5', 'Townhouses',
      'Hasbrook Community Center Apartments', 'Low Rise #6', 'Low Rise #7', 'Low Rise #8 / HILC',
      'Low Rise #9 / JAM', 'Low Rise #10 / Ujamaa', 'Latino Living Center', 'Awe:kon',
      'Ecology House', 'Barbara McClintock Hall', 'Hu Shih Hall', 'RBG Hall', 'Toni Morrison Hall',
    ],
  },
  {
    name: 'West Campus',
    campus: 'off_campus',
    buildings: [
      'Hans Bethe', 'Alice H. Cook House', 'Language House', 'William Keeton House',
      'McFaddin Hall', 'Founders Hall', 'Lyon Hall', 'North Baker', 'Baker Tower', 'Boldt Tower',
      'Boldt Hall', 'Flora Rose House (Main)', 'Carl Becker House', '118 McGraw',
      'Campus Hill Apartments', 'Ravenwood Apartments',
    ],
  },
  {
    name: 'Sorority',
    campus: 'off_campus',
    buildings: [
      'Delta Gamma', 'Kappa Delta', 'Tri Delta', 'Pi Phi', 'Alpha Phi', 'Kappa Kappa Gamma',
      'Alpha Chi Omega', 'Alpha Xi Delta', 'Sigma Delta Tau', 'Alpha Epsilon Phi', 'Theta',
      'Phi Sigma Sigma',
    ],
  },
  {
    name: 'Collegetown Apts / Dorms',
    campus: 'off_campus',
    buildings: [
      '112 Edgemoor', 'Cascadilla Hall', 'Sheldon Court', 'Schuyler House',
      'The Student Agencies Building', '407 College Ave Apartments', '151 Dryden',
      'Eddygate Apartments', 'Collegetown Crossing', 'The Lofts', 'The Lux',
      'Collegetown Townhouses', 'Collegetown Terrace Apartments', '312 College Ave',
      'Collegetown Court Apartments', 'Fairview Apartments', 'Maplewood Apartments',
    ],
  },
  // No building list: appointments here take a street address instead.
  { name: 'Other Address', campus: 'off_campus', buildings: [] },
  { name: 'Ithaca College', campus: 'off_campus', buildings: [] },
];

const WAREHOUSES = ['Mecklenburg', 'Lansing', 'Overflow', 'SAI Basement'];

type SeedProduct = {
  code: string;
  name: string;
  kind: ProductKind;
  role?: ProductRole;
  cents: number;
  description?: string;
};

// Invented prices. See the note at the top of this file.
const PRODUCTS: SeedProduct[] = [
  { code: 'STOR-4', name: 'Box storage, 3–4 months', kind: 'storage_box', cents: 110 },
  { code: 'STOR-6', name: 'Box storage, 5–6 months', kind: 'storage_box', cents: 150 },
  { code: 'STOR-8', name: 'Box storage, 7–8 months', kind: 'storage_box', cents: 190 },
  { code: 'STOR-4-OW', name: 'Overweight box storage, 3–4 months', kind: 'storage_box', cents: 140 },
  { code: 'STOR-6-OW', name: 'Overweight box storage, 5–6 months', kind: 'storage_box', cents: 190 },
  { code: 'STOR-8-OW', name: 'Overweight box storage, 7–8 months', kind: 'storage_box', cents: 240 },
  { code: 'ITEM-S', name: 'Small item', kind: 'storage_item', cents: 1225, description: 'Lamp, fan, small chair' },
  { code: 'ITEM-M', name: 'Medium item', kind: 'storage_item', cents: 1875, description: 'Mini fridge, bike, desk chair' },
  { code: 'ITEM-L', name: 'Large item', kind: 'storage_item', cents: 2500, description: 'Mattress, desk, TV' },
  { code: 'ITEM-G', name: 'Giant item', kind: 'storage_item', cents: 3750, description: 'Couch, large dresser' },
  { code: 'ITEM-OTHER', name: 'Other item', kind: 'storage_item', role: 'other_non_boxed', cents: 0, description: 'Staff type the monthly price' },
  { code: 'FLAT-S', name: 'Small flat rate box', kind: 'flat_rate_box', cents: 975 },
  { code: 'FLAT-L', name: 'Large flat rate box', kind: 'flat_rate_box', cents: 1225 },
  { code: 'FLAT-BAG', name: 'Blue moving bag', kind: 'flat_rate_box', cents: 1625 },
  { code: 'SHIP-HOME', name: 'Ship to home', kind: 'shipping', role: 'ship_to_home', cents: 0, description: 'Priced from the zone table' },
  { code: 'SHIP-CU', name: 'Ship to Cornell', kind: 'shipping', role: 'ship_to_cornell', cents: 0, description: 'Priced from the zone table' },
  { code: 'SHIP-CU-FEE', name: 'Receiving fee, Cornell shipping account', kind: 'shipping', role: 'flat_rate_cornell', cents: 1500 },
  { code: 'SHIP-3P-FEE', name: 'Receiving fee, third-party shipper', kind: 'shipping', role: 'flat_rate_third_party', cents: 2500 },
  { code: 'INS', name: 'Extra insurance', kind: 'insurance', role: 'insurance', cents: 0, description: 'A percentage of the declared value' },
  { code: 'SUP-BOX-S', name: 'Small box', kind: 'supply', cents: 350 },
  { code: 'SUP-BOX-L', name: 'Large box', kind: 'supply', cents: 450 },
  { code: 'SUP-TAPE', name: 'Packing tape', kind: 'supply', cents: 400 },
  { code: 'SUP-WRAP', name: 'Bubble wrap roll', kind: 'supply', cents: 600 },
  { code: 'SUP-DELIVERY', name: 'Supplies delivery', kind: 'supply', cents: 1000 },
  { code: 'PACK-HOUR', name: 'Packing service, per hour', kind: 'packing', cents: 12500 },
  { code: 'FEE-RESCHEDULE', name: 'Late reschedule fee', kind: 'fee', cents: 2500 },
  { code: 'FEE-MISSED', name: 'Missed appointment fee', kind: 'fee', cents: 4500 },
  { code: 'FEE-PEAK', name: 'Peak day fee', kind: 'fee', cents: 2000 },
  { code: 'PREARRIVAL', name: 'Pre-arrival delivery', kind: 'fee', role: 'prearrival', cents: 4500 },
];

const STORAGE_TERM_CODES: [months: number, overweight: boolean, code: string][] = [
  [4, false, 'STOR-4'],
  [6, false, 'STOR-6'],
  [8, false, 'STOR-8'],
  [4, true, 'STOR-4-OW'],
  [6, true, 'STOR-6-OW'],
  [8, true, 'STOR-8-OW'],
];

// Invented zones, roughly "further from Ithaca = higher zone".
const ZIP_ZONES: [low: number, high: number, zone: number][] = [
  [5, 99, 3],
  [100, 149, 2],
  [150, 199, 3],
  [200, 299, 4],
  [300, 399, 5],
  [400, 499, 4],
  [500, 699, 6],
  [700, 799, 7],
  [800, 999, 8],
];

/** An invented shipping rate, in cents, for a zone and a weight. */
const fakeRateCents = (zone: number, weightLb: number) => 900 + zone * 150 + weightLb * (35 + zone * 12);

// ---------------------------------------------------------------- demo orders

type SeedArticle = {
  type: ArticleType;
  description: string;
  /** Standard box: [length, width, height, weight]. */
  size?: [number, number, number, number];
  /** Non-boxed item or flat rate box: the product code. */
  product?: string;
  insuranceDollars?: number;
  status: ArticleStatus | null;
  stored?: boolean;
  thirdParty?: boolean;
};

type SeedOrder = {
  services: OrderService[];
  termMonths?: number;
  status: OrderStatus;
  /** How long ago the order was placed. */
  daysAgo: number;
  paid: boolean;
  articles: SeedArticle[];
  extras?: [code: string, quantity: number][];
  visits: { type: AppointmentType; dayOffset: number; slot: SlotKey; status: AppointmentStatus }[];
  shipZip?: string;
  counter?: boolean;
  region: number;
  notes?: string;
};

const box = (
  description: string,
  size: [number, number, number, number],
  status: ArticleStatus | null,
  extra: Partial<SeedArticle> = {},
): SeedArticle => ({ type: 'standard_box', description, size, status, ...extra });

const ORDERS: SeedOrder[] = [
  {
    services: ['storage'], termMonths: 4, status: 'closed', daysAgo: 170, paid: true, region: 0,
    articles: [box('Winter clothes', [18, 18, 18, 32], 'delivered'), box('Books', [16, 12, 12, 41], 'delivered')],
    visits: [
      { type: 'pickup', dayOffset: -165, slot: '11', status: 'completed' },
      { type: 'delivery', dayOffset: -40, slot: '13', status: 'completed' },
    ],
  },
  {
    services: ['storage'], termMonths: 4, status: 'activated', daysAgo: 75, paid: true, region: 0,
    articles: [
      box('Bedding', [18, 18, 18, 22], 'stored', { stored: true }),
      box('Kitchen things', [18, 18, 18, 38], 'stored', { stored: true, insuranceDollars: 300 }),
      { type: 'non_boxed', description: 'Mini fridge', product: 'ITEM-M', status: 'stored', stored: true },
    ],
    visits: [{ type: 'pickup', dayOffset: -72, slot: '09', status: 'completed' }],
  },
  {
    services: ['storage'], termMonths: 6, status: 'activated', daysAgo: 120, paid: true, region: 1,
    articles: [
      box('Textbooks', [16, 12, 12, 48], 'ready_for_delivery', { stored: true }),
      box('Shoes and coats', [24, 18, 18, 29], 'ready_for_delivery', { stored: true }),
      { type: 'flat_rate_box', description: 'Desk things', product: 'FLAT-L', status: 'ready_for_delivery', stored: true },
    ],
    visits: [
      { type: 'pickup', dayOffset: -118, slot: '15', status: 'completed' },
      { type: 'delivery', dayOffset: 4, slot: '11', status: 'confirmed' },
    ],
  },
  {
    services: ['storage'], termMonths: 8, status: 'open', daysAgo: 3, paid: false, region: 0,
    articles: [],
    visits: [{ type: 'pickup', dayOffset: 5, slot: '13', status: 'unconfirmed' }],
    notes: 'Third floor, no elevator.',
  },
  {
    services: ['storage'], termMonths: 4, status: 'open', daysAgo: 6, paid: false, region: 3,
    articles: [
      box('Clothes', [18, 18, 18, 27], 'in_warehouse'),
      box('Monitor and cables', [24, 18, 12, 19], 'in_warehouse', { insuranceDollars: 500 }),
      { type: 'non_boxed', description: 'Road bike', product: 'ITEM-M', status: 'in_warehouse' },
    ],
    visits: [{ type: 'pickup', dayOffset: -1, slot: '09', status: 'completed' }],
  },
  {
    services: ['ship_to_home'], status: 'open', daysAgo: 2, paid: false, region: 1, shipZip: '10027',
    articles: [],
    visits: [{ type: 'pickup', dayOffset: 3, slot: '15', status: 'confirmed' }],
  },
  {
    services: ['ship_to_home'], status: 'activated', daysAgo: 30, paid: true, region: 3, shipZip: '60614',
    articles: [box('Dorm room box 1', [18, 18, 18, 35], 'shipped'), box('Dorm room box 2', [18, 18, 18, 31], 'shipped')],
    visits: [{ type: 'pickup', dayOffset: -27, slot: '11', status: 'completed' }],
  },
  {
    services: ['ship_to_cornell'], status: 'open', daysAgo: 9, paid: false, region: 0,
    articles: [
      box('Sent from home', [20, 16, 14, 26], 'in_warehouse'),
      box('Sent by an online shop', [0, 0, 0, 0], 'in_warehouse', { thirdParty: true }),
    ],
    visits: [{ type: 'delivery', dayOffset: 6, slot: '13', status: 'unconfirmed' }],
  },
  {
    services: ['storage', 'ship_to_home'], termMonths: 4, status: 'activated', daysAgo: 95, paid: true, region: 2, shipZip: '94110',
    articles: [box('Everything else', [18, 18, 18, 44], 'ready_for_shipment', { stored: true })],
    visits: [{ type: 'pickup', dayOffset: -93, slot: '17', status: 'completed' }],
  },
  {
    services: ['supplies'], status: 'closed', daysAgo: 45, paid: true, region: 3,
    articles: [],
    extras: [['SUP-BOX-L', 6], ['SUP-TAPE', 2], ['SUP-DELIVERY', 1]],
    visits: [{ type: 'supplies', dayOffset: -43, slot: '09', status: 'completed' }],
  },
  {
    services: ['storage', 'packing'], termMonths: 4, status: 'open', daysAgo: 1, paid: false, region: 1,
    articles: [],
    extras: [['PACK-HOUR', 2]],
    visits: [{ type: 'packing', dayOffset: 8, slot: '09', status: 'unconfirmed' }],
  },
  {
    services: ['storage'], termMonths: 6, status: 'cancelled', daysAgo: 20, paid: false, region: 0,
    articles: [],
    visits: [{ type: 'pickup', dayOffset: -12, slot: '11', status: 'canceled' }],
    notes: 'Customer decided to take everything home.',
  },
  {
    services: ['storage'], termMonths: 4, status: 'activated', daysAgo: 55, paid: true, region: 4, counter: true,
    articles: [
      box('Dropped off at the counter', [16, 12, 12, 18], 'stored', { stored: true }),
      { type: 'non_boxed', description: 'Floor lamp', product: 'ITEM-S', status: 'stored', stored: true },
    ],
    visits: [],
  },
  {
    services: ['storage'], termMonths: 8, status: 'activated', daysAgo: 140, paid: true, region: 0,
    articles: [
      box('Heavy books', [18, 18, 18, 74], 'stored', { stored: true }),
      { type: 'non_boxed', description: 'Mattress', product: 'ITEM-L', status: 'stored', stored: true },
      { type: 'flat_rate_box', description: 'Bedding bag', product: 'FLAT-BAG', status: 'stored', stored: true },
    ],
    visits: [{ type: 'pickup', dayOffset: -138, slot: '13', status: 'completed' }],
  },
  {
    services: ['storage'], termMonths: 4, status: 'open', daysAgo: 0, paid: false, region: 3,
    articles: [],
    visits: [{ type: 'pickup', dayOffset: 2, slot: '11', status: 'confirmed' }],
  },
  {
    services: ['ship_to_home'], status: 'open', daysAgo: 4, paid: false, region: 0, shipZip: '02139',
    articles: [box('Clothes', [18, 18, 18, 24], 'on_truck_to_warehouse')],
    visits: [{ type: 'pickup', dayOffset: 0, slot: '09', status: 'in_progress' }],
  },
];

const SLOT_BY_INDEX: SlotKey[] = ['09', '11', '13', '15', '17'];

export async function seedDemoData(s: Scope): Promise<void> {
  const random = seededRandom(`${s.ctx.business.code}:${s.ctx.environment}`);
  const timeZone = s.ctx.business.timeZone;
  const now = new Date();
  const today = localDate(now, timeZone);

  // ---- reference data
  const regions = await seedRecords(
    s,
    regionEntity,
    REGIONS.map((region, index) => ({ name: region.name, sortOrder: (index + 1) * 10 })),
  );
  const buildings = await seedRecords(
    s,
    buildingEntity,
    REGIONS.flatMap((region, index) =>
      region.buildings.map((name) => ({
        regionId: regions[index].id,
        name,
        campusCategory: region.campus,
      })),
    ),
  );
  const warehouses = await seedRecords(
    s,
    warehouseEntity,
    WAREHOUSES.map((name) => ({ name })),
  );
  const products = await seedRecords(
    s,
    productEntity,
    PRODUCTS.map((p) => ({
      name: p.name,
      code: p.code,
      kind: p.kind,
      role: p.role ?? null,
      unitPriceCents: p.cents,
      description: p.description ?? null,
    })),
  );
  const productId = (code: string) => products.find((p) => p.code === code)!.id;
  const storageTerms = await seedRecords(
    s,
    storageTermEntity,
    STORAGE_TERM_CODES.map(([termMonths, isOverweight, code]) => ({
      termMonths,
      isOverweight,
      productId: productId(code),
    })),
  );
  const zipZones = await seedRecords(
    s,
    zipZoneEntity,
    ZIP_ZONES.map(([zipLow, zipHigh, zone]) => ({ zipLow, zipHigh, zone })),
  );
  const zoneRates = await seedRecords(
    s,
    zoneRateEntity,
    [2, 3, 4, 5, 6, 7, 8].flatMap((zone) =>
      Array.from({ length: settingsDefaults.maxBillableWeightLb }, (_, i) => ({
        zone,
        weightLb: i + 1,
        shipHomeCents: fakeRateCents(zone, i + 1),
        shipCornellCents: Math.round(fakeRateCents(zone, i + 1) * 0.9),
      })),
    ),
  );
  const catalog = { products, storageTerms, zipZones, zoneRates };

  // ---- trucks and crews
  const trucks = await seedRecords(
    s,
    resourceEntity,
    ['Truck 1', 'Truck 2', 'Van'].map((name) => ({ kind: 'truck', name })),
  );
  const crewRows = trucks.flatMap((truck, t) =>
    Array.from({ length: t === 2 ? 2 : 3 }, (_, i) => {
      const person = fakePerson(random, 80 + t * 3 + i);
      return { truckId: truck.id, name: `${person.firstName} ${person.lastName}` };
    }),
  );
  await seedRecords(s, truckCrewEntity, crewRows);
  const crewOf = (truckId: string) =>
    crewRows.filter((c) => c.truckId === truckId).map((c) => ({ name: c.name }));

  // ---- customers
  const customers = await seedRecords(
    s,
    customerEntity,
    Array.from({ length: ORDERS.length }, (_, i) => ({
      ...fakePerson(random, i + 1),
      kind: 'person' as const,
      notes: 'Fake demo customer',
    })),
  );

  // ---- orders, with everything that hangs off them
  let articleCounter = 0;
  for (const [index, spec] of ORDERS.entries()) {
    const customer = customers[index];
    const placedAt = new Date(now.getTime() - spec.daysAgo * DAY - (index % 5) * 60 * 60 * 1000);
    const region = regions[spec.region];
    const regionBuildings = buildings.filter((b) => b.regionId === region.id);
    const building = regionBuildings.length > 0 ? pick(random, regionBuildings) : null;
    const shipToZone = spec.shipZip ? findZone(zipZones, spec.shipZip) : null;
    const paidAt = new Date(placedAt.getTime() + 3 * DAY);

    // Articles and their links
    const articleRows = spec.articles.map((a) => {
      articleCounter += 1;
      const [lengthIn, widthIn, heightIn, weightLb] = a.size ?? [0, 0, 0, 0];
      const stored = a.stored
        ? {
            warehouseId: warehouses[index % 2].id,
            section: a.type === 'standard_box' ? SECTIONS[0] : SECTIONS[1],
            row: 'ABCDEFGHIJKLMN'[(index + articleCounter) % 14],
            pallet: (articleCounter * 7) % 40,
          }
        : {};
      return {
        articleNumber: `A-${String(articleCounter).padStart(6, '0')}`,
        customerId: customer.id,
        type: a.type,
        description: a.description,
        productId: a.product ? productId(a.product) : null,
        weightLb,
        lengthIn,
        widthIn,
        heightIn,
        billableWeightLb:
          weightLb > 0
            ? billableWeight({ weightLb, lengthIn, widthIn, heightIn }, settingsDefaults.dimensionalDivisor)
            : 0,
        status: a.status,
        additionalInsuranceCents: (a.insuranceDollars ?? 0) * 100,
        ...stored,
        createdAt: placedAt,
      };
    });
    const articles = await seedRecords(s, articleEntity, articleRows);
    const links = spec.articles.map((a) => ({
      cornellShippingAccount: spec.services.includes('ship_to_cornell') && !a.thirdParty,
      receivedFromZip: spec.services.includes('ship_to_cornell') && !a.thirdParty ? '11215' : null,
    }));

    // Charges, worked out by the real pricing rules
    const priced = articles.flatMap((article, i) =>
      priceArticle({
        services: spec.services,
        storageMonths: spec.termMonths ?? null,
        shipToZone,
        article,
        link: links[i],
        catalog,
        settings: settingsDefaults,
      }).lines.map((line) => ({ ...line, quantity: 1 })),
    );
    const extras = (spec.extras ?? []).map(([code, quantity]) => {
      const product = products.find((p) => p.code === code)!;
      return {
        articleId: null,
        rule: null,
        productId: product.id,
        description: product.name,
        unitPriceCents: product.unitPriceCents,
        quantity,
      };
    });
    const lines = [...priced, ...extras];
    const totals = computeTotals({
      subtotalCents: subtotalCents(lines),
      discountCents: 0,
      tipCents: spec.paid && index % 3 === 0 ? 500 : 0,
      taxPercent: settingsDefaults.taxPercent,
    });
    const charged = spec.paid && totals.totalCents > 0;

    const [order] = await seedRecords(s, orderEntity, [
      {
        orderNumber: `O-${String(index + 1).padStart(6, '0')}`,
        customerId: customer.id,
        status: spec.status,
        services: spec.services,
        campusCategory: spec.counter
          ? ('counter' as const)
          : spec.visits.length > 0
            ? campusCategoryFor(building)
            : null,
        netId: `${customer.firstName.slice(0, 2).toLowerCase()}${100 + index}`,
        storageTermMonths: spec.termMonths ?? null,
        storageEffectiveDate:
          charged && spec.services.includes('storage') ? localDate(paidAt, timeZone) : null,
        ...(spec.shipZip
          ? {
              shipToName: `${customer.firstName} ${customer.lastName}`,
              shipToAddress1: `${100 + index * 7} Example Street`,
              shipToCity: 'Sampletown',
              shipToState: 'NY',
              shipToZip: spec.shipZip,
              shipToZone,
            }
          : {}),
        taxCents: charged ? totals.taxCents : 0,
        tipCents: charged ? totals.tipCents : 0,
        notes: spec.notes ?? null,
        createdAt: placedAt,
      },
    ]);

    if (articles.length > 0) {
      await seedRecords(
        s,
        orderArticleEntity,
        articles.map((article, i) => ({ orderId: order.id, articleId: article.id, ...links[i] })),
      );
    }

    let paymentId: string | null = null;
    if (charged) {
      const [payment] = await seedRecords(s, paymentEntity, [
        {
          customerId: customer.id,
          kind: 'charge' as const,
          amountCents: totals.totalCents,
          status: 'succeeded' as const,
          method: index % 4 === 0 ? ('cash' as const) : ('card' as const),
          provider: index % 4 === 0 ? ('manual' as const) : ('mock' as const),
          providerRef: index % 4 === 0 ? null : `mock_ch_demo_${s.ctx.environment}_${index}`,
          cardBrand: index % 4 === 0 ? null : 'Visa',
          cardLast4: index % 4 === 0 ? null : '4242',
          description: `Order ${order.orderNumber}`,
          subjectType: orderEntity.key,
          subjectId: order.id,
          paidAt,
          createdAt: paidAt,
        },
      ]);
      paymentId = payment.id;
    }
    if (lines.length > 0) {
      await seedRecords(
        s,
        orderItemEntity,
        lines.map((line) => ({
          orderId: order.id,
          ...line,
          status: charged ? ('paid' as const) : ('new' as const),
          paymentId,
          createdAt: placedAt,
        })),
      );
    }

    // Appointments
    for (const [v, visit] of spec.visits.entries()) {
      const date = addDays(today, visit.dayOffset);
      const range = slotRange(date, visit.slot, timeZone);
      const truck = visit.status === 'unconfirmed' ? null : trucks[(index + v) % trucks.length];
      const [appointment] = await seedRecords(s, appointmentEntity, [
        {
          customerId: customer.id,
          kind: visit.type,
          startsAt: range.startsAt,
          endsAt: range.endsAt,
          status: visit.status,
          resourceId: truck?.id ?? null,
          subjectType: orderEntity.key,
          subjectId: order.id,
          notes: v === 0 ? (spec.notes ?? null) : null,
          createdAt: placedAt,
        },
      ]);
      await seedRecords(s, appointmentDetailEntity, [
        {
          appointmentId: appointment.id,
          orderId: order.id,
          type: visit.type,
          regionId: region.id,
          buildingId: building?.id ?? null,
          address1: building ? null : `${200 + index} Sample Road`,
          city: building ? null : 'Ithaca',
          zip: building ? null : '14850',
          room: building ? String(100 + ((index * 37) % 400)) : null,
          hasElevator: index % 2 === 0,
          phone: customer.phone ?? '607-555-0100',
          estimatedBoxes: Math.max(spec.articles.length, 2),
          estimatedOtherItems: spec.articles.filter((a) => a.type === 'non_boxed').length,
          packingHours: visit.type === 'packing' ? 2 : 0,
          crew: truck ? crewOf(truck.id) : [],
          createdAt: placedAt,
        },
      ]);
    }
  }

  // ---- unavailability: one whole day everywhere, one morning for two buildings
  const trainingDay = addDays(today, 12);
  await seedRecords(s, unavailabilityEntity, [
    {
      resourceId: null,
      startsAt: localTime(trainingDay, 0, timeZone),
      endsAt: localTime(trainingDay, 24, timeZone),
      reason: 'Staff training day',
    },
  ]);
  const moveInDay = addDays(today, 9);
  const [moveIn] = await seedRecords(s, unavailabilityEntity, [
    {
      resourceId: null,
      ...slotRange(moveInDay, SLOT_BY_INDEX[0], timeZone),
      reason: 'Loading dock closed for the morning',
    },
  ]);
  await seedRecords(
    s,
    blockBuildingEntity,
    buildings.slice(0, 2).map((b) => ({ unavailabilityId: moveIn.id, buildingId: b.id })),
  );
}
