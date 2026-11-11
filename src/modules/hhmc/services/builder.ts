/**
 * THE ESTIMATE BUILDER (managers' written requirements, Nov 2026, "Estimate"):
 *
 *   labor        load / drive / unload as 3 lines, or 1 line, at the crew's hourly rate
 *                ("N Men" line item), minus the Cornellian discount ($20/hr, a setting)
 *   truck        customer's own truck → none (labor only)
 *                local (< long-distance miles, a setting)  → "<size>' Truck Local" × days
 *                long distance (≥ that)                    → "<size>' Truck Long Distance – Day" × days
 *                                                            + "… – Mileage" × miles
 *   materials    any catalog items (dollies, blankets, wrap, boxes) with a quantity
 *   packing help "Packing Labor" × hours
 *   valuation    "Basic Coverage ($0.60/lb per article)" at $0
 *
 * buildLines() is pure (no database, no clock); applyBuilder() saves the result as quote lines
 * through the normal record functions, so the activity log and tenancy rules hold. Rates always
 * come from the line items in Settings, so managers change prices there, not in code.
 */
import { z } from 'zod';
import { withScope, type Scope } from '@/core/db/scope';
import { ValidationError } from '@/core/errors';
import { isUuid } from '@/core/ids';
import { archiveRecord, createRecord, updateRecord } from '@/core/records/records';
import type { BusinessContext } from '@/core/tenancy/context';
import { and, asc, eq } from 'drizzle-orm';
import { jobEntity, quoteLineEntity } from '../entities';
import { P } from '../permissions';
import { ACCESS_FLAGS, hhmcCatalogItems, type AccessFlag } from '../schema';
import { loadSettings, type HhmcSettings } from '../settings';
import { optionalText, parse } from './input';
import { routeBetween } from './maps';
import { mulDivRound, parseQty, type SectionKey } from './pricing';
import { editableQuote, quoteLines } from './quote';

export const TRUCK_SIZES = ['16', '22', '26'] as const;
export type TruckSize = (typeof TRUCK_SIZES)[number];

export type CatalogRow = { id: string; name: string; section: SectionKey; unit: string; rateCents: number; isActive: boolean };

export type BuilderInput = {
  crewSize: number;
  /** 'split' = load / drive / unload lines; 'total' = one labor line. */
  hoursMode: 'split' | 'total';
  totalHundredths: number;
  loadHundredths: number;
  driveHundredths: number;
  unloadHundredths: number;
  cornellian: boolean;
  ownTruck: boolean;
  truckSize: TruckSize;
  truckDaysHundredths: number;
  /** Road miles × 10, or null when unknown. */
  distanceTenths: number | null;
  materials: { catalogItemId: string; qtyHundredths: number }[];
  packingHundredths: number;
  valuation: boolean;
};

export type BuiltLine = {
  section: SectionKey;
  catalogItemId: string | null;
  name: string;
  unit: string;
  qtyHundredths: number;
  rateCents: number;
  discountType: 'amount' | null;
  discountValue: number | null;
  description: string | null;
};

export type BuildResult = {
  lines: BuiltLine[];
  truckPricing: 'own_truck' | 'local' | 'long_distance';
  warnings: string[];
};

function find(catalog: CatalogRow[], name: string): CatalogRow {
  const row = catalog.find((c) => c.isActive && c.name.trim().toLowerCase() === name.toLowerCase());
  if (!row) throw new ValidationError(`The line item "${name}" is missing or switched off. Add it in Settings › Line items.`);
  return row;
}

function line(item: CatalogRow, qtyHundredths: number, extra: Partial<BuiltLine> = {}): BuiltLine {
  return {
    section: item.section,
    catalogItemId: item.id,
    name: item.name,
    unit: item.unit,
    qtyHundredths,
    rateCents: item.rateCents,
    discountType: null,
    discountValue: null,
    description: null,
    ...extra,
  };
}

