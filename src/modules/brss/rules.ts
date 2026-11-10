/**
 * BRSS BUSINESS RULES, as plain functions: no database, no web framework. Everything the
 * module calculates or decides goes through here, so each rule exists once and is tested once.
 *
 * Each rule names the rule id from docs/brss-analysis/ (R-ORD-… orders, R-SCH-… scheduling
 * and pricing), where the Salesforce source file and line are cited. The module README has
 * the full table. "KI-n" refers to docs/brss-analysis/known-issues.md: behaviour of the old
 * system that is deliberately NOT copied.
 */
import type {
  AppointmentType,
  ArticleStatus,
  ArticleType,
  ChargeRule,
  OrderService,
  OrderStatus,
  ProductKind,
  ProductRole,
} from './schema';
import type { BrssSettings } from './settings';

// ---------------------------------------------------------------- fixed lists

/** R-ORD-001: an order can hold several of these at once. */
export const ORDER_SERVICES: { key: OrderService; label: string }[] = [
  { key: 'storage', label: 'Storage' },
  { key: 'ship_to_home', label: 'Ship to home' },
  { key: 'ship_to_cornell', label: 'Ship to Cornell' },
  { key: 'packing', label: 'Packing' },
  { key: 'supplies', label: 'Supplies' },
];

/** R-ORD-003. */
export const ORDER_STATUSES: { key: OrderStatus; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'activated', label: 'Activated' },
  { key: 'closed', label: 'Closed' },
  { key: 'cancelled', label: 'Cancelled' },
];

/** R-ORD-054. */
export const ARTICLE_TYPES: { key: ArticleType; label: string }[] = [
  { key: 'standard_box', label: 'Standard box' },
  { key: 'non_boxed', label: 'Non-boxed item' },
  { key: 'flat_rate_box', label: 'Flat rate box' },
];

/**
 * R-ORD-075: the eight article statuses, in the order a box normally moves through them.
 * R-ORD-079: the old system does not enforce any order, and neither do we (see the README's
 * open questions); the order here is only what the screen suggests next.
 */
export const ARTICLE_STATUSES: { key: ArticleStatus; label: string }[] = [
  { key: 'on_truck_to_warehouse', label: 'On truck, to warehouse' },
  { key: 'in_warehouse', label: 'In warehouse' },
  { key: 'stored', label: 'Stored' },
  { key: 'ready_for_delivery', label: 'Ready for delivery' },
  { key: 'on_truck_to_delivery', label: 'On truck, to delivery' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'ready_for_shipment', label: 'Ready for shipment' },
  { key: 'shipped', label: 'Shipped' },
];

/** R-SCH-001. */
export const APPOINTMENT_TYPES: { key: AppointmentType; label: string }[] = [
  { key: 'pickup', label: 'Pickup' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'packing', label: 'Packing' },
  { key: 'supplies', label: 'Supplies' },
];

/** R-SCH-002. Keys are the core's appointment statuses; labels are the words BRSS uses. */
export const APPOINTMENT_STATUSES = [
  { key: 'unconfirmed', label: 'Unconfirmed' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'in_progress', label: 'Truck en route' },
  { key: 'completed', label: 'Completed' },
  { key: 'canceled', label: 'Cancelled' },
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number]['key'];

/** R-SCH-004: five fixed two-hour windows. There is no free-form time. */
export const TIME_SLOTS = [
  { key: '09', label: '9 AM – 11 AM', startHour: 9 },
  { key: '11', label: '11 AM – 1 PM', startHour: 11 },
  { key: '13', label: '1 PM – 3 PM', startHour: 13 },
  { key: '15', label: '3 PM – 5 PM', startHour: 15 },
  { key: '17', label: '5 PM – 7 PM', startHour: 17 },
] as const;
export type SlotKey = (typeof TIME_SLOTS)[number]['key'];
export const SLOT_HOURS = 2;

/** R-ORD-085: the storage terms offered, in months. */
export const STORAGE_TERMS = [
  { months: 4, label: '3–4 months (summer)' },
  { months: 6, label: '5–6 months (semester)' },
  { months: 8, label: '7–8 months (summer and semester)' },
] as const;

/** R-ORD-044: extra insurance is chosen from $0 to $2,000 in $100 steps. Values are cents. */
export const INSURANCE_OPTIONS_CENTS = Array.from({ length: 21 }, (_, i) => i * 100_00);

