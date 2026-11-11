/**
 * The quote: exactly one per job, the only editable copy of the price (ref §3.4; ref §10
 * "pricing is copied three times"). Lines are priced by services/pricing.ts. Once the job is
 * booked the signed estimate is the price, so the quote is locked.
 */
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { withScope, type Scope } from '@/core/db/scope';
import { NotFoundError, ValidationError } from '@/core/errors';
import { isUuid } from '@/core/ids';
import { archiveRecord, createRecord, updateRecord } from '@/core/records/records';
import type { BusinessContext } from '@/core/tenancy/context';
import { quoteEntity, quoteLineEntity } from '../entities';
import { P } from '../permissions';
import { quoteEditable, STAGE_LABELS } from '../rules';
import { hhmcCatalogItems, hhmcDiscounts, hhmcEstimates, hhmcQuoteLines, type hhmcQuotes } from '../schema';
import { bp, loadSettings } from '../settings';
import { loadJob, loadQuoteFor } from './common';
import { optionalText, parse } from './input';
import { computeDeposit, computeTotals, parseMoney, parseQty, SECTION_KEYS, type PriceOptions } from './pricing';

export async function quoteLines(s: Scope, quoteId: string) {
  return s.db
    .select()
    .from(hhmcQuoteLines)
    .where(and(s.where(hhmcQuoteLines), eq(hhmcQuoteLines.quoteId, quoteId)))
    .orderBy(asc(hhmcQuoteLines.sortOrder), asc(hhmcQuoteLines.createdAt));
}

/** The price options of this business right now, plus the quote's own switches. */
export async function priceOptionsFor(
  s: Scope,
  quote: Pick<typeof hhmcQuotes.$inferSelect, 'serviceTaxOn' | 'convenienceFeeOn'>,
): Promise<PriceOptions & { depositBp: number }> {
  const settings = await loadSettings(s.ctx);
  return {
    serviceTaxOn: quote.serviceTaxOn,
    convenienceFeeOn: quote.convenienceFeeOn,
    serviceTaxBp: bp(settings.serviceTaxPercent),
    convenienceFeeBp: bp(settings.convenienceFeePercent),
    depositBp: bp(settings.depositPercent),
  };
}

/** The quote with its lines and totals, as the Job page shows it. */
export async function quoteSummary(s: Scope, jobId: string) {
  const quote = await loadQuoteFor(s, jobId);
  if (!quote) throw new NotFoundError();
  const lines = await quoteLines(s, quote.id);
  const options = await priceOptionsFor(s, quote);
  const totals = computeTotals(lines, options);
  const deposit = computeDeposit(totals, options.depositBp, { byCard: true, convenienceFeeBp: options.convenienceFeeBp });
  return { quote, lines, options, totals, deposit };
}

async function editableQuote(s: Scope, jobId: string) {
  const job = await loadJob(s, jobId);
  if (!quoteEditable(job.stage))
    throw new ValidationError(
      `The quote of a ${STAGE_LABELS[job.stage].toLowerCase()} job is locked. ${job.stage === 'booked' ? 'Release the booking to change it.' : ''}`.trim(),
    );
  const quote = await loadQuoteFor(s, jobId);
  if (!quote) throw new NotFoundError();
  const [signed] = await s.db
    .select({ id: hhmcEstimates.id })
    .from(hhmcEstimates)
    .where(and(s.where(hhmcEstimates), eq(hhmcEstimates.jobId, jobId), eq(hhmcEstimates.status, 'signed')))
    .limit(1);
  if (signed) throw new ValidationError('The customer has signed the estimate: that is the price now, so the quote is locked.');
  return { job, quote };
}

const lineInput = z.object({
  section: z.enum(SECTION_KEYS as [string, ...string[]], { message: 'Choose a section' }),
  catalogItemId: z.string().nullish().transform((v) => v || null),
  name: z.string().trim().max(200).default(''),
  unit: z.string().trim().max(20).default(''),
  qty: z.string().trim().min(1, 'Enter a quantity'),
  rate: z.string().trim().default(''),
  discountType: z.enum(['percent', 'amount', '']).nullish().transform((v) => (v ? v : null)),
  discount: z.string().trim().default(''),
  description: optionalText(1000),
});

