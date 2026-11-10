/**
 * Articles: the boxes and items BRSS handles. Intake on an order, later edits, and the
 * status and warehouse location updates that follow a box through storage and delivery.
 */
import { and, asc, desc, eq, ilike, inArray, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { customers } from '@/core/db/schema/tenant';
import { withScope, type Scope } from '@/core/db/scope';
import { NotFoundError, ValidationError } from '@/core/errors';
import { isUuid } from '@/core/ids';
import { authorize, can } from '@/core/rbac/permissions';
import { customerName } from '@/core/records/core-entities';
import { nextRecordNumber } from '@/core/records/numbering';
import { archiveRecord, createRecord, listRecords, updateRecord } from '@/core/records/records';
import type { BusinessContext } from '@/core/tenancy/context';
import { articleEntity, orderArticleEntity } from '../entities';
import { CORE, P } from '../permissions';
import {
  ARTICLE_STATUSES,
  INSURANCE_OPTIONS_CENTS,
  ROWS,
  SECTIONS,
  articleTypeChoices,
  becomesStored,
  billableWeight,
  billableWeightProblem,
  dollarsToCents,
  isOrderActive,
  zipPrefix,
} from '../rules';
import {
  brssArticles,
  brssOrderArticles,
  brssOrderItems,
  brssOrders,
  brssProducts,
  brssWarehouses,
  type ArticleStatus,
} from '../schema';
import { loadSettings } from '../settings';
import { lockOrder, recalculateCharges } from './charges';
import { optionalId, optionalText, parse } from './input';

export const ARTICLES_PAGE_SIZE = 50;

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

async function findArticle(s: Scope, id: string) {
  if (!isUuid(id)) throw new NotFoundError();
  const [article] = await s.db
    .select()
    .from(brssArticles)
    .where(and(s.where(brssArticles), eq(brssArticles.id, id)))
    .limit(1);
  if (!article) throw new NotFoundError();
  return article;
}

// ---------------------------------------------------------------- intake

/** A measurement typed by staff: rounded UP to a whole number (R-ORD-066). */
const measurement = z.coerce
  .number({ message: 'Enter the measurements as numbers' })
  .min(0, 'A measurement cannot be negative')
  .max(1000, 'That measurement is too large')
  .transform((value) => Math.ceil(value));

const intakeInput = z.object({
  type: z.enum(['standard_box', 'non_boxed', 'flat_rate_box'], {
    message: 'Choose what kind of article this is',
  }),
  description: optionalText(200),
  weightLb: measurement.default(0),
  lengthIn: measurement.default(0),
  widthIn: measurement.default(0),
  heightIn: measurement.default(0),
  productId: optionalId,
  quantity: z.coerce.number().int().min(1).max(50).default(1),
  insurance: z.coerce.number().default(0),
  otherStoragePrice: z.string().default(''),
  cornellShippingAccount: z.boolean().default(false),
  receivedFromZip: optionalText(10),
});

type IntakeInput = z.infer<typeof intakeInput>;

/**
 * Turns what the intake form sent into the values to store, applying the intake rules.
 * Shared by intake (new article) and editing (existing article).
 */
async function articleValues(
  s: Scope,
  order: typeof brssOrders.$inferSelect,
  input: IntakeInput,
) {
  const settings = await loadSettings(s.ctx);
  // R-ORD-065: only a storage order that is not ship-to-Cornell offers the other types.
  if (!articleTypeChoices(order.services).includes(input.type))
    throw new ValidationError('This order takes standard boxes only.');
  // R-ORD-044: extra insurance comes from a fixed list.
  const insuranceCents = Math.round(input.insurance * 100);
  if (!INSURANCE_OPTIONS_CENTS.includes(insuranceCents))
    throw new ValidationError('Choose the extra insurance from the list.');

  const toCornell = order.services.includes('ship_to_cornell');
  const base = {
    type: input.type,
    description: input.description,
    additionalInsuranceCents: insuranceCents,
  };
  const noSize = { weightLb: 0, lengthIn: 0, widthIn: 0, heightIn: 0, billableWeightLb: 0 };
  const link = {
    cornellShippingAccount: toCornell && input.cornellShippingAccount,
    receivedFromZip: null as string | null,
  };

  if (input.type === 'standard_box') {
    // R-ORD-071: a ship-to-Cornell box sent by a third party has no size and no zip.
    if (toCornell && !input.cornellShippingAccount) {
      return {
        article: { ...base, ...noSize, productId: null, otherStoragePriceCents: null },
        link,
      };
    }
    if (toCornell) {
      if (zipPrefix(input.receivedFromZip) === null)
        throw new ValidationError(
          'Enter the zip the box was sent from (digits only), so shipping can be priced.',
        );
      link.receivedFromZip = input.receivedFromZip;
    }
    const size = {
      weightLb: input.weightLb,
      lengthIn: input.lengthIn,
      widthIn: input.widthIn,
      heightIn: input.heightIn,
    };
    // R-ORD-066: all four are required for a standard box.
    if (Object.values(size).some((value) => value <= 0))
      throw new ValidationError('Enter the length, width, height and weight of the box.');
    const billable = billableWeight(size, settings.dimensionalDivisor);
    const problem = billableWeightProblem(billable, settings.maxBillableWeightLb);
    if (problem) throw new ValidationError(problem);
    // R-ORD-070: a standard box has no product of its own.
    return {
      article: {
        ...base,
        ...size,
        billableWeightLb: billable,
        productId: null,
        otherStoragePriceCents: null,
      },
      link,
    };
  }

  // R-ORD-068, R-ORD-069: non-boxed items and flat rate boxes need their product; no size.
  const wantedKind = input.type === 'non_boxed' ? 'storage_item' : 'flat_rate_box';
  const [product] = input.productId
    ? await s.db
        .select()
        .from(brssProducts)
        .where(and(s.where(brssProducts), eq(brssProducts.id, input.productId)))
        .limit(1)
    : [];
  if (!product?.isActive || product.kind !== wantedKind)
    throw new ValidationError(
      input.type === 'non_boxed' ? 'Choose what kind of item this is.' : 'Choose a flat rate box.',
    );
  let otherStoragePriceCents: number | null = null;
  if (product.role === 'other_non_boxed') {
    otherStoragePriceCents = dollarsToCents(input.otherStoragePrice);
    if (otherStoragePriceCents === null || otherStoragePriceCents <= 0)
      throw new ValidationError('An "Other" item needs a monthly storage price above zero.');
  }
  return {
    article: { ...base, ...noSize, productId: product.id, otherStoragePriceCents },
    link,
  };
}

/**
 * Takes in a new article on an order: creates it, puts it on the order, and works out its
 * charges, all in one go. (The old system saved the article first and linked it later,
 * which could leave articles belonging to no order: not copied.)
 * R-ORD-069: a flat rate box with quantity N creates N identical articles.
 */
export async function intakeArticle(ctx: BusinessContext, orderId: string, raw: unknown) {
  const input = parse(intakeInput, raw);
  authorize(ctx, P.articlesWrite);
  return withScope(ctx, P.ordersWrite, async (s) => {
    await lockOrder(s, orderId);
    const order = await findOrder(s, orderId);
    if (!isOrderActive(order.status))
      throw new ValidationError(`This order is ${order.status}; articles cannot be added.`);
    const values = await articleValues(s, order, input);
    const count = input.type === 'flat_rate_box' ? input.quantity : 1;
    const numbers = await nextRecordNumber(
      s,
      articleEntity,
      brssArticles.articleNumber,
      'A',
      count,
    );
    const created = [];
    for (const articleNumber of numbers) {
      // R-ORD-052: the article belongs to the order's customer. R-ORD-075: no status yet.
      const article = await createRecord(s, articleEntity, {
        ...values.article,
        articleNumber,
        customerId: order.customerId,
        status: null,
      });
      await createRecord(s, orderArticleEntity, {
        orderId,
        articleId: article.id,
        ...values.link,
      });
      created.push(article);
    }
    const { problems } = await recalculateCharges(s, orderId);
    return { articles: created, problems };
  });
}

/** Corrects an article's details from an order's page; unpaid charges are worked out again. */
export async function updateArticleOnOrder(
  ctx: BusinessContext,
  orderId: string,
  articleId: string,
  raw: unknown,
) {
  const input = parse(intakeInput, raw);
  authorize(ctx, P.articlesWrite);
  return withScope(ctx, P.ordersWrite, async (s) => {
    await lockOrder(s, orderId);
    const order = await findOrder(s, orderId);
    if (!isOrderActive(order.status))
      throw new ValidationError(`This order is ${order.status}; its articles cannot be changed.`);
    const link = await findLink(s, orderId, articleId);
    const values = await articleValues(s, order, input);
    await updateRecord(s, articleEntity, articleId, values.article);
    await updateRecord(s, orderArticleEntity, link.id, values.link);
    return recalculateCharges(s, orderId);
  });
}

async function findLink(s: Scope, orderId: string, articleId: string) {
  if (!isUuid(articleId)) throw new NotFoundError();
  const [link] = await s.db
    .select()
    .from(brssOrderArticles)
    .where(
      and(
        s.where(brssOrderArticles),
        eq(brssOrderArticles.orderId, orderId),
        eq(brssOrderArticles.articleId, articleId),
      ),
    )
    .limit(1);
  if (!link) throw new NotFoundError();
  return link;
}

/**
 * R-ORD-073: the customer's earlier articles that are not on this order yet, newest first,
 * whatever their status. (Whether a delivered article should be offered is an open question.)
 */
export async function earlierArticles(ctx: BusinessContext, orderId: string) {
  return withScope(ctx, P.articlesRead, async (s) => {
    const order = await findOrder(s, orderId);
    const onOrder = s.db
      .select({ id: brssOrderArticles.articleId })
      .from(brssOrderArticles)
      .where(and(s.where(brssOrderArticles), eq(brssOrderArticles.orderId, orderId)));
    return s.db
      .select()
      .from(brssArticles)
      .where(
        and(
          s.where(brssArticles),
          eq(brssArticles.customerId, order.customerId),
          notInArray(brssArticles.id, onOrder),
        ),
      )
      .orderBy(desc(brssArticles.createdAt))
      .limit(50);
  });
}

/** R-ORD-073: puts one of the customer's earlier articles on this order. */
export async function attachArticle(ctx: BusinessContext, orderId: string, articleId: string) {
  return withScope(ctx, P.ordersWrite, async (s) => {
    await lockOrder(s, orderId);
    const order = await findOrder(s, orderId);
    if (!isOrderActive(order.status))
      throw new ValidationError(`This order is ${order.status}; articles cannot be added.`);
    const article = await findArticle(s, articleId);
    if (article.customerId !== order.customerId)
      throw new ValidationError("That article belongs to a different customer.");
    // R-ORD-062: an article is on an order once.
    const [already] = await s.db
      .select({ id: brssOrderArticles.id })
      .from(brssOrderArticles)
      .where(
        and(
          s.where(brssOrderArticles),
          eq(brssOrderArticles.orderId, orderId),
          eq(brssOrderArticles.articleId, articleId),
        ),
      )
      .limit(1);
    if (already) throw new ValidationError('That article is already on this order.');
    await createRecord(s, orderArticleEntity, { orderId, articleId });
    return recalculateCharges(s, orderId);
  });
}

/**
 * Takes an article off an order. The article itself stays (it belongs to the customer).
 * Refused once any of its charges on this order has been paid.
 */
export async function detachArticle(ctx: BusinessContext, orderId: string, articleId: string) {
  return withScope(ctx, P.ordersWrite, async (s) => {
    await lockOrder(s, orderId);
    const link = await findLink(s, orderId, articleId);
    const [paid] = await s.db
      .select({ id: brssOrderItems.id })
      .from(brssOrderItems)
      .where(
        and(
          s.where(brssOrderItems),
          eq(brssOrderItems.orderId, orderId),
          eq(brssOrderItems.articleId, articleId),
          eq(brssOrderItems.status, 'paid'),
        ),
      )
      .limit(1);
    if (paid)
      throw new ValidationError(
        'This article has paid charges on this order, so it cannot be taken off.',
      );
    await archiveRecord(s, orderArticleEntity, link.id);
    return recalculateCharges(s, orderId);
  });
}

// ---------------------------------------------------------------- status and location

const statusKeys = ARTICLE_STATUSES.map((s) => s.key) as [ArticleStatus, ...ArticleStatus[]];
const statusInput = z.enum(statusKeys, { message: 'Choose a status' });

/**
 * R-ORD-079: an article's status is set by hand and any status may follow any other.
 * Every change is in the activity log with who made it.
 */
export async function setArticleStatus(ctx: BusinessContext, articleId: string, raw: unknown) {
  const status = parse(statusInput, raw);
  return withScope(ctx, P.articlesWrite, (s) =>
    updateRecord(s, articleEntity, articleId, { status }),
  );
}

/** R-ORD-078: sets every article on an order to one status at once. */
export async function setOrderArticlesStatus(ctx: BusinessContext, orderId: string, raw: unknown) {
  const status = parse(statusInput, raw);
  return withScope(ctx, P.articlesWrite, async (s) => {
    await findOrder(s, orderId);
    const linked = await s.db
      .select({ id: brssArticles.id })
      .from(brssOrderArticles)
      .innerJoin(brssArticles, eq(brssArticles.id, brssOrderArticles.articleId))
      .where(
        and(s.where(brssOrderArticles), s.where(brssArticles), eq(brssOrderArticles.orderId, orderId)),
      );
    if (linked.length === 0) throw new ValidationError('This order has no articles yet.');
    for (const article of linked) await updateRecord(s, articleEntity, article.id, { status });
    return linked.length;
  });
}

const locationInput = z.object({
  warehouseId: optionalId,
  section: z
    .union([z.literal(''), z.enum(SECTIONS)])
    .nullish()
    .transform((value) => value || null),
  row: z
    .string()
    .nullish()
    .transform((value) => value || null)
    .refine((value) => value === null || ROWS.includes(value), 'Choose a row from the list'),
  pallet: z
    .union([z.literal(''), z.coerce.number().int().min(0).max(99)])
    .nullish()
    .transform((value) => (value === '' || value === null || value === undefined ? null : value)),
});

/**
 * R-ORD-081: where an article sits: warehouse, section, row, pallet.
 * R-ORD-076: giving a location to an article that had none sets its status to Stored.
 */
export async function setArticleLocation(ctx: BusinessContext, articleId: string, raw: unknown) {
  const after = parse(locationInput, raw);
  return withScope(ctx, P.articlesWrite, async (s) => {
    const before = await findArticle(s, articleId);
    if (after.warehouseId) {
      const [warehouse] = await s.db
        .select({ isActive: brssWarehouses.isActive })
        .from(brssWarehouses)
        .where(and(s.where(brssWarehouses), eq(brssWarehouses.id, after.warehouseId)))
        .limit(1);
      if (!warehouse) throw new ValidationError('Choose a warehouse from the list.');
      if (!warehouse.isActive && after.warehouseId !== before.warehouseId)
        throw new ValidationError('That warehouse is no longer in use.');
    }
    return updateRecord(s, articleEntity, articleId, {
      ...after,
      ...(becomesStored(before, after) ? { status: 'stored' as const } : {}),
    });
  });
}

// ---------------------------------------------------------------- reading

export type ArticleFilters = {
  /** "none" = no status yet. */
  status?: ArticleStatus | 'none';
  warehouseId?: string;
  q?: string;
  page?: number;
};

export async function listArticles(ctx: BusinessContext, filters: ArticleFilters = {}) {
  return withScope(ctx, P.articlesRead, async (s) => {
    const term = filters.q?.trim();
    const pattern = term ? `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const showNames = can(ctx, CORE.customersRead);
    const where: SQL | undefined = and(
      filters.status === 'none'
        ? isNull(brssArticles.status)
        : filters.status
          ? eq(brssArticles.status, filters.status)
          : undefined,
      filters.warehouseId && isUuid(filters.warehouseId)
        ? eq(brssArticles.warehouseId, filters.warehouseId)
        : undefined,
      pattern
        ? or(
            ilike(brssArticles.articleNumber, pattern),
            ilike(brssArticles.description, pattern),
            showNames
              ? inArray(
                  brssArticles.customerId,
                  s.db
                    .select({ id: customers.id })
                    .from(customers)
                    .where(
                      and(
                        s.where(customers, 'include'),
                        ilike(sql`${customers.firstName} || ' ' || ${customers.lastName}`, pattern),
                      ),
                    ),
                )
              : undefined,
          )
        : undefined,
    );
    const page = Math.max(1, filters.page ?? 1);
    const { rows, total } = await listRecords(s, articleEntity, {
      where,
      limit: ARTICLES_PAGE_SIZE,
      offset: (page - 1) * ARTICLES_PAGE_SIZE,
    });
    const people =
      showNames && rows.length > 0
        ? await s.db
            .select()
            .from(customers)
            .where(
              and(
                s.where(customers, 'include'),
                inArray(
                  customers.id,
                  rows.map((r) => r.customerId),
                ),
              ),
            )
        : [];
    const warehouses = await s.db.select().from(brssWarehouses).where(s.where(brssWarehouses, 'include'));
    return {
      total,
      page,
      rows: rows.map((article) => {
        const person = people.find((c) => c.id === article.customerId);
        return {
          ...article,
          customerName: person ? customerName(person) : '—',
          warehouseName: warehouses.find((w) => w.id === article.warehouseId)?.name ?? null,
        };
      }),
    };
  });
}

/** One article with the orders it has been on. */
export async function getArticle(ctx: BusinessContext, id: string) {
  return withScope(ctx, P.articlesRead, async (s) => {
    const article = await findArticle(s, id);
    const [customer] = can(ctx, CORE.customersRead)
      ? await s.db
          .select()
          .from(customers)
          .where(and(s.where(customers, 'include'), eq(customers.id, article.customerId)))
          .limit(1)
      : [];
    const [product] = article.productId
      ? await s.db
          .select({ name: brssProducts.name })
          .from(brssProducts)
          .where(and(s.where(brssProducts, 'include'), eq(brssProducts.id, article.productId)))
          .limit(1)
      : [];
    const orders = can(ctx, P.ordersRead)
      ? await s.db
          .select({
            id: brssOrders.id,
            orderNumber: brssOrders.orderNumber,
            status: brssOrders.status,
            services: brssOrders.services,
            createdAt: brssOrders.createdAt,
          })
          .from(brssOrderArticles)
          .innerJoin(brssOrders, eq(brssOrders.id, brssOrderArticles.orderId))
          .where(
            and(s.where(brssOrderArticles), s.where(brssOrders), eq(brssOrderArticles.articleId, id)),
          )
          .orderBy(asc(brssOrders.createdAt))
      : [];
    return {
      article,
      customerName: customer ? customerName(customer) : null,
      productName: product?.name ?? null,
      orders,
    };
  });
}

/** How many articles sit in each warehouse, and how many have no location yet (Operations page). */
export async function warehouseCounts(ctx: BusinessContext) {
  return withScope(ctx, P.articlesRead, async (s) => {
    const rows = await s.db
      .select({ warehouseId: brssArticles.warehouseId, n: sql<number>`count(*)::int` })
      .from(brssArticles)
      .where(
        and(
          s.where(brssArticles),
          // Articles that have left (delivered or shipped) no longer take up space.
          or(isNull(brssArticles.status), notInArray(brssArticles.status, ['delivered', 'shipped'])),
        ),
      )
      .groupBy(brssArticles.warehouseId);
    return rows;
  });
}