/** R-ORD-081: where an article can sit inside a warehouse. */
export const SECTIONS = [
  'Boxes',
  'Furniture',
  'TV Room',
  'Bike Room',
  'Mattress Area',
  'Chair',
  'Lamp',
  'Mirror',
  'Fridge',
  'Fan',
] as const;
export const ROWS = 'ABCDEFGHIJKLMN'.split('');

export const PRODUCT_KINDS: { key: ProductKind; label: string; priceUnit: string }[] = [
  { key: 'storage_box', label: 'Storage, standard box', priceUnit: 'per pound, whole term' },
  { key: 'storage_item', label: 'Storage, non-boxed item', priceUnit: 'per month' },
  { key: 'flat_rate_box', label: 'Storage, flat rate box', priceUnit: 'per month' },
  { key: 'shipping', label: 'Shipping', priceUnit: 'each' },
  { key: 'supply', label: 'Supplies', priceUnit: 'each' },
  { key: 'packing', label: 'Packing', priceUnit: 'each' },
  { key: 'insurance', label: 'Insurance', priceUnit: 'set by the insurance rule' },
  { key: 'fee', label: 'Fees and other charges', priceUnit: 'each' },
];

/** R-SCH-105: the products the pricing rules look for. One active product per role. */
export const PRODUCT_ROLES: { key: ProductRole; label: string }[] = [
  { key: 'ship_to_home', label: 'Ship to home (price comes from the zone table)' },
  { key: 'ship_to_cornell', label: 'Ship to Cornell (price comes from the zone table)' },
  { key: 'flat_rate_cornell', label: 'Ship to Cornell fee, Cornell shipping account' },
  { key: 'flat_rate_third_party', label: 'Ship to Cornell fee, third-party shipper' },
  { key: 'insurance', label: 'Extra insurance' },
  { key: 'other_non_boxed', label: '"Other" non-boxed item (staff type the monthly price)' },
  { key: 'prearrival', label: 'Pre-arrival delivery' },
];

export const labelOf = <K extends string>(list: readonly { key: K; label: string }[], key: K) =>
  list.find((item) => item.key === key)?.label ?? key;

// ---------------------------------------------------------------- dates

/** A calendar date with no time, as text: "2026-05-14". */
export type DateText = string;

export function isDateText(value: string): value is DateText {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const toDateText = (date: Date): DateText => date.toISOString().slice(0, 10);

export function addDays(date: DateText, days: number): DateText {
  const [y, m, d] = date.split('-').map(Number);
  return toDateText(new Date(Date.UTC(y, m - 1, d + days)));
}

/**
 * Plain calendar-month addition: the same day of the month, or the month's last day if the
 * month is shorter (31 January + 1 month = 28 or 29 February).
 * KI-1: the old "Storage Delivery By" formula came out a year late for some months. Not copied.
 */
export function addMonths(date: DateText, months: number): DateText {
  const [y, m, d] = date.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return toDateText(
    new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, lastDay))),
  );
}

/** R-ORD-089: storage runs out on the effective date plus the term. Null until both are known. */
export function storageExpirationDate(
  effectiveDate: DateText | null,
  termMonths: number | null,
): DateText | null {
  if (!effectiveDate || !termMonths) return null;
  return addMonths(effectiveDate, termMonths);
}

function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** The moment it is `hour` o'clock on `date` in the business's time zone. Hour 24 = next midnight. */
export function localTime(date: DateText, hour: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hour));
  return new Date(guess.getTime() - offsetMinutes(guess, timeZone) * 60000);
}

/** The calendar date it is at `instant` in the business's time zone. */
export function localDate(instant: Date, timeZone: string): DateText {
  return toDateText(new Date(instant.getTime() + offsetMinutes(instant, timeZone) * 60000));
}

/** The hour (0–23) it is at `instant` in the business's time zone. */
export function localHour(instant: Date, timeZone: string): number {
  return new Date(instant.getTime() + offsetMinutes(instant, timeZone) * 60000).getUTCHours();
}

// ---------------------------------------------------------------- appointments

export function isSlotKey(value: string): value is SlotKey {
  return TIME_SLOTS.some((slot) => slot.key === value);
}

/** R-SCH-004: the start and end of a time window on a date. */
export function slotRange(
  date: DateText,
  slot: SlotKey,
  timeZone: string,
): { startsAt: Date; endsAt: Date } {
  const startHour = TIME_SLOTS.find((s) => s.key === slot)!.startHour;
  return {
    startsAt: localTime(date, startHour, timeZone),
    endsAt: localTime(date, startHour + SLOT_HOURS, timeZone),
  };
}

