/**
 * Reference data: regions and buildings, warehouses, the price list, storage term prices,
 * zip zones and shipping rates. Managed on the Operations, Pricing and Zip zones pages.
 * (In Salesforce these were picklists, custom settings and price book entries that only an
 * administrator could change; see README.md.)
 */
import { and, asc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { withScope, type Scope } from '@/core/db/scope';
import { ValidationError } from '@/core/errors';
import type { EntityDef } from '@/core/modules/contract';
import { archiveRecord, createRecord, updateRecord } from '@/core/records/records';
import type { BusinessContext } from '@/core/tenancy/context';
import {
  buildingEntity,
  productEntity,
  regionEntity,
  storageTermEntity,
  warehouseEntity,
  zipZoneEntity,
  zoneRateEntity,
} from '../entities';
import { P } from '../permissions';
import {
  PRODUCT_KINDS,
  PRODUCT_ROLES,
  dollarsToCents,
  findRate,
  findZone,
  labelOf,
  zipPrefix,
  type Catalog,
} from '../rules';
import {
  brssBuildings,
  brssProducts,
  brssRegions,
  brssStorageTermProducts,
  brssWarehouses,
  brssZipZones,
  brssZoneRates,
  type ProductKind,
  type ProductRole,
} from '../schema';
import { optionalText, parse, requiredId, requiredText, wholeNumber } from './input';

// ---------------------------------------------------------------- reading

/** Everything the pricing rules need. For use inside another service's scope. */
export async function loadCatalog(s: Scope): Promise<Catalog> {
  const [products, storageTerms, zipZones, zoneRates] = await Promise.all([
    s.db.select().from(brssProducts).where(s.where(brssProducts)),
    s.db.select().from(brssStorageTermProducts).where(s.where(brssStorageTermProducts)),
    s.db.select().from(brssZipZones).where(s.where(brssZipZones)),
    s.db.select().from(brssZoneRates).where(s.where(brssZoneRates)),
  ]);
  return { products, storageTerms, zipZones, zoneRates };
}

export async function loadPlaces(s: Scope) {
  const [regions, buildings, warehouses] = await Promise.all([
    s.db
      .select()
      .from(brssRegions)
      .where(s.where(brssRegions))
      .orderBy(asc(brssRegions.sortOrder), asc(brssRegions.name)),
    s.db
      .select()
      .from(brssBuildings)
      .where(s.where(brssBuildings))
      .orderBy(asc(brssBuildings.name)),
    s.db
      .select()
      .from(brssWarehouses)
      .where(s.where(brssWarehouses))
      .orderBy(asc(brssWarehouses.name)),
  ]);
  return { regions, buildings, warehouses };
}

export async function getPlaces(ctx: BusinessContext) {
  return withScope(ctx, P.catalogRead, loadPlaces);
}

export async function getPriceList(ctx: BusinessContext) {
  return withScope(ctx, P.catalogRead, async (s) => {
    const [products, storageTerms] = await Promise.all([
      s.db.select().from(brssProducts).where(s.where(brssProducts)).orderBy(asc(brssProducts.name)),
      s.db
        .select()
        .from(brssStorageTermProducts)
        .where(s.where(brssStorageTermProducts))
        .orderBy(asc(brssStorageTermProducts.termMonths), asc(brssStorageTermProducts.isOverweight)),
    ]);
    return { products, storageTerms };
  });
}

export async function getZones(ctx: BusinessContext) {
  return withScope(ctx, P.catalogRead, async (s) => {
    const [zipZones, zoneRates] = await Promise.all([
      s.db.select().from(brssZipZones).where(s.where(brssZipZones)).orderBy(asc(brssZipZones.zipLow)),
      s.db
        .select()
        .from(brssZoneRates)
        .where(s.where(brssZoneRates))
        .orderBy(asc(brssZoneRates.zone), asc(brssZoneRates.weightLb)),
    ]);
    return { zipZones, zoneRates };
  });
}

/** "What would it cost to ship this zip at this weight?" for the Zip zones page. */
export async function lookupShipping(ctx: BusinessContext, zip: string, weightLb: number) {
  const { zipZones, zoneRates } = await getZones(ctx);
  const zone = findZone(zipZones, zip);
  const rate = zone === null ? null : findRate(zoneRates, zone, weightLb);
  return { prefix: zipPrefix(zip), zone, rate };
}

// ---------------------------------------------------------------- regions and buildings

const regionInput = z.object({
  name: requiredText('a name', 80),
  sortOrder: wholeNumber('the order', 0, 999).default(0),
});

export async function createRegion(ctx: BusinessContext, raw: unknown) {
  return withScope(ctx, P.catalogWrite, (s) =>
    createRecord(s, regionEntity, parse(regionInput, raw)),
  );
}

const buildingInput = z.object({
  regionId: requiredId('a region'),
  name: requiredText('a name', 120),
  campusCategory: z.enum(['on_campus', 'off_campus'], { message: 'Choose a campus category' }),
});

export async function createBuilding(ctx: BusinessContext, raw: unknown) {
  return withScope(ctx, P.catalogWrite, (s) =>
    createRecord(s, buildingEntity, parse(buildingInput, raw)),
  );
}

/** KI-7: a manager can correct a building's campus category without a developer. */
export async function setBuildingCampusCategory(ctx: BusinessContext, id: string, raw: unknown) {
  const campusCategory = parse(buildingInput.shape.campusCategory, raw);
  return withScope(ctx, P.catalogWrite, (s) =>
    updateRecord(s, buildingEntity, id, { campusCategory }),
  );
}

// ---------------------------------------------------------------- warehouses

export async function createWarehouse(ctx: BusinessContext, raw: unknown) {
  const values = parse(z.object({ name: requiredText('a name', 80) }), raw);
  return withScope(ctx, P.catalogWrite, (s) => createRecord(s, warehouseEntity, values));
}

export async function setWarehouseActive(ctx: BusinessContext, id: string, isActive: boolean) {
  return withScope(ctx, P.catalogWrite, (s) => updateRecord(s, warehouseEntity, id, { isActive }));
}

// ---------------------------------------------------------------- price list

const kinds = PRODUCT_KINDS.map((k) => k.key) as [ProductKind, ...ProductKind[]];
const roles = PRODUCT_ROLES.map((r) => r.key) as [ProductRole, ...ProductRole[]];

const productInput = z.object({
  name: requiredText('a name', 120),
  code: requiredText('a code', 40),
  kind: z.enum(kinds, { message: 'Choose what kind of product this is' }),
  role: z
    .union([z.literal(''), z.enum(roles)])
    .nullish()
    .transform((value) => value || null),
  price: z.string(),
  description: optionalText(500),
});

function parseProduct(raw: unknown) {
  const { price, ...values } = parse(productInput, raw);
  const unitPriceCents = dollarsToCents(price);
  if (unitPriceCents === null) throw new ValidationError('Enter the price in dollars, like 12.50.');
  return { ...values, unitPriceCents };
}

/** R-SCH-105: the pricing rules find special products by role, so a role can be held by one active product only. */
async function assertRoleFree(s: Scope, role: ProductRole | null, exceptId?: string) {
  if (!role) return;
  const [holder] = await s.db
    .select({ name: brssProducts.name })
    .from(brssProducts)
    .where(
      and(
        s.where(brssProducts),
        eq(brssProducts.role, role),
        eq(brssProducts.isActive, true),
        exceptId ? ne(brssProducts.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (holder)
    throw new ValidationError(
      `"${holder.name}" is already the active product for "${labelOf(PRODUCT_ROLES, role)}". Switch that one off first.`,
    );
}

export async function createProduct(ctx: BusinessContext, raw: unknown) {
  const values = parseProduct(raw);
  return withScope(ctx, P.catalogWrite, async (s) => {
    await assertRoleFree(s, values.role);
    return createRecord(s, productEntity, values);
  });
}

const productChange = z.object({ price: z.string(), isActive: z.boolean() });

/** Changing a price affects new charges only: charges already on an order keep their price. */
export async function updateProduct(ctx: BusinessContext, id: string, raw: unknown) {
  const { price, isActive } = parse(productChange, raw);
  const unitPriceCents = dollarsToCents(price);
  if (unitPriceCents === null) throw new ValidationError('Enter the price in dollars, like 12.50.');
  return withScope(ctx, P.catalogWrite, async (s) => {
    const [current] = await s.db
      .select({ role: brssProducts.role })
      .from(brssProducts)
      .where(and(s.where(brssProducts), eq(brssProducts.id, id)))
      .limit(1);
    if (isActive && current) await assertRoleFree(s, current.role, id);
    return updateRecord(s, productEntity, id, { unitPriceCents, isActive });
  });
}

const storageTermInput = z.object({
  termMonths: wholeNumber('the term in months', 1, 99),
  isOverweight: z.boolean(),
  productId: requiredId('a storage product'),
});

/** R-ORD-034: one product per (term, overweight or not). Saving the same pair again replaces it. */
export async function setStorageTermProduct(ctx: BusinessContext, raw: unknown) {
  const values = parse(storageTermInput, raw);
  return withScope(ctx, P.catalogWrite, async (s) => {
    const [product] = await s.db
      .select({ kind: brssProducts.kind })
      .from(brssProducts)
      .where(and(s.where(brssProducts), eq(brssProducts.id, values.productId)))
      .limit(1);
    if (product?.kind !== 'storage_box')
      throw new ValidationError('Choose a product of the kind "Storage, standard box".');
    const [existing] = await s.db
      .select({ id: brssStorageTermProducts.id })
      .from(brssStorageTermProducts)
      .where(
        and(
          s.where(brssStorageTermProducts),
          eq(brssStorageTermProducts.termMonths, values.termMonths),
          eq(brssStorageTermProducts.isOverweight, values.isOverweight),
        ),
      )
      .limit(1);
    if (existing)
      return updateRecord(s, storageTermEntity, existing.id, { productId: values.productId });
    return createRecord(s, storageTermEntity, values);
  });
}

// ---------------------------------------------------------------- zip zones and rates

const zipZoneInput = z
  .object({
    zipLow: wholeNumber('the first zip prefix', 0, 999),
    zipHigh: wholeNumber('the last zip prefix', 0, 999),
    zone: wholeNumber('the zone', 1, 99),
  })
  .refine((v) => v.zipLow <= v.zipHigh, 'The first prefix cannot be after the last one');

/** R-SCH-148: ranges may not overlap, so a zip always has one answer. */
export async function createZipZone(ctx: BusinessContext, raw: unknown) {
  const values = parse(zipZoneInput, raw);
  return withScope(ctx, P.catalogWrite, async (s) => {
    const existing = await s.db.select().from(brssZipZones).where(s.where(brssZipZones));
    const clash = existing.find((z) => z.zipLow <= values.zipHigh && values.zipLow <= z.zipHigh);
    if (clash)
      throw new ValidationError(
        `That overlaps the range ${clash.zipLow}–${clash.zipHigh} (zone ${clash.zone}). Remove or change that one first.`,
      );
    return createRecord(s, zipZoneEntity, values);
  });
}

const zoneRateInput = z.object({
  zone: wholeNumber('the zone', 1, 99),
  weightLb: wholeNumber('the weight', 1, 1000),
  shipHome: z.string(),
  shipCornell: z.string(),
});

/** R-SCH-152: one rate row per zone and weight. Saving the same pair again replaces its prices. */
export async function setZoneRate(ctx: BusinessContext, raw: unknown) {
  const { shipHome, shipCornell, ...key } = parse(zoneRateInput, raw);
  const shipHomeCents = dollarsToCents(shipHome);
  const shipCornellCents = dollarsToCents(shipCornell);
  if (shipHomeCents === null || shipCornellCents === null)
    throw new ValidationError('Enter both prices in dollars, like 12.50.');
  return withScope(ctx, P.catalogWrite, async (s) => {
    const [existing] = await s.db
      .select({ id: brssZoneRates.id })
      .from(brssZoneRates)
      .where(
        and(
          s.where(brssZoneRates),
          eq(brssZoneRates.zone, key.zone),
          eq(brssZoneRates.weightLb, key.weightLb),
        ),
      )
      .limit(1);
    if (existing)
      return updateRecord(s, zoneRateEntity, existing.id, { shipHomeCents, shipCornellCents });
    return createRecord(s, zoneRateEntity, { ...key, shipHomeCents, shipCornellCents });
  });
}

// ---------------------------------------------------------------- removing

const REMOVABLE: Record<string, EntityDef> = Object.fromEntries(
  [regionEntity, buildingEntity, warehouseEntity, productEntity, storageTermEntity, zipZoneEntity, zoneRateEntity].map(
    (entity) => [entity.key, entity as EntityDef],
  ),
);

/**
 * "Remove" on the reference-data pages. It archives (recoverable from the Data tab); records
 * that already use the item keep pointing at it.
 */
export async function removeCatalogItem(ctx: BusinessContext, entityKey: string, id: string) {
  const entity = REMOVABLE[entityKey];
  if (!entity) throw new ValidationError('That cannot be removed here.');
  return withScope(ctx, P.catalogWrite, (s) => archiveRecord(s, entity, id));
}
