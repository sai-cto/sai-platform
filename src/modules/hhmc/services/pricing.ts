/**
 * THE HHMC PRICING ENGINE. Pure functions: no database, no clock. Every amount is an integer
 * number of cents; every division rounds half-up (ref §4.2, build prompt "Pricing rules").
 *
 *   line      = round(qty × rate) − discount (% or $)
 *   section   = Σ lines                             (7 sections, ref §3.4)
 *   subtotal  = Σ sections
 *   tax       = round(subtotal × service tax %)      only if on
 *   fee       = round((subtotal + tax) × card fee %) only if on
 *   total     = subtotal + tax + fee
 *   deposit   = round(deposit % × (subtotal + tax)); paid by card: + round(deposit × card fee %)
 *   balance   = total − deposit received (incl. its card fee) − payments
 *
 * The three worked examples in ref §4.2 are acceptance tests (tests/integration/hhmc-pricing.test.ts).
 */

/** The seven quote sections, in the order the customer sees them (ref §3.4). */
export const SECTIONS = [
  { key: 'transportation_labor', label: 'Transportation Labor' },
  { key: 'valuation', label: 'Valuation' },
  { key: 'packing_materials', label: 'Packing Materials' },
  { key: 'packing_labor', label: 'Packing Labor' },
  { key: 'crating', label: 'Crating' },
  { key: 'additional_services', label: 'Additional Services' },
  { key: 'storage', label: 'Storage' },
] as const;

export type SectionKey = (typeof SECTIONS)[number]['key'];
export const SECTION_KEYS = SECTIONS.map((s) => s.key) as SectionKey[];

export function sectionLabel(key: string): string {
  return SECTIONS.find((s) => s.key === key)?.label ?? key;
}

/**
 * One priced line.
 * - qtyHundredths: quantity × 100 (2.5 hours = 250; 283 miles = 28300).
 * - discountType 'percent': discountValue is basis points (5% = 500).
 * - discountType 'amount':  discountValue is cents.
 */
export type PriceLine = {
  section: SectionKey;
  qtyHundredths: number;
  rateCents: number;
  discountType?: 'percent' | 'amount' | null;
  discountValue?: number | null;
};

export type PriceOptions = {
  serviceTaxOn: boolean;
  convenienceFeeOn: boolean;
  /** Basis points: 4% = 400. */
  serviceTaxBp: number;
  convenienceFeeBp: number;
};

export type Totals = {
  sections: Record<SectionKey, number>;
  subtotalCents: number;
  serviceTaxCents: number;
  convenienceFeeCents: number;
  totalCents: number;
};

/** a × b ÷ d, rounded half-up. Inputs are integers; a×b stays far below 2^53 for real prices. */
export function mulDivRound(a: number, b: number, d: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(d) || d <= 0)
    throw new Error('mulDivRound needs integers and a positive divisor.');
  const product = a * b;
  const sign = product < 0 ? -1 : 1;
  const abs = Math.abs(product);
  // Half-up on the magnitude ("half away from zero"): 0.5 → 1, −0.5 → −1.
  return sign * Math.floor((abs + Math.floor(d / 2)) / d);
}

/** Percentage (basis points) of an amount, half-up. */
export function percentOf(amountCents: number, bp: number): number {
  return mulDivRound(amountCents, bp, 10_000);
}

/** The line's gross before discount: qty × rate, half-up. */
export function lineGrossCents(line: Pick<PriceLine, 'qtyHundredths' | 'rateCents'>): number {
  return mulDivRound(line.qtyHundredths, line.rateCents, 100);
}

/** The discount on one line, never more than the line itself. */
export function lineDiscountCents(line: PriceLine): number {
  const gross = lineGrossCents(line);
  const value = line.discountValue ?? 0;
  if (!line.discountType || value <= 0) return 0;
  const discount = line.discountType === 'percent' ? percentOf(gross, value) : value;
  return Math.min(discount, Math.max(gross, 0));
}

/** Line total = Qty × Rate − discount. */
export function lineTotalCents(line: PriceLine): number {
  return lineGrossCents(line) - lineDiscountCents(line);
}