/** Which window an appointment's start time falls in (for showing it). */
export function slotOf(startsAt: Date, timeZone: string): SlotKey | null {
  const hour = localHour(startsAt, timeZone);
  return TIME_SLOTS.find((slot) => slot.startHour === hour)?.key ?? null;
}

/**
 * R-SCH-026: the first day an appointment can normally be booked is today plus the lead days.
 * KI-6: the old system only applied this in the customer's browser; here the server checks it.
 */
export function earliestBookableDate(today: DateText, leadDays: number): DateText {
  return addDays(today, leadDays);
}

/**
 * R-SCH-060, R-SCH-062, R-SCH-068: the time ranges an unavailability covers.
 *  - all day, or all five windows ticked → one range from the first midnight to the midnight
 *    after the last day;
 *  - otherwise one range per day for each run of neighbouring windows.
 * R-SCH-070: no windows and not all day blocks nothing (an empty list).
 */
export function blockRanges(
  input: { startDate: DateText; endDate: DateText; allDay: boolean; slots: SlotKey[] },
  timeZone: string,
): { startsAt: Date; endsAt: Date }[] {
  const chosen = TIME_SLOTS.filter((slot) => input.slots.includes(slot.key));
  if (input.allDay || chosen.length === TIME_SLOTS.length) {
    return [
      {
        startsAt: localTime(input.startDate, 0, timeZone),
        endsAt: localTime(input.endDate, 24, timeZone),
      },
    ];
  }
  const ranges: { startsAt: Date; endsAt: Date }[] = [];
  for (let day = input.startDate; day <= input.endDate; day = addDays(day, 1)) {
    let runStart: number | null = null;
    let runEnd = 0;
    for (const slot of chosen) {
      if (runStart !== null && slot.startHour === runEnd) {
        runEnd = slot.startHour + SLOT_HOURS;
        continue;
      }
      if (runStart !== null)
        ranges.push({
          startsAt: localTime(day, runStart, timeZone),
          endsAt: localTime(day, runEnd, timeZone),
        });
      runStart = slot.startHour;
      runEnd = slot.startHour + SLOT_HOURS;
    }
    if (runStart !== null)
      ranges.push({
        startsAt: localTime(day, runStart, timeZone),
        endsAt: localTime(day, runEnd, timeZone),
      });
  }
  return ranges;
}

/**
 * R-SCH-061, R-SCH-064: an unavailability with no buildings applies everywhere; one with
 * buildings applies only to those. R-SCH-065: an appointment with no building is only
 * affected by the "everywhere" ones.
 */
export function blockApplies(blockBuildingIds: string[], buildingId: string | null): boolean {
  if (blockBuildingIds.length === 0) return true;
  return buildingId !== null && blockBuildingIds.includes(buildingId);
}

/**
 * R-SCH-198, R-SCH-200 (and KI-7): an order's campus category comes from its first
 * appointment's building. Each building carries its own category as data; an appointment at
 * another address (no building) is off campus.
 */
export function campusCategoryFor(
  building: { campusCategory: 'on_campus' | 'off_campus' } | null,
): 'on_campus' | 'off_campus' {
  return building?.campusCategory ?? 'off_campus';
}

/**
 * R-SCH-036: confirming an appointment emails the customer for these types. The old system
 * has no confirmation email for packing appointments (listed as an open question).
 */
export function sendsConfirmationEmail(type: AppointmentType): boolean {
  return type === 'delivery' || type === 'pickup' || type === 'supplies';
}

// ---------------------------------------------------------------- orders

/**
 * R-ORD-018: an order can be cancelled only while it is Open.
 * (The old customer page also required the first appointment to be in the future; that part
 * is about customers cancelling online and is not applied to staff.)
 */
export function canCancelOrder(status: OrderStatus): boolean {
  return status === 'open';
}

/** Charges, articles and appointments can be added only while an order is Open or Activated. */
export function isOrderActive(status: OrderStatus): boolean {
  return status === 'open' || status === 'activated';
}

/**
 * R-ORD-065: which article types intake offers. Only a storage order that is not a
 * ship-to-Cornell order lets staff choose; every other order takes standard boxes only.
 */