/** Pure: the quote lines for these move details. */
export function buildLines(
  input: BuilderInput,
  catalog: CatalogRow[],
  settings: Pick<HhmcSettings, 'longDistanceMiles' | 'cornellianDiscountPerHour'>,
): BuildResult {
  const warnings: string[] = [];
  const lines: BuiltLine[] = [];
  const labor = find(catalog, `${input.crewSize} Men`);
  const cornellianCentsPerHour = Math.round(settings.cornellianDiscountPerHour * 100);
  const laborLine = (label: string | null, hundredths: number) => {
    if (hundredths <= 0) return;
    const discount = input.cornellian && cornellianCentsPerHour > 0 ? mulDivRound(hundredths, cornellianCentsPerHour, 100) : 0;
    lines.push(
      line(labor, hundredths, {
        name: label ? `${labor.name} – ${label}` : labor.name,
        discountType: discount > 0 ? 'amount' : null,
        discountValue: discount > 0 ? discount : null,
        description: discount > 0 ? `Cornellian discount: $${settings.cornellianDiscountPerHour}/hr` : null,
      }),
    );
  };
  if (input.hoursMode === 'split') {
    laborLine('Load', input.loadHundredths);
    laborLine('Drive', input.driveHundredths);
    laborLine('Unload', input.unloadHundredths);
  } else {
    laborLine(null, input.totalHundredths);
  }
  if (!lines.length) throw new ValidationError('Enter the labor hours (load, drive and unload, or one total).');

  let truckPricing: BuildResult['truckPricing'] = 'own_truck';
  if (!input.ownTruck) {
    const longDistance = input.distanceTenths !== null && input.distanceTenths >= Math.round(settings.longDistanceMiles * 10);
    if (input.distanceTenths === null) warnings.push('No mileage yet: priced as a local move. Enter the miles to check.');
    const days = input.truckDaysHundredths > 0 ? input.truckDaysHundredths : 100;
    if (longDistance) {
      truckPricing = 'long_distance';
      lines.push(line(find(catalog, `${input.truckSize}' Truck Long Distance – Day`), days));
      // Miles in hundredths: tenths × 10.
      lines.push(line(find(catalog, `${input.truckSize}' Truck Long Distance – Mileage`), input.distanceTenths! * 10));
    } else {
      truckPricing = 'local';
      lines.push(line(find(catalog, `${input.truckSize}' Truck Local`), days));
    }
  }

  for (const m of input.materials) {
    if (m.qtyHundredths <= 0) continue;
    const item = catalog.find((c) => c.id === m.catalogItemId && c.isActive);
    if (!item) throw new ValidationError('A material is no longer in the line items. Reload the page.');
    lines.push(line(item, m.qtyHundredths));
  }
  if (input.packingHundredths > 0) lines.push(line(find(catalog, 'Packing Labor'), input.packingHundredths));
  if (input.valuation) {
    const v = catalog.find((c) => c.isActive && c.section === 'valuation');
    if (v) lines.push(line(v, 100));
    else warnings.push('No valuation line item is set up, so none was added.');
  }
  return { lines, truckPricing, warnings };
}

// ---------------------------------------------------------------- saving

const hours = (label: string) =>
  z
    .string()
    .trim()
    .default('')
    .transform((v, c) => {
      if (!v) return 0;
      const q = parseQty(v);
      if (q === null || q > 200_00) {
        c.addIssue({ code: 'custom', message: `${label}: enter hours as a number, e.g. 2.5` });
        return z.NEVER;
      }
      return q;
    });

const builderForm = z.object({
  crewSize: z.coerce.number().int().min(1, 'Choose the crew size').max(12),
  hoursMode: z.enum(['split', 'total']).default('split'),
  totalHours: hours('Total'),
  loadHours: hours('Load'),
  driveHours: hours('Drive'),
  unloadHours: hours('Unload'),
  cornellian: z.boolean().default(false),
  ownTruck: z.boolean().default(false),
  truckSize: z.enum(TRUCK_SIZES).default('16'),
  truckDays: hours('Truck days'),
  miles: z.string().trim().default(''),
  driveMinutes: z.string().trim().default(''),
  packingHours: hours('Packing help'),
  valuation: z.boolean().default(true),
  replace: z.boolean().default(false),
  materials: z.record(z.string(), z.string()).default({}),
  originAccess: z.array(z.enum(ACCESS_FLAGS)).default([]),
  destinationAccess: z.array(z.enum(ACCESS_FLAGS)).default([]),
  originNotes: optionalText(1000),
  destinationNotes: optionalText(1000),
});

export type BuilderForm = z.input<typeof builderForm>;

