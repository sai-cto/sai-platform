/**
 * THE ESTIMATE BUILDER (managers' written requirements, Nov 2026, "Estimate"):
 *
 *   labor        load / drive / unload as 3 lines, or 1 line, at the crew's hourly rate
 *                ("N Men" line item); a Cornellian gets a rate $20/hr lower (a setting)
 *   truck        customer's own truck → none (labor only); one set of fees per truck
 *                local (up to the long-distance miles)      → "<size>' Truck Local" × days
 *                long distance (over that)                 → "<size>' Truck Long Distance - Day" × days
 *                                                            + "… - Mileage" × miles
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
import { jobDayEntity, jobEntity, quoteLineEntity } from '../entities';
import { P } from '../permissions';
import { ACCESS_FLAGS, hhmcCatalogItems, hhmcEstimates, hhmcJobDays, type AccessFlag, type Stage } from '../schema';
import { loadSettings, type HhmcSettings } from '../settings';
import { optionalText, parse } from './input';
import { routeStops, routeThrough, type Route } from './maps';
import { loadJob, trucksOf } from './common';
import { parseQty, type SectionKey } from './pricing';
import { editableQuote, quoteLines } from './quote';

import { quoteEditable, TRUCK_SIZES, truckSizeOf, type TruckSize } from '../rules';
export { TRUCK_SIZES, type TruckSize };

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
  /** How many of our trucks (each pays its own day fee and mileage). */
  truckCount: number;
  /** The sizes of the specific trucks picked on the work request, one per truck. When given,
   *  they replace truckSize × truckCount (one set of lines per size). */
  truckSizes?: TruckSize[];
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

/** Line-item names compared loosely: case, dashes (- – —), quotes (' ’ ′) and spaces don't matter. */
export function sameName(a: string, b: string): boolean {
  const norm = (v: string) => v.toLowerCase().replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\u2018\u2019\u2032`]/g, "'").replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

/** Is this a truck line the builder prices (local day fee, long-distance day fee or mileage)? */
export function isTruckLine(name: string): boolean {
  return /\btruck\b.*\b(local|long distance)\b/i.test(name);
}

function find(catalog: CatalogRow[], name: string): CatalogRow {
  const row = catalog.find((c) => c.isActive && sameName(c.name, name));
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
  // Cornellian = a lower hourly rate (not a fixed-amount discount), so changing the hours later
  // keeps it right and a quote-wide % discount still applies on top.
  const cornellian = input.cornellian && cornellianCentsPerHour > 0;
  const laborRate = cornellian ? Math.max(labor.rateCents - cornellianCentsPerHour, 0) : labor.rateCents;
  const laborLine = (label: string | null, hundredths: number) => {
    if (hundredths <= 0) return;
    lines.push(
      line(labor, hundredths, {
        name: label ? `${labor.name} – ${label}` : labor.name,
        rateCents: laborRate,
        description: cornellian ? `Cornellian rate: $${settings.cornellianDiscountPerHour}/hr off $${(labor.rateCents / 100).toFixed(2)}/hr` : null,
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
    const longDistance = input.distanceTenths !== null && input.distanceTenths > Math.round(settings.longDistanceMiles * 10);
    if (input.distanceTenths === null) warnings.push('No mileage yet: priced as a local move. Enter the miles to check.');
    const days = input.truckDaysHundredths > 0 ? input.truckDaysHundredths : 100;
    // How many trucks of each size: the picked trucks, or N of the one chosen size.
    const bySize = new Map<TruckSize, number>();
    if (input.truckSizes?.length) for (const size of input.truckSizes) bySize.set(size, (bySize.get(size) ?? 0) + 1);
    else bySize.set(input.truckSize, Math.max(1, Math.floor(input.truckCount)));
    truckPricing = longDistance ? 'long_distance' : 'local';
    for (const size of TRUCK_SIZES) {
      const trucks = bySize.get(size);
      if (!trucks) continue;
      const each = trucks > 1 ? `${trucks} trucks` : null;
      if (longDistance) {
        lines.push(line(find(catalog, `${size}' Truck Long Distance - Day`), days * trucks, { description: each }));
        // Miles in hundredths: tenths × 10; every truck drives the distance.
        lines.push(line(find(catalog, `${size}' Truck Long Distance - Mileage`), input.distanceTenths! * 10 * trucks, { description: each }));
      } else {
        lines.push(line(find(catalog, `${size}' Truck Local`), days * trucks, { description: each }));
      }
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
    const valuations = catalog.filter((c) => c.isActive && c.section === 'valuation');
    const v = valuations.find((c) => /basic|0\.60/i.test(c.name)) ?? valuations[0];
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
  truckCount: z.coerce.number().int().min(1).max(10).default(1),
  /** Price the trucks picked on the work request (each at its own size). */
  usePickedTrucks: z.boolean().default(false),
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
    // The trucks picked on the work request, each at its size (a truck with no size in its
    // name, e.g. "Van", is priced at the size chosen in the builder).
    const picked = f.usePickedTrucks && job.truckIds.length ? (await trucksOf(s)).filter((t) => job.truckIds.includes(t.id)) : [];
    const truckSizes = picked.length ? picked.map((t) => truckSizeOf(t.name) ?? f.truckSize) : undefined;
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
        truckCount: f.truckCount,
        truckSizes,
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
    // The builder prices the truck, so a truck line already on the quote (e.g. the default
    // "16' Truck Local" every new local work request starts with) is replaced, never doubled.
    const remove = f.replace ? existing : existing.filter((l) => isTruckLine(l.name));
    for (const l of remove) await archiveRecord(s, quoteLineEntity, l.id);
    let order = existing.length - remove.length;
    for (const l of result.lines) await createRecord(s, quoteLineEntity, { ...l, quoteId: quote.id, sortOrder: order++ });
    await updateRecord(s, jobEntity, job.id, {
      crewSize: f.crewSize,
      cornellian: f.cornellian,
      ownTruck: f.ownTruck,
      trucks: f.ownTruck ? 0 : (truckSizes?.length ?? f.truckCount),
      distanceTenths,
      driveMinutes,
      distanceSource: distanceTenths === null ? null : job.distanceSource === 'maps' && job.distanceTenths === distanceTenths ? 'maps' : 'manual',
      originAccess: f.originAccess as AccessFlag[],
      destinationAccess: f.destinationAccess as AccessFlag[],
      originNotes: f.originNotes,
      destinationNotes: f.destinationNotes,
    });
    // The move days follow the priced crew and trucks (the calendar's capacity and the booking
    // read the days, not the job); a one-day move also takes the priced hours.
    const trucks = f.ownTruck ? 0 : (truckSizes?.length ?? f.truckCount);
    const hundredths = f.hoursMode === 'total' ? f.totalHours : (f.loadHours ?? 0) + (f.driveHours ?? 0) + (f.unloadHours ?? 0);
    const days = await s.db.select().from(hhmcJobDays).where(and(s.where(hhmcJobDays), eq(hhmcJobDays.jobId, job.id)));
    for (const d of days) {
      const durationMinutes = days.length === 1 && hundredths ? Math.round((hundredths * 60) / 100) : d.durationMinutes;
      if (d.crewSize !== f.crewSize || d.trucks !== trucks || d.durationMinutes !== durationMinutes)
        await updateRecord(s, jobDayEntity, d.id, { crewSize: f.crewSize, trucks, durationMinutes });
    }
    return result;
  });
}