export function articleTypeChoices(services: OrderService[]): ArticleType[] {
  if (services.includes('storage') && !services.includes('ship_to_cornell'))
    return ['standard_box', 'non_boxed', 'flat_rate_box'];
  return ['standard_box'];
}

// ---------------------------------------------------------------- articles

export type Measurements = {
  weightLb: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
};

/**
 * R-ORD-056: billable weight is the larger of the actual weight and the dimensional weight
 * (length × width × height ÷ divisor), rounded up to a whole pound.
 * KI-2: the old system used ÷166 on the phone and ÷139 for the price. Here there is one
 * function and one divisor (a setting, 139 by default), used for display, checks and price.
 */
export function billableWeight(m: Measurements, divisor: number): number {
  const dimensional = (m.lengthIn * m.widthIn * m.heightIn) / divisor;
  return Math.ceil(Math.max(m.weightLb, dimensional));
}

/** R-ORD-058, R-ORD-067: a standard box must have a billable weight from 1 lb to the maximum. */
export function billableWeightProblem(billable: number, maxLb: number): string | null {
  if (billable >= 1 && billable <= maxLb) return null;
  return `Billable weight must be from 1 to ${maxLb} lb (this box comes to ${billable} lb).`;
}

/** R-ORD-033: a box is overweight when its billable weight is at or above the threshold. */
export function isOverweight(billableLb: number, thresholdLb: number): boolean {
  return billableLb >= thresholdLb;
}

export type Location = {
  warehouseId: string | null;
  section: string | null;
  row: string | null;
  pallet: number | null;
};

export function hasLocation(location: Location): boolean {
  return (
    location.warehouseId !== null ||
    location.section !== null ||
    location.row !== null ||
    location.pallet !== null
  );
}

/**
 * R-ORD-076: when an article that had no location gets one (any of warehouse, section, row
 * or pallet), its status becomes Stored. The rule fires on that change only, not on later edits.
 */
export function becomesStored(before: Location, after: Location): boolean {
  return !hasLocation(before) && hasLocation(after);
}

// ---------------------------------------------------------------- zones

export type ZipZone = { zipLow: number; zipHigh: number; zone: number };
export type ZoneRate = {
  zone: number;
  weightLb: number;
  shipHomeCents: number;
  shipCornellCents: number;
};

/**
 * R-SCH-146, R-SCH-147: only the first three digits of a zip are used, read as a number
 * (so 021xx is 21). A blank zip, or one with anything but digits, has no prefix.
 */
export function zipPrefix(zip: string | null | undefined): number | null {
  const value = (zip ?? '').trim();
  if (!/^\d{3,}$/.test(value)) return null;
  return Number(value.slice(0, 3));
}

/**
 * R-ORD-009: the zone whose range holds the zip's prefix (low ≤ prefix ≤ high).
 * R-SCH-148: in the old system overlapping ranges gave an arbitrary answer. Here ranges may
 * not overlap (checked when one is saved), so there is at most one match.
 */
export function findZone(zipZones: ZipZone[], zip: string | null | undefined): number | null {
  const prefix = zipPrefix(zip);
  if (prefix === null) return null;
  return zipZones.find((z) => z.zipLow <= prefix && prefix <= z.zipHigh)?.zone ?? null;
}

/** R-SCH-153: the rate row with exactly this zone and exactly this weight. No rounding up. */
export function findRate(rates: ZoneRate[], zone: number, weightLb: number): ZoneRate | null {
  return rates.find((r) => r.zone === zone && r.weightLb === weightLb) ?? null;
}

// ---------------------------------------------------------------- pricing

export type PriceProduct = {
  id: string;
  name: string;
  kind: ProductKind;
  role: ProductRole | null;
  unitPriceCents: number;
  isActive: boolean;
};
export type StorageTermProduct = { termMonths: number; isOverweight: boolean; productId: string };

export type Catalog = {
  products: PriceProduct[];
  storageTerms: StorageTermProduct[];
  zipZones: ZipZone[];
  zoneRates: ZoneRate[];
};

/**
 * R-ORD-034: the storage product for a term is the row with exactly that term; if there is
 * none, the row with the nearest SHORTER term. A longer term is never used.
 */
export function pickStorageTermProduct(
  rows: StorageTermProduct[],
  termMonths: number,
  overweight: boolean,
): StorageTermProduct | null {
  const candidates = rows
    .filter((row) => row.isOverweight === overweight && row.termMonths <= termMonths)
    .sort((a, b) => b.termMonths - a.termMonths);
  return candidates[0] ?? null;
}