export function computeTotals(lines: PriceLine[], options: PriceOptions): Totals {
  const sections = Object.fromEntries(SECTION_KEYS.map((key) => [key, 0])) as Record<
    SectionKey,
    number
  >;
  for (const line of lines) {
    if (!(line.section in sections)) throw new Error(`Unknown section ${line.section}`);
    sections[line.section] += lineTotalCents(line);
  }
  const subtotalCents = SECTION_KEYS.reduce((sum, key) => sum + sections[key], 0);
  const serviceTaxCents = options.serviceTaxOn ? percentOf(subtotalCents, options.serviceTaxBp) : 0;
  const convenienceFeeCents = options.convenienceFeeOn
    ? percentOf(subtotalCents + serviceTaxCents, options.convenienceFeeBp)
    : 0;
  return {
    sections,
    subtotalCents,
    serviceTaxCents,
    convenienceFeeCents,
    totalCents: subtotalCents + serviceTaxCents + convenienceFeeCents,
  };
}

export type Deposit = {
  /** deposit % × (subtotal + service tax) */
  depositCents: number;
  /** The card convenience fee on the deposit (0 unless paid by card). */
  cardFeeCents: number;
  /** What the customer pays. */
  totalDueCents: number;
};

export function computeDeposit(
  totals: Pick<Totals, 'subtotalCents' | 'serviceTaxCents'>,
  depositBp: number,
  options: { byCard: boolean; convenienceFeeBp: number },
): Deposit {
  const depositCents = percentOf(totals.subtotalCents + totals.serviceTaxCents, depositBp);
  const cardFeeCents = options.byCard ? percentOf(depositCents, options.convenienceFeeBp) : 0;
  return { depositCents, cardFeeCents, totalDueCents: depositCents + cardFeeCents };
}

/**
 * The total WITHOUT the card fee: what a customer paying by cash or check owes (subtotal + tax).
 * DECISIONS P5-6 / H4: the card convenience fee applies to card payments only.
 */
export function baseTotalCents(totals: Pick<Totals, 'subtotalCents' | 'serviceTaxCents'>): number {
  return totals.subtotalCents + totals.serviceTaxCents;
}

/** What is charged to a card for `baseCents` owed: + the card fee % when the fee is on. */
export function cardChargeCents(baseCents: number, fee: { convenienceFeeOn: boolean; convenienceFeeBp: number }): number {
  return baseCents + (fee.convenienceFeeOn ? percentOf(baseCents, fee.convenienceFeeBp) : 0);
}

/**
 * Invoice balance, in base money (no card fee): base total − deposit received (its base, not the
 * card fee paid on it) − payments credited. Paying it by card adds the fee: cardChargeCents().
 * ref §4.2 example C: base $195.00 − $39.00 = $156.00; by card + 4% = $162.24.
 */
export function balanceDueCents(
  baseTotal: number,
  depositReceivedCents: number,
  paymentsCents: number,
): number {
  return baseTotal - depositReceivedCents - paymentsCents;
}

/** Rounds a duration in minutes UP to the next step (15-minute billing, ref §4.1). */
export function roundMinutesUp(minutes: number, step: number): number {
  if (step <= 0) return minutes;
  return Math.ceil(minutes / step) * step;
}

/** Hours worked (minutes) → quantity in hundredths of an hour, after rounding to the step. */
export function minutesToQtyHundredths(minutes: number, step: number): number {
  return mulDivRound(roundMinutesUp(minutes, step), 100, 60);
}

/** "12.50" / "12.5" / "$1,234" → cents. Returns null for anything that is not money. */
export function parseMoney(text: string): number | null {
  const clean = text.trim().replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** "2.5" → 250 hundredths. Returns null for anything that is not a non-negative number with ≤2 decimals. */
export function parseQty(text: string): number | null {
  const clean = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** "4" / "4.5" (%) → basis points. */
export function parsePercentBp(text: string): number | null {
  const cents = parseQty(text);
  return cents === null ? null : cents;
}

export function formatQty(hundredths: number): string {
  const value = hundredths / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '');
}
