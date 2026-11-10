/**
 * Charges and payments on an order.
 *
 *  - recalculateCharges(): works out the automatic lines (storage, shipping, insurance) from
 *    the order's articles, using the pricing rules in rules.ts.
 *  - addCharge() / removeCharge(): lines staff add by hand (supplies, packing, fees).
 *  - payOrder(): takes one payment for everything not yet paid.
 *
 * KI-3 (not copied): the old system saved lines as Paid and charged the card in a second
 * step. Here the card is charged first and the lines are marked paid in the same database
 * transaction, so "paid" always has a payment behind it.
 */
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { takeLock } from '@/core/db/lock';
import { withScope, type Scope } from '@/core/db/scope';
import { NotFoundError, ValidationError } from '@/core/errors';
import { isUuid } from '@/core/ids';
import { refundPayment, takePayment } from '@/core/payments/payments';
import { payments } from '@/core/db/schema/tenant';
import { authorize, can } from '@/core/rbac/permissions';
import { archiveRecord, createRecord, updateRecord } from '@/core/records/records';
import type { BusinessContext } from '@/core/tenancy/context';
import { orderEntity, orderItemEntity } from '../entities';
import { CORE, P } from '../permissions';
import {
  computeTotals,
  dollarsToCents,
  isOrderActive,
  localDate,
  maxDiscountCents,
  priceArticle,
  subtotalCents,
  type PricedLine,
} from '../rules';
import { brssArticles, brssOrderArticles, brssOrderItems, brssOrders, brssProducts } from '../schema';
import { loadSettings } from '../settings';
import { loadCatalog } from './catalog';
import { optionalText, parse, requiredId, requiredText, wholeNumber } from './input';

/** One at a time per order: two people working on the same order cannot double up. */
export const lockOrder = (s: Scope, orderId: string) => takeLock(s, `brss:order:${orderId}`);

async function findOrder(s: Scope, id: string) {
  if (!isUuid(id)) throw new NotFoundError();
  const [order] = await s.db
    .select()
    .from(brssOrders)
    .where(and(s.where(brssOrders), eq(brssOrders.id, id)))
    .limit(1);
  if (!order) throw new NotFoundError();
  return order;
}

const unpaidLines = (s: Scope, orderId: string) =>
  s.db
    .select()
    .from(brssOrderItems)
    .where(
      and(
        s.where(brssOrderItems),
        eq(brssOrderItems.orderId, orderId),
        eq(brssOrderItems.status, 'new'),
      ),
    )
    .orderBy(asc(brssOrderItems.createdAt), asc(brssOrderItems.id));

// ---------------------------------------------------------------- automatic lines

/**
 * Brings the order's automatic lines in line with its articles and the current prices.
 *
 * For each article and pricing rule there is at most one line:
 *  - already paid → left alone, whatever has changed since (a paid line is history);
 *  - unpaid → updated to the current price;
 *  - missing → created (R-ORD-048: status New until a payment covers it);
 *  - no longer applies (article taken off the order, service removed) → archived.
 * Lines added by hand are never touched. Returns what could not be priced (KI-5).
 * Call it inside a scope, after anything that affects prices.
 */