export type PricedArticle = {
  id: string;
  articleNumber: string;
  type: ArticleType;
  productId: string | null;
  billableWeightLb: number;
  additionalInsuranceCents: number;
  otherStoragePriceCents: number | null;
};
export type ArticleLink = { cornellShippingAccount: boolean; receivedFromZip: string | null };
export type PricedLine = {
  articleId: string;
  /** Which rule produced the line; an article has at most one line per rule on an order. */
  rule: ChargeRule;
  productId: string;
  description: string;
  unitPriceCents: number;
};

/**
 * The automatic charges for one article on one order (R-ORD-027: each is quantity 1).
 *
 * KI-5: when a price is missing the old system silently created no line, so the customer was
 * not charged. Here every missing price comes back in `problems`, in words staff can act on,
 * and the screen shows it.
 */
export function priceArticle(input: {
  services: OrderService[];
  /** Months to bill storage for (the order's term, or the extra months of an extension). */
  storageMonths: number | null;
  shipToZone: number | null;
  article: PricedArticle;
  link: ArticleLink;
  catalog: Catalog;
  settings: Pick<BrssSettings, 'overweightThresholdLb' | 'insurancePercent'>;
}): { lines: PricedLine[]; problems: string[] } {
  const { services, storageMonths, article, link, catalog, settings } = input;
  const lines: PricedLine[] = [];
  const problems: string[] = [];
  const name = article.articleNumber;
  // R-ORD-030: only active products are used.
  const active = catalog.products.filter((p) => p.isActive);
  const byId = (id: string | null) => active.find((p) => p.id === id);
  const byRole = (role: ProductRole): PriceProduct | undefined => {
    const product = active.find((p) => p.role === role);
    if (!product)
      problems.push(
        `${name}: no active product is marked "${labelOf(PRODUCT_ROLES, role)}". Set one on the Pricing page.`,
      );
    return product;
  };
  const add = (
    rule: ChargeRule,
    product: PriceProduct,
    description: string,
    unitPriceCents: number,
  ) =>
    lines.push({ articleId: article.id, rule, productId: product.id, description, unitPriceCents });

  // ---- storage (R-ORD-032)
  if (services.includes('storage')) {
    if (!storageMonths) {
      problems.push(`${name}: the order has no storage term, so storage cannot be priced.`);
    } else if (article.type === 'standard_box') {
      // R-ORD-033: price per pound for the whole term × billable weight.
      const overweight = isOverweight(article.billableWeightLb, settings.overweightThresholdLb);
      const row = pickStorageTermProduct(catalog.storageTerms, storageMonths, overweight);
      const product = row ? byId(row.productId) : undefined;
      if (!product) {
        problems.push(
          `${name}: no storage price is set up for ${overweight ? 'an overweight' : 'a standard'} box stored ${storageMonths} months. Add one under Pricing → Storage terms.`,
        );
      } else {
        add(
          'storage',
          product,
          `${product.name} · ${article.billableWeightLb} lb · ${name}`,
          product.unitPriceCents * article.billableWeightLb,
        );
      }
    } else {
      // R-ORD-035, R-ORD-037, R-ORD-038: non-boxed items and flat rate boxes use the
      // article's own product, price per month × months.
      const product = byId(article.productId);
      if (!product) {
        problems.push(`${name}: its kind of item has no active price. Check the Pricing page.`);
      } else if (product.role === 'other_non_boxed') {
        // R-ORD-036: "Other" items use the monthly price typed in at intake.
        if (article.otherStoragePriceCents === null) {
          problems.push(`${name}: an "Other" item needs a monthly storage price.`);
        } else {
          add(
            'storage',
            product,
            `${product.name} · ${storageMonths} months · ${name}`,
            article.otherStoragePriceCents * storageMonths,
          );
        }
      } else {
        add(
          'storage',
          product,
          `${product.name} · ${storageMonths} months · ${name}`,
          product.unitPriceCents * storageMonths,
        );
      }
    }
  }

  // ---- ship to home (R-ORD-039): standard boxes only, priced from the zone table.
  if (services.includes('ship_to_home') && article.type === 'standard_box') {
    const product = byRole('ship_to_home');
    if (product) {
      const rate =
        input.shipToZone === null
          ? null
          : findRate(catalog.zoneRates, input.shipToZone, article.billableWeightLb);
      if (input.shipToZone === null) {
        problems.push(
          `${name}: the order's shipping zip has no zone, so shipping cannot be priced. Check the zip on the order, or add the zone under Zip zones.`,
        );
      } else if (!rate) {
        problems.push(
          `${name}: there is no shipping rate for zone ${input.shipToZone} at ${article.billableWeightLb} lb. Add it under Zip zones.`,
        );
      } else {
        add(
          'ship_to_home',
          product,
          `${product.name} · zone ${input.shipToZone} · ${article.billableWeightLb} lb · ${name}`,
          rate.shipHomeCents,
        );
      }
    }
  }

  // ---- ship to Cornell (R-ORD-040 to R-ORD-042): standard boxes only.
  if (services.includes('ship_to_cornell') && article.type === 'standard_box') {
    if (link.cornellShippingAccount) {
      // R-ORD-040: a flat fee, plus shipping priced from the zone of the "received from" zip.
      const fee = byRole('flat_rate_cornell');
      if (fee) add('ship_to_cornell_fee', fee, `${fee.name} · ${name}`, fee.unitPriceCents);
      const product = byRole('ship_to_cornell');
      if (product) {
        const zone = findZone(catalog.zipZones, link.receivedFromZip);
        const rate =
          zone === null ? null : findRate(catalog.zoneRates, zone, article.billableWeightLb);
        if (zone === null) {
          problems.push(
            `${name}: the "received from" zip has no zone, so shipping cannot be priced.`,
          );
        } else if (!rate) {
          problems.push(
            `${name}: there is no shipping rate for zone ${zone} at ${article.billableWeightLb} lb. Add it under Zip zones.`,
          );
        } else {
          add(
            'ship_to_cornell',
            product,
            `${product.name} · zone ${zone} · ${article.billableWeightLb} lb · ${name}`,
            rate.shipCornellCents,
          );
        }
      }
    } else {
      // R-ORD-041: sent by a third party: one flat fee, weight does not matter.
      const fee = byRole('flat_rate_third_party');
      if (fee) add('ship_to_cornell_fee', fee, `${fee.name} · ${name}`, fee.unitPriceCents);
    }
  }

  // ---- extra insurance (R-ORD-043): a percentage of the declared value.
  if (article.additionalInsuranceCents > 0) {
    const product = byRole('insurance');
    if (product) {
      add(
        'insurance',
        product,
        `${product.name} · covers ${(article.additionalInsuranceCents / 100).toFixed(0)} dollars · ${name}`,
        insurancePriceCents(article.additionalInsuranceCents, settings.insurancePercent),
      );
    }
  }

  return { lines, problems };
}

