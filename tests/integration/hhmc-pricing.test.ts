/**
 * HHMC pricing engine (src/modules/hhmc/services/pricing.ts). The three worked examples in
 * docs/hhmc-analysis/movegistics-reference.md §4.2 are acceptance tests: they must match to the cent.
 */
import { describe, expect, it } from 'vitest';
import {
  balanceDueCents,
  computeDeposit,
  computeTotals,
  lineTotalCents,
  minutesToQtyHundredths,
  mulDivRound,
  parseMoney,
  parseQty,
  roundMinutesUp,
  type PriceLine,
} from '@/modules/hhmc/services/pricing';

const FOUR = 400; // 4% in basis points
const TWENTY = 2000;

describe('pricing: worked examples (ref §4.2)', () => {
  it('A — local, 2 movers: $709.80 total; deposit $136.50 + $5.46 = $141.96', () => {
    const lines: PriceLine[] = [
      { section: 'transportation_labor', qtyHundredths: 250, rateCents: 19500 }, // 2 Men 2.5 h × $195
      { section: 'transportation_labor', qtyHundredths: 100, rateCents: 19500 }, // 16' truck 1 day × $195
    ];
    const totals = computeTotals(lines, { serviceTaxOn: false, convenienceFeeOn: true, serviceTaxBp: FOUR, convenienceFeeBp: FOUR });
    expect(totals.subtotalCents).toBe(68250);
    expect(totals.convenienceFeeCents).toBe(2730);
    expect(totals.totalCents).toBe(70980);
    const deposit = computeDeposit(totals, TWENTY, { byCard: true, convenienceFeeBp: FOUR });
    expect(deposit).toEqual({ depositCents: 13650, cardFeeCents: 546, totalDueCents: 14196 });
  });

  it('B — intrastate, ~283 miles: $2,313.47 + $92.54 = $2,406.01; deposit $481.20', () => {
    const lines: PriceLine[] = [
      { section: 'transportation_labor', qtyHundredths: 100, rateCents: 5500 }, // 16' LD truck day
      { section: 'transportation_labor', qtyHundredths: 28300, rateCents: 109 }, // 283 mi × $1.09
      { section: 'transportation_labor', qtyHundredths: 250, rateCents: 19500 },
      { section: 'transportation_labor', qtyHundredths: 500, rateCents: 19500 },
      { section: 'transportation_labor', qtyHundredths: 250, rateCents: 19500 },
    ];
    const totals = computeTotals(lines, { serviceTaxOn: true, convenienceFeeOn: false, serviceTaxBp: FOUR, convenienceFeeBp: FOUR });
    expect(totals.subtotalCents).toBe(231347);
    expect(totals.serviceTaxCents).toBe(9254);
    expect(totals.totalCents).toBe(240601);
    const deposit = computeDeposit(totals, TWENTY, { byCard: false, convenienceFeeBp: FOUR });
    expect(deposit.depositCents).toBe(48120);
    expect(deposit.totalDueCents).toBe(48120);
  });

  it('C — invoice after the job: $202.80 − $40.56 = $162.24; then paid to $0.00', () => {
    const totals = computeTotals([{ section: 'transportation_labor', qtyHundredths: 100, rateCents: 19500 }], {
      serviceTaxOn: false,
      convenienceFeeOn: true,
      serviceTaxBp: FOUR,
      convenienceFeeBp: FOUR,
    });
    expect(totals.totalCents).toBe(20280);
    // The deposit was 20% of $195 = $39.00, paid by card: + $1.56 = $40.56 received.
    const deposit = computeDeposit(totals, TWENTY, { byCard: true, convenienceFeeBp: FOUR });
    expect(deposit.totalDueCents).toBe(4056);
    expect(balanceDueCents(totals.totalCents, deposit.totalDueCents, 0)).toBe(16224);
    expect(balanceDueCents(totals.totalCents, deposit.totalDueCents, 16224)).toBe(0);
  });
});

describe('pricing: lines, sections and rounding', () => {
  it('a line is qty × rate minus a % or $ discount, never below zero', () => {
    expect(lineTotalCents({ section: 'packing_materials', qtyHundredths: 300, rateCents: 395 })).toBe(1185);
    expect(lineTotalCents({ section: 'transportation_labor', qtyHundredths: 100, rateCents: 19500, discountType: 'percent', discountValue: 500 })).toBe(18525);
    expect(lineTotalCents({ section: 'transportation_labor', qtyHundredths: 100, rateCents: 19500, discountType: 'amount', discountValue: 2000 })).toBe(17500);
    expect(lineTotalCents({ section: 'storage', qtyHundredths: 100, rateCents: 1000, discountType: 'amount', discountValue: 99999 })).toBe(0);
  });

  it('sections add up separately and the subtotal is their sum', () => {
    const totals = computeTotals(
      [
        { section: 'transportation_labor', qtyHundredths: 100, rateCents: 1000 },
        { section: 'packing_materials', qtyHundredths: 200, rateCents: 250 },
        { section: 'storage', qtyHundredths: 100, rateCents: 333 },
      ],
      { serviceTaxOn: true, convenienceFeeOn: true, serviceTaxBp: FOUR, convenienceFeeBp: FOUR },
    );
    expect(totals.sections.transportation_labor).toBe(1000);
    expect(totals.sections.packing_materials).toBe(500);
    expect(totals.sections.storage).toBe(333);
    expect(totals.sections.valuation).toBe(0);
    expect(totals.subtotalCents).toBe(1833);
    expect(totals.serviceTaxCents).toBe(73); // 73.32
    expect(totals.convenienceFeeCents).toBe(76); // 4% of 1906 = 76.24
    expect(totals.totalCents).toBe(1982);
  });

  it('rounds half-up', () => {
    expect(mulDivRound(1, 50, 100)).toBe(1); // 0.5 → 1
    expect(mulDivRound(1, 49, 100)).toBe(0);
    expect(mulDivRound(-1, 50, 100)).toBe(-1);
    expect(mulDivRound(682500, 400, 10000)).toBe(27300);
  });

  it('time is rounded up to 15 minutes and turned into hundredths of an hour', () => {
    expect(roundMinutesUp(61, 15)).toBe(75);
    expect(roundMinutesUp(60, 15)).toBe(60);
    expect(minutesToQtyHundredths(150, 15)).toBe(250);
    expect(minutesToQtyHundredths(141, 15)).toBe(250);
  });

  it('parses money and quantities typed by people', () => {
    expect(parseMoney('$1,234.5')).toBe(123450);
    expect(parseMoney('195')).toBe(19500);
    expect(parseMoney('1.234')).toBeNull();
    expect(parseMoney('-5')).toBeNull();
    expect(parseQty('2.5')).toBe(250);
    expect(parseQty('283')).toBe(28300);
    expect(parseQty('abc')).toBeNull();
  });
});