export type MileageResult =
  | { status: 'updated'; route: Route }
  | { status: 'not_configured' | 'missing_addresses' | 'already_set' | 'no_route' | 'changed' | 'locked' };

/**
 * Fills the work request's mileage and drive time from the maps adapter, through every stop.
 * The outside call happens between two short transactions, never inside one.
 *
 * - force (staff pressed "Look up mileage"): replaces whatever is there; problems are errors.
 * - automatic (a work request was created or its addresses changed): only fills an empty
 *   distance, never overwrites miles typed in by staff, and never throws.
 */
export async function refreshMileage(ctx: BusinessContext, jobId: string, options: { force?: boolean } = {}): Promise<MileageResult> {
  const force = options.force ?? false;
  const fail = (status: Exclude<MileageResult['status'], 'updated'>, message: string): MileageResult => {
    if (force) throw new ValidationError(message);
    return { status };
  };
  const locked = async (s: Scope, j: { id: string; stage: Stage }) =>
    j.stage === 'closed' || j.stage === 'cancelled' || (force && !(await mileageChangeable(s, j)));
  const job = await withScope(ctx, P.jobsWrite, async (s) => {
    const j = await loadJob(s, jobId);
    return { ...j, isLocked: await locked(s, j) };
  });
  if (job.isLocked) return fail('locked', 'The price is settled (signed, booked or closed), so the mileage is not changed. Release the booking or send a new estimate first.');
  if (!force && job.distanceTenths !== null) return { status: 'already_set' };
  const stops = routeStops(job);
  if (!job.originAddress || !job.destinationAddress) return fail('missing_addresses', 'Enter both addresses on the work request first.');
  const route = await routeThrough(stops);
  if (route === 'not_configured') return fail('not_configured', 'Automatic mileage is not set up yet (no Google Maps key). Enter the miles by hand.');
  if (!route) return fail('no_route', 'Google Maps could not find a driving route through those addresses. Check them, or enter the miles by hand.');
  return withScope(ctx, P.jobsWrite, async (s) => {
    const now = await loadJob(s, jobId);
    if (routeStops(now).join('\n') !== stops.join('\n')) return fail('changed', 'The addresses changed while looking up the mileage. Try again.');
    if (await locked(s, now)) return fail('locked', 'The work request changed while looking up the mileage. Reload the page.');
    if (!force && now.distanceTenths !== null) return { status: 'already_set' } as MileageResult;
    await updateRecord(s, jobEntity, jobId, { distanceTenths: route.distanceTenths, driveMinutes: route.driveMinutes, distanceSource: 'maps' });
    return { status: 'updated', route } as MileageResult;
  });
}

/** Staff may replace the miles only while the price is still open: the quote can be edited and
 *  no estimate is signed (a signed price was agreed on the old miles). */
export async function mileageChangeable(s: Scope, job: { id: string; stage: Stage }): Promise<boolean> {
  if (!quoteEditable(job.stage)) return false;
  const [signed] = await s.db
    .select({ id: hhmcEstimates.id })
    .from(hhmcEstimates)
    .where(and(s.where(hhmcEstimates, 'include'), eq(hhmcEstimates.jobId, job.id), eq(hhmcEstimates.status, 'signed')))
    .limit(1);
  return !signed;
}

/** "Look up mileage" in the estimate builder. */
export async function lookupMileage(ctx: BusinessContext, jobId: string): Promise<Route> {
  const result = await refreshMileage(ctx, jobId, { force: true });
  if (result.status !== 'updated') throw new ValidationError('Could not look up the mileage. Try again.');
  return result.route;
}