export async function recalculateCharges(
  s: Scope,
  orderId: string,
): Promise<{ problems: string[] }> {
  await lockOrder(s, orderId);
  const order = await findOrder(s, orderId);
  if (!isOrderActive(order.status)) return { problems: [] };

  const [links, existing, catalog, settings] = await Promise.all([
    s.db
      .select({ link: brssOrderArticles, article: brssArticles })
      .from(brssOrderArticles)
      .innerJoin(brssArticles, eq(brssArticles.id, brssOrderArticles.articleId))
      .where(and(s.where(brssOrderArticles), eq(brssOrderArticles.orderId, orderId)))
      .orderBy(asc(brssArticles.articleNumber)),
    s.db
      .select()
      .from(brssOrderItems)
      .where(and(s.where(brssOrderItems), eq(brssOrderItems.orderId, orderId))),
    loadCatalog(s),
    loadSettings(s.ctx),
  ]);

  const wanted: PricedLine[] = [];
  const problems: string[] = [];
  for (const { link, article } of links) {
    const priced = priceArticle({
      services: order.services,
      storageMonths: order.storageTermMonths,
      shipToZone: order.shipToZone,
      article,
      link,
      catalog,
      settings,
    });
    wanted.push(...priced.lines);
    problems.push(...priced.problems);
  }

  const automatic = existing.filter((line) => line.rule !== null);
  const sameLine = (line: { articleId: string | null; rule: string | null }, w: PricedLine) =>
    line.articleId === w.articleId && line.rule === w.rule;

  for (const w of wanted) {
    if (automatic.some((line) => line.status === 'paid' && sameLine(line, w))) continue;
    const current = automatic.find((line) => line.status === 'new' && sameLine(line, w));
    if (current) {
      // updateRecord writes (and logs) only if something really changed.
      await updateRecord(s, orderItemEntity, current.id, {
        productId: w.productId,
        description: w.description,
        unitPriceCents: w.unitPriceCents,
      });
    } else {
      await createRecord(s, orderItemEntity, {
        orderId,
        articleId: w.articleId,
        productId: w.productId,
        rule: w.rule,
        description: w.description,
        quantity: 1, // R-ORD-027
        unitPriceCents: w.unitPriceCents,
        status: 'new',
      });
    }
  }
  for (const line of automatic) {
    if (line.status === 'new' && !wanted.some((w) => sameLine(line, w)))
      await archiveRecord(s, orderItemEntity, line.id);
  }
  return { problems };
}

/** "Work out charges again" on the order page. */
export function recalculateOrder(ctx: BusinessContext, orderId: string) {
  return withScope(ctx, P.ordersWrite, (s) => recalculateCharges(s, orderId));
}

/** What cannot be priced right now, without changing anything (shown on the order page). */
export function pricingProblems(ctx: BusinessContext, orderId: string) {
  return withScope(ctx, P.ordersRead, async (s) => {
    const order = await findOrder(s, orderId);
    if (!isOrderActive(order.status)) return [];
    const [links, paid, catalog, settings] = await Promise.all([
      s.db
        .select({ link: brssOrderArticles, article: brssArticles })
        .from(brssOrderArticles)
        .innerJoin(brssArticles, eq(brssArticles.id, brssOrderArticles.articleId))
        .where(and(s.where(brssOrderArticles), eq(brssOrderArticles.orderId, orderId))),
      s.db
        .select({ articleId: brssOrderItems.articleId, rule: brssOrderItems.rule })
        .from(brssOrderItems)
        .where(
          and(
            s.where(brssOrderItems),
            eq(brssOrderItems.orderId, orderId),
            eq(brssOrderItems.status, 'paid'),
          ),
        ),
      loadCatalog(s),
      loadSettings(s.ctx),
    ]);
    // An article whose automatic lines are all paid has nothing left to price.
    return links.flatMap(({ link, article }) =>
      paid.some((line) => line.articleId === article.id && line.rule !== null)
        ? []
        : priceArticle({
            services: order.services,
            storageMonths: order.storageTermMonths,
            shipToZone: order.shipToZone,
            article,
            link,
            catalog,
            settings,
          }).problems,
    );
  });
}

// ---------------------------------------------------------------- lines added by hand

const chargeInput = z.object({
  productId: requiredId('a product'),
  /** Left empty = the product's own name and price. */
  description: optionalText(200),
  price: z.string().default(''),
  quantity: wholeNumber('the quantity', 1, 999),
});

/**
 * R-ORD-047: staff can add a line for any supplies, packing or fee product, and may change
 * its description, unit price and quantity. Price and quantity must both be above zero.
 * (Fees such as a late reschedule are added this way: the old system has no rule for them.)
 */