/** R-ORD-043: insurance costs a percentage (10% by default) of the extra value declared. */
export function insurancePriceCents(declaredCents: number, percent: number): number {
  return Math.round((declaredCents * percent) / 100);
}

// ---------------------------------------------------------------- money

/** R-ORD-028: a subtotal is the sum of unit price × quantity. */
export function subtotalCents(lines: { unitPriceCents: number; quantity: number }[]): number {
  return lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
}

/**
 * R-ORD-116: the largest discount allowed. Anyone with the "discount above the staff limit"
 * permission may discount the whole subtotal; everyone else up to the staff percentage.
 */
export function maxDiscountCents(
  subtotal: number,
  canDiscountAny: boolean,
  maxStaffPercent: number,
): number {
  return canDiscountAny ? subtotal : Math.round((subtotal * maxStaffPercent) / 100);
}

export type Totals = {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
};

/**
 * R-ORD-113, R-ORD-114: tax = (subtotal − discount) × tax rate, on every kind of line; the
 * tip is not taxed; total = subtotal + tax + tip − discount. Amounts round half-up to a cent.
 */
export function computeTotals(input: {
  subtotalCents: number;
  discountCents: number;
  tipCents: number;
  taxPercent: number;
}): Totals {
  const taxCents = Math.round(
    ((input.subtotalCents - input.discountCents) * input.taxPercent) / 100,
  );
  return {
    subtotalCents: input.subtotalCents,
    discountCents: input.discountCents,
    taxCents,
    tipCents: input.tipCents,
    totalCents: input.subtotalCents + taxCents + input.tipCents - input.discountCents,
  };
}

/** Turns "12.50" typed into a form into 1250 cents. Null when it is not a sensible amount. */
export function dollarsToCents(value: string): number | null {
  const text = value.trim().replace(/^\$/, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}