async function lineValues(s: Scope, raw: unknown) {
  const input = parse(lineInput, raw);
  const qty = parseQty(input.qty);
  if (qty === null) throw new ValidationError('Enter the quantity as a number, e.g. 2.5.');
  if (qty > 10_000_000) throw new ValidationError('That quantity is too large.');
  let item: typeof hhmcCatalogItems.$inferSelect | null = null;
  if (input.catalogItemId) {
    if (!isUuid(input.catalogItemId)) throw new ValidationError('Choose an item from the list.');
    [item] = await s.db
      .select()
      .from(hhmcCatalogItems)
      .where(and(s.where(hhmcCatalogItems), eq(hhmcCatalogItems.id, input.catalogItemId)))
      .limit(1);
    if (!item) throw new ValidationError('Choose an item from the list.');
  }
  const rate = input.rate ? parseMoney(input.rate) : (item?.rateCents ?? null);
  if (rate === null) throw new ValidationError('Enter the rate in dollars, e.g. 195 or 1.09.');
  if (rate > 10_000_000) throw new ValidationError('That rate is too large.');
  const name = input.name || item?.name || '';
  if (!name) throw new ValidationError('Choose an item or type a name.');
  let discountValue: number | null = null;
  if (input.discountType) {
    const parsed = input.discountType === 'percent' ? parseQty(input.discount) : parseMoney(input.discount);
    if (parsed === null || parsed <= 0) throw new ValidationError('Enter the discount as a number.');
    if (input.discountType === 'percent' && parsed > 10_000) throw new ValidationError('A discount cannot be more than 100%.');
    discountValue = parsed;
  }
  return {
    section: (item && !input.section ? item.section : input.section) as (typeof SECTION_KEYS)[number],
    catalogItemId: item?.id ?? null,
    name,
    unit: input.unit || item?.unit || 'each',
    qtyHundredths: qty,
    rateCents: rate,
    discountType: discountValue === null ? null : (input.discountType as 'percent' | 'amount'),
    discountValue,
    description: input.description,
  };
}

export async function addQuoteLine(ctx: BusinessContext, jobId: string, raw: unknown) {
  return withScope(ctx, P.jobsWrite, async (s) => {
    const { quote } = await editableQuote(s, jobId);
    const values = await lineValues(s, raw);
    const existing = await quoteLines(s, quote.id);
    return createRecord(s, quoteLineEntity, { ...values, quoteId: quote.id, sortOrder: existing.length });
  });
}

async function lineOfJob(s: Scope, jobId: string, lineId: string) {
  const { quote } = await editableQuote(s, jobId);
  if (!isUuid(lineId)) throw new NotFoundError();
  const [line] = await s.db
    .select()
    .from(hhmcQuoteLines)
    .where(and(s.where(hhmcQuoteLines), eq(hhmcQuoteLines.id, lineId), eq(hhmcQuoteLines.quoteId, quote.id)))
    .limit(1);
  if (!line) throw new NotFoundError();
  return line;
}

export async function updateQuoteLine(ctx: BusinessContext, jobId: string, lineId: string, raw: unknown) {
  return withScope(ctx, P.jobsWrite, async (s) => {
    await lineOfJob(s, jobId, lineId);
    return updateRecord(s, quoteLineEntity, lineId, await lineValues(s, raw));
  });
}

export async function removeQuoteLine(ctx: BusinessContext, jobId: string, lineId: string) {
  return withScope(ctx, P.jobsWrite, async (s) => {
    await lineOfJob(s, jobId, lineId);
    await archiveRecord(s, quoteLineEntity, lineId);
  });
}

/** Applies one of the catalog's discounts (ref §4.3) to every line of the quote. */
export async function applyDiscountToQuote(ctx: BusinessContext, jobId: string, discountId: string) {
  return withScope(ctx, P.jobsWrite, async (s) => {
    const { quote } = await editableQuote(s, jobId);
    if (!isUuid(discountId)) throw new ValidationError('Choose a discount.');
    const [discount] = await s.db
      .select()
      .from(hhmcDiscounts)
      .where(and(s.where(hhmcDiscounts), eq(hhmcDiscounts.id, discountId), eq(hhmcDiscounts.isActive, true)))
      .limit(1);
    if (!discount) throw new ValidationError('Choose a discount.');
    for (const line of await quoteLines(s, quote.id)) {
      await updateRecord(s, quoteLineEntity, line.id, { discountType: 'percent', discountValue: discount.percentBp });
    }
    return discount.name;
  });
}

export async function setQuoteOptions(
  ctx: BusinessContext,
  jobId: string,
  options: { serviceTaxOn: boolean; convenienceFeeOn: boolean },
) {
  return withScope(ctx, P.jobsWrite, async (s) => {
    const { quote } = await editableQuote(s, jobId);
    return updateRecord(s, quoteEntity, quote.id, options);
  });
}