export function addCharge(ctx: BusinessContext, orderId: string, raw: unknown) {
  const input = parse(chargeInput, raw);
  const typedPrice = input.price === '' ? undefined : dollarsToCents(input.price);
  if (typedPrice === null) throw new ValidationError('Enter the price in dollars, like 12.50.');
  return withScope(ctx, P.ordersWrite, async (s) => {
    await lockOrder(s, orderId);
    const order = await findOrder(s, orderId);
    if (!isOrderActive(order.status))
      throw new ValidationError(`This order is ${order.status}; charges cannot be added.`);
    const [product] = await s.db
      .select()
      .from(brssProducts)
      .where(and(s.where(brssProducts), eq(brssProducts.id, input.productId)))
      .limit(1);
    if (!product?.isActive || !['supply', 'packing', 'fee'].includes(product.kind))
      throw new ValidationError('Choose a supplies, packing or fee product.');
    const unitPriceCents = typedPrice ?? product.unitPriceCents;
    if (unitPriceCents <= 0) throw new ValidationError('The price must be above zero.');
    return createRecord(s, orderItemEntity, {
      orderId,
      productId: product.id,
      description: input.description ?? product.name,
      quantity: input.quantity,
      unitPriceCents,
      status: 'new',
    });
  });
}

/** Takes an unpaid hand-added line off the order (archived, so it can be restored). */
export function removeCharge(ctx: BusinessContext, itemId: string) {
  return withScope(ctx, P.ordersWrite, async (s) => {
    if (!isUuid(itemId)) throw new NotFoundError();
    const [line] = await s.db
      .select()
      .from(brssOrderItems)
      .where(and(s.where(brssOrderItems), eq(brssOrderItems.id, itemId)))
      .limit(1);
    if (!line) throw new NotFoundError();
    await lockOrder(s, line.orderId);
    if (line.status === 'paid') throw new ValidationError('A paid charge cannot be removed.');
    if (line.rule !== null)
      throw new ValidationError(
        'This charge is worked out from an article. Take the article off the order, or give a discount when taking payment.',
      );
    await archiveRecord(s, orderItemEntity, itemId);
  });
}

// ---------------------------------------------------------------- payment

/** The amounts on the payment form, before anyone presses the button. */
export function paymentPreview(input: {
  unpaidCents: number;
  canDiscountAny: boolean;
  taxPercent: number;
  maxStaffDiscountPercent: number;
}) {
  return {
    maxDiscountCents: maxDiscountCents(
      input.unpaidCents,
      input.canDiscountAny,
      input.maxStaffDiscountPercent,
    ),
    totals: computeTotals({
      subtotalCents: input.unpaidCents,
      discountCents: 0,
      tipCents: 0,
      taxPercent: input.taxPercent,
    }),
  };
}

const paymentInput = z.object({
  discount: z.string().default('0'),
  tip: z.string().default('0'),
  method: z.enum(['card', 'cash', 'check'], { message: 'Choose how the customer is paying' }),
  /** A token from the payment provider. Card numbers never reach this server (KI-4). */
  cardToken: z.string().max(200).optional(),
  /** Made by the page for this one form, so a double click cannot charge twice (R-ORD-132). */
  idempotencyKey: z.string().min(8).max(100),
  /** Ticked to take payment even though some charges could not be priced. */
  acceptUnpriced: z.boolean().default(false),
});

export type PaymentOutcome = { paid: boolean; message: string };

/**
 * Takes one payment for every unpaid line on the order.
 *
 *  - R-ORD-113: total = subtotal + tax + tip − discount; tax on (subtotal − discount).
 *  - R-ORD-116: the discount is capped (staff limit, or the whole subtotal with the
 *    "discount above the staff limit" permission). The old system quietly reduced a
 *    too-large discount; here the person is told and nothing is charged.
 *  - R-ORD-118: a total of zero takes no payment; the lines are simply marked paid.
 *  - R-ORD-119: the discount, tip and tax are added to the order's running totals.
 *  - R-ORD-086: the first payment on a storage order starts the storage clock.
 *  - A declined card leaves a "failed" payment on record and every line unpaid.
 */