async function activeCatalog(s: Scope): Promise<CatalogRow[]> {
  return s.db
    .select({ id: hhmcCatalogItems.id, name: hhmcCatalogItems.name, section: hhmcCatalogItems.section, unit: hhmcCatalogItems.unit, rateCents: hhmcCatalogItems.rateCents, isActive: hhmcCatalogItems.isActive })
    .from(hhmcCatalogItems)
    .where(and(s.where(hhmcCatalogItems), eq(hhmcCatalogItems.isActive, true)))
    .orderBy(asc(hhmcCatalogItems.sortOrder));
}

/** Builds the quote from the move details and saves the details on the job. */
export async function applyBuilder(ctx: BusinessContext, jobId: string, raw: unknown) {
  return withScope(ctx, P.jobsWrite, async (s) => {
    const { job, quote } = await editableQuote(s, jobId);
    const f = parse(builderForm, raw);
    let distanceTenths: number | null = null;
    if (f.miles) {
      const q = parseQty(f.miles);
      if (q === null || q > 10_000_00) throw new ValidationError('Enter the miles as a number, e.g. 212.4');
      distanceTenths = Math.round(q / 10);
    }
    let driveMinutes: number | null = null;
    if (f.driveMinutes) {
      if (!/^\d{1,4}$/.test(f.driveMinutes)) throw new ValidationError('Enter the drive time in whole minutes.');
      driveMinutes = Number(f.driveMinutes);
    }
    const materials = Object.entries(f.materials)
      .filter(([, v]) => v.trim() !== '' && v.trim() !== '0')
      .map(([id, v]) => {
        const q = parseQty(v);
        if (!isUuid(id) || q === null) throw new ValidationError('Enter material quantities as numbers.');
        return { catalogItemId: id, qtyHundredths: q };
      });
    const settings = await loadSettings(ctx);
    const result = buildLines(
      {
        crewSize: f.crewSize,
        hoursMode: f.hoursMode,
        totalHundredths: f.totalHours,
        loadHundredths: f.loadHours,
        driveHundredths: f.driveHours,
        unloadHundredths: f.unloadHours,
        cornellian: f.cornellian,
        ownTruck: f.ownTruck,
        truckSize: f.truckSize,
        truckDaysHundredths: f.truckDays,
        distanceTenths,
        materials,
        packingHundredths: f.packingHours,
        valuation: f.valuation,
      },
      await activeCatalog(s),
      settings,
    );
    const existing = await quoteLines(s, quote.id);
    if (f.replace) for (const l of existing) await archiveRecord(s, quoteLineEntity, l.id);
    let order = f.replace ? 0 : existing.length;
    for (const l of result.lines) await createRecord(s, quoteLineEntity, { ...l, quoteId: quote.id, sortOrder: order++ });
    await updateRecord(s, jobEntity, job.id, {
      crewSize: f.crewSize,
      cornellian: f.cornellian,
      ownTruck: f.ownTruck,
      trucks: f.ownTruck ? 0 : Math.max(job.trucks, 1),
      distanceTenths,
      driveMinutes,
      distanceSource: distanceTenths === null ? null : job.distanceSource === 'maps' && job.distanceTenths === distanceTenths ? 'maps' : 'manual',
      originAccess: f.originAccess as AccessFlag[],
      destinationAccess: f.destinationAccess as AccessFlag[],
      originNotes: f.originNotes,
      destinationNotes: f.destinationNotes,
    });
    return result;
  });
}

/** Fills the job's mileage and drive time from the maps adapter (only when a key is set). */
export async function lookupMileage(ctx: BusinessContext, jobId: string) {
  return withScope(ctx, P.jobsWrite, async (s) => {
    const { job } = await editableQuote(s, jobId);
    if (!job.originAddress || !job.destinationAddress) throw new ValidationError('Enter both addresses on the job first.');
    const route = await routeBetween(job.originAddress, job.destinationAddress);
    if (route === 'not_configured') throw new ValidationError('Automatic mileage is not set up yet (no maps key). Enter the miles by hand.');
    if (!route) throw new ValidationError('The maps service could not find a driving route between those addresses. Check them, or enter the miles by hand.');
    await updateRecord(s, jobEntity, job.id, { distanceTenths: route.distanceTenths, driveMinutes: route.driveMinutes, distanceSource: 'maps' });
    return route;
  });
}