export function payOrder(
  ctx: BusinessContext,
  orderId: string,
  raw: unknown,
): Promise<PaymentOutcome> {
  const input = parse(paymentInput, raw);
  const discountCents = dollarsToCents(input.discount || '0');
  const tipCents = dollarsToCents(input.tip || '0');
  if (discountCents === null) throw new ValidationError('Enter the discount in dollars, like 5.00.');
  if (tipCents === null) throw new ValidationError('Enter the tip in dollars, like 5.00.');
  authorize(ctx, P.ordersWrite);

  return withScope(ctx, CORE.paymentsWrite, async (s) => {
    await lockOrder(s, orderId);
    const order = await findOrder(s, orderId);
    if (!isOrderActive(order.status))
      throw new ValidationError(`This order is ${order.status}; payments cannot be taken.`);

    // Prices are brought up to date first, so the amount charged is today's amount.
    const { problems } = await recalculateCharges(s, orderId);
    if (problems.length > 0 && !input.acceptUnpriced)
      throw new ValidationError(
        `Some charges could not be worked out, so they are NOT in this payment: ${problems.join(' ')} Fix them, or tick "Take payment without them".`,
      );

    const lines = await unpaidLines(s, orderId);
    if (lines.length === 0)
      throw new ValidationError('Nothing on this order is waiting to be paid.');

    const settings = await loadSettings(ctx);
    const subtotal = subtotalCents(lines);
    const cap = maxDiscountCents(
      subtotal,
      can(ctx, P.discountAny),
      settings.maxStaffDiscountPercent,
    );
    if (discountCents > cap)
      throw new ValidationError(
        `The largest discount you can give on this payment is ${(cap / 100).toFixed(2)}.`,
      );
    const totals = computeTotals({
      subtotalCents: subtotal,
      discountCents,
      tipCents,
      taxPercent: settings.taxPercent,
    });

    let paymentId: string | null = null;
    if (totals.totalCents > 0) {
      const payment = await takePayment(s, {
        amountCents: totals.totalCents,
        description: `Order ${order.orderNumber}`,
        idempotencyKey: input.idempotencyKey,
        customerId: order.customerId,
        method: input.method,
        paymentMethodToken: input.method === 'card' ? input.cardToken : undefined,
        subjectType: orderEntity.key,
        subjectId: orderId,
      });
      // The same form sent twice returns the first payment. If that payment was for
      // something else, this form is stale: stop rather than mark the wrong lines paid.
      if (payment.subjectId !== orderId || payment.amountCents !== totals.totalCents)
        throw new ValidationError(
          'This payment form was already used. Reload the page and try again.',
        );
      if (payment.status !== 'succeeded')
        return {
          paid: false,
          message: `The payment did not go through: ${payment.failureReason ?? 'declined'}. Nothing was marked paid.`,
        };
      paymentId = payment.id;
    }

    for (const line of lines)
      await updateRecord(s, orderItemEntity, line.id, { status: 'paid', paymentId });

    await updateRecord(s, orderEntity, orderId, {
      discountCents: order.discountCents + totals.discountCents,
      tipCents: order.tipCents + totals.tipCents,
      taxCents: order.taxCents + totals.taxCents,
      // R-ORD-086, R-ORD-087: only a real charge starts the clock, and only once.
      ...(paymentId && order.services.includes('storage') && !order.storageEffectiveDate
        ? { storageEffectiveDate: localDate(new Date(), ctx.business.timeZone) }
        : {}),
    });

    return {
      paid: true,
      message:
        totals.totalCents > 0
          ? `Payment of ${(totals.totalCents / 100).toFixed(2)} taken.`
          : 'Nothing to pay after the discount; the charges are marked paid.',
    };
  });
}

const refundInput = z.object({ amount: z.string(), reason: requiredText('a reason', 300) });

/**
 * Gives money back on one of the order's payments. The charges stay marked paid: what a
 * refund should undo on the order is an open question (README), so staff decide by hand.
 */
export function refundOrderPayment(ctx: BusinessContext, orderId: string, paymentId: string, raw: unknown) {
  const input = parse(refundInput, raw);
  const amountCents = dollarsToCents(input.amount);
  if (amountCents === null || amountCents <= 0)
    throw new ValidationError('Enter the amount to refund in dollars, like 12.50.');
  authorize(ctx, P.ordersWrite);
  return withScope(ctx, CORE.paymentsWrite, async (s) => {
    if (!isUuid(paymentId) || !isUuid(orderId)) throw new NotFoundError();
    const [payment] = await s.db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          s.where(payments),
          eq(payments.id, paymentId),
          eq(payments.subjectType, orderEntity.key),
          eq(payments.subjectId, orderId),
        ),
      )
      .limit(1);
    if (!payment) throw new NotFoundError();
    // A refund the provider refuses is still recorded (status "failed"), so check the result.
    return refundPayment(s, { paymentId, amountCents, reason: input.reason });
  });
}
