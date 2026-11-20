/**
 * HHMC follow-up (Nov 2026): a work request shows its mileage straight away (Google Maps,
 * through every stop, looked up when it is created or its addresses change) and staff can pick
 * specific trucks, which put in their own truck line and are booked for the move.
 *
 * Google is never called: fetch is replaced by a fake that answers like the Distance Matrix API.
 * Fake data only (example.com, 555 numbers, made-up addresses).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withScope } from '@/core/db/scope';
import type { BusinessContext } from '@/core/tenancy/context';
import { P } from '@/modules/hhmc/permissions';
import { truckSizeOf } from '@/modules/hhmc/rules';
import { addTruck, bookJob, jobDaysOf, scheduleBetween } from '@/modules/hhmc/services/booking';
import { archiveRecord } from '@/core/records/records';
import { resourceEntity } from '@/core/records/core-entities';
import { CORE } from '@/modules/hhmc/permissions';
import { applyBuilder, buildLines, refreshMileage, type BuilderInput, type CatalogRow } from '@/modules/hhmc/services/builder';
import { loadJob } from '@/modules/hhmc/services/common';
import { customerLinkFor, payDepositByLink, sendEstimate, signEstimateByLink } from '@/modules/hhmc/services/estimates';
import { createJob, updateJob } from '@/modules/hhmc/services/jobs';
import { convertLead, createLead } from '@/modules/hhmc/services/leads';
import { directionsLink, embedMapUrl, formatRoute, routeStops, routeThrough } from '@/modules/hhmc/services/maps';
import { quoteSummary } from '@/modules/hhmc/services/quote';
import { buildLinkContext } from '@/core/links/links';
import { CATALOG } from '@/modules/hhmc/seed-data';
import { USERS, ctxFor } from './helpers';

let counter = 0;
const tag = () => `${Date.now().toString(36)}${(counter += 1)}`;
const admin = () => ctxFor(USERS.hhmcAdmin, 'hhmc', 'live');
const day = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);

/** A fake Routes API (computeRoutes): one route whose legs are `miles` miles and `minutes` minutes. */
function fakeGoogle(miles: number[], minutes: number[]) {
  const calls: { url: string; headers: Record<string, string>; body: { origin: { address: string }; destination: { address: string }; intermediates: { address: string }[] } }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ url: String(input), headers: init?.headers as Record<string, string>, body });
      const legs = body.intermediates.length + 1;
      const metres = miles.slice(0, legs).reduce((a, m) => a + Math.round(m * 1609.344), 0);
      const seconds = minutes.slice(0, legs).reduce((a, m) => a + m * 60, 0);
      return new Response(JSON.stringify({ routes: [{ distanceMeters: metres, duration: `${seconds}s` }] }), { status: 200 });
    }),
  );
  return calls;
}

async function newCustomerJob(ctx: BusinessContext, extra: Record<string, unknown> = {}) {
  const t = tag();
  const lead = await createLead(ctx, {
    firstName: 'Robin',
    lastName: `Route${t}`,
    email: `robin.${t}@example.com`,
    phone: `607-555-01${String(counter % 100).padStart(2, '0')}`,
    source: 'Google',
  });
  const { customerId } = await convertLead(ctx, lead.id, {});
  return createJob(ctx, {
    customerId,
    serviceType: 'local',
    jobType: 'Local Full Service Move',
    crewSize: '2',
    trucks: '1',
    originAddress: '10 Example Rd, Ithaca, NY',
    destinationAddress: '20 Sample Ave, Ithaca, NY',
    ...extra,
  });
}

const jobOf = (ctx: BusinessContext, id: string) => withScope(ctx, P.jobsRead, (s) => loadJob(s, id));

/** updateJob needs every detail: resend the job's own values with some changed. */
async function change(ctx: BusinessContext, id: string, patch: Record<string, unknown>) {
  const j = await jobOf(ctx, id);
  return updateJob(ctx, id, {
    companyName: j.companyName, poNumber: j.poNumber, originAddress: j.originAddress, destinationAddress: j.destinationAddress,
    extraStops: j.extraStops, moveDate: j.moveDate, tentative: j.tentative, arrivalWindow: j.arrivalWindow, serviceType: j.serviceType,
    jobType: j.jobType, bedrooms: j.bedrooms, crewSize: j.crewSize, trucks: j.trucks, truckIds: j.truckIds, customerComments: j.customerComments,
    scopeOfWork: j.scopeOfWork, internalNotes: j.internalNotes, ownerName: j.ownerName, coordinators: j.coordinators, rating: j.rating,
    source: j.source, sourceDetail: j.sourceDetail,
    ...patch,
  });
}

describe('maps adapter (pure, no Google)', () => {
  it('the route is pick-up, extra stops in order, then drop-off; blanks are skipped', () => {
    expect(routeStops({ originAddress: 'A', extraStops: ['B', ' ', 'C'], destinationAddress: 'D' })).toEqual(['A', 'B', 'C', 'D']);
    expect(routeStops({ originAddress: null, extraStops: [], destinationAddress: 'D' })).toEqual(['D']);
  });

  it('the Google Maps link needs no key and carries the stops as waypoints', () => {
    const link = new URL(directionsLink(['1 A St', '2 B St', '3 C St'])!);
    expect(link.hostname).toBe('www.google.com');
    expect(link.searchParams.get('origin')).toBe('1 A St');
    expect(link.searchParams.get('waypoints')).toBe('2 B St');
    expect(link.searchParams.get('destination')).toBe('3 C St');
    expect(link.searchParams.has('key')).toBe(false);
    expect(directionsLink(['only one'])).toBeNull();
  });

  it('no embedded map without its own key', () => {
    vi.stubEnv('GOOGLE_MAPS_EMBED_KEY', '');
    expect(embedMapUrl(['A', 'B'])).toBeNull();
    vi.unstubAllEnvs();
  });

  it('formats miles and drive time', () => {
    expect(formatRoute(2834, 292)).toBe('283.4 mi · 4 h 52 min');
    expect(formatRoute(125, 25)).toBe('12.5 mi · 25 min');
    expect(formatRoute(null, 10)).toBeNull();
  });

  it('reads the truck size from its name', () => {
    expect(truckSizeOf("Truck 2 · 26'")).toBe('26');
    expect(truckSizeOf('22 ft box truck')).toBe('22');
    expect(truckSizeOf('Truck 1 · 16’')).toBe('16');
    expect(truckSizeOf('Van')).toBeNull();
    expect(truckSizeOf('Truck 26')).toBeNull();
  });
});

describe('mileage through every stop', () => {
  beforeEach(() => vi.stubEnv('GOOGLE_MAPS_API_KEY', 'fake-test-key'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('one route through every stop, in one request', async () => {
    const calls = fakeGoogle([5, 7.5, 100], [10, 15, 120]);
    const route = await routeThrough(['A', 'B', 'C', 'D']);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(calls[0].headers['X-Goog-FieldMask']).toBe('routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.steps.navigationInstruction.instructions');
    expect(calls[0].body.origin.address).toBe('A');
    expect(calls[0].body.intermediates.map((i) => i.address)).toEqual(['B', 'C']);
    expect(calls[0].body.destination.address).toBe('D');
    expect(route).toEqual({ distanceTenths: 1125, driveMinutes: 145, states: null }); // no route line in the fake: states not checked
  });

  it('no route found (an empty answer) is "not found", never zero miles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    expect(await routeThrough(['A', 'B'])).toBeNull();
  });

  it('no key: not configured, and Google is not called', async () => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
    const calls = fakeGoogle([1], [1]);
    expect(await routeThrough(['A', 'B'])).toBe('not_configured');
    expect(calls).toHaveLength(0);
  });

  it('a new work request gets its mileage; new addresses clear it and it is looked up again', async () => {
    const ctx = await admin();
    fakeGoogle([12.4], [25]);
    const job = await newCustomerJob(ctx);
    expect(await refreshMileage(ctx, job.id)).toMatchObject({ status: 'updated' });
    expect(await jobOf(ctx, job.id)).toMatchObject({ distanceTenths: 124, driveMinutes: 25, distanceSource: 'maps' });

    // Saving without moving anything keeps it (and does not call Google again).
    await change(ctx, job.id, { internalNotes: 'Gate code at the office' });
    expect((await jobOf(ctx, job.id)).distanceTenths).toBe(124);
    expect(await refreshMileage(ctx, job.id)).toEqual({ status: 'already_set' });

    // A new drop-off: the old miles are wrong, so they are cleared and looked up again.
    await change(ctx, job.id, { destinationAddress: '30 Faraway Ln, Albany, NY' });
    expect(await jobOf(ctx, job.id)).toMatchObject({ distanceTenths: null, driveMinutes: null, distanceSource: null });
    vi.unstubAllGlobals();
    fakeGoogle([162.1], [170]);
    await refreshMileage(ctx, job.id);
    expect(await jobOf(ctx, job.id)).toMatchObject({ distanceTenths: 1621, distanceSource: 'maps' });
  });

  it('miles typed in by staff are never overwritten automatically; "Look up again" does replace them', async () => {
    const ctx = await admin();
    const job = await newCustomerJob(ctx);
    await applyBuilder(ctx, job.id, { crewSize: '2', hoursMode: 'total', totalHours: '3', truckSize: '16', truckCount: '1', truckDays: '1', miles: '40', valuation: false, materials: {} });
    expect((await jobOf(ctx, job.id)).distanceSource).toBe('manual');
    fakeGoogle([12.4], [25]);
    expect(await refreshMileage(ctx, job.id)).toEqual({ status: 'already_set' });
    expect((await jobOf(ctx, job.id)).distanceTenths).toBe(400);
    await refreshMileage(ctx, job.id, { force: true });
    expect(await jobOf(ctx, job.id)).toMatchObject({ distanceTenths: 124, distanceSource: 'maps' });
  });

  it('automatic lookups never fail the save; "Look up mileage" explains what is wrong', async () => {
    const ctx = await admin();
    const job = await newCustomerJob(ctx, { destinationAddress: '' });
    expect(await refreshMileage(ctx, job.id)).toEqual({ status: 'missing_addresses' });
    await expect(refreshMileage(ctx, job.id, { force: true })).rejects.toThrow(/both addresses/);
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
    const other = await newCustomerJob(ctx);
    expect(await refreshMileage(ctx, other.id)).toEqual({ status: 'not_configured' });
    await expect(refreshMileage(ctx, other.id, { force: true })).rejects.toThrow(/Google Maps key/);
  });
});

describe('picking specific trucks', () => {
  it('picked trucks set the count and put in their own truck lines on the new quote', async () => {
    const ctx = await admin();
    const t = tag();
    const big = await addTruck(ctx, `Test truck ${t} · 26'`);
    const van = await addTruck(ctx, `Test van ${t}`);
    const job = await newCustomerJob(ctx, { trucks: '1', truckIds: [big.id, van.id] });
    expect(await jobOf(ctx, job.id)).toMatchObject({ trucks: 2, truckIds: [big.id, van.id] });
    const quote = await withScope(ctx, P.jobsRead, (s) => quoteSummary(s, job.id));
    const trucks = quote.lines.filter((l) => /truck/i.test(l.name));
    expect(trucks.map((l) => [l.name, l.qtyHundredths, l.description])).toEqual(
      expect.arrayContaining([
        ["26' Truck Local", 100, `Test truck ${t} · 26'`],
        ["16' Truck Local", 100, `Test van ${t}`], // no size in the name: the default truck line
      ]),
    );
    expect(trucks).toHaveLength(2);
  });

  it('an unknown truck is refused', async () => {
    const ctx = await admin();
    await expect(newCustomerJob(ctx, { truckIds: ['00000000-0000-4000-8000-000000000000'] })).rejects.toThrow(/no longer in Settings/);
  });

  it('the builder prices each picked truck at its own size', () => {
    const catalog: CatalogRow[] = CATALOG.map((c, i) => ({ id: `item-${i}`, name: c.name, section: c.section, unit: c.unit, rateCents: c.rateCents, isActive: true }));
    const input: BuilderInput = {
      crewSize: 2, hoursMode: 'total', totalHundredths: 300, loadHundredths: 0, driveHundredths: 0, unloadHundredths: 0, cornellian: false, ownTruck: false,
      truckSize: '16', truckCount: 1, truckSizes: ['26', '16', '26'], truckDaysHundredths: 100, distanceTenths: 100, materials: [], packingHundredths: 0, valuation: false,
    };
    const { lines } = buildLines(input, catalog, { longDistanceMiles: 150, cornellianDiscountPerHour: 20 });
    expect(lines.filter((l) => /truck/i.test(l.name)).map((l) => [l.name, l.qtyHundredths])).toEqual([
      ["16' Truck Local", 100],
      ["26' Truck Local", 200],
    ]);
  });

  it('booking takes the picked truck; a second move cannot take the same truck at the same time', async () => {
    const ctx = await admin();
    const truck = await addTruck(ctx, `Test truck ${tag()} · 22'`);
    const moveDay = day(40 + (counter % 20));
    const booked = async () => {
      const job = await newCustomerJob(ctx, { moveDate: moveDay, truckIds: [truck.id] });
      const est = await sendEstimate(ctx, job.id);
      const link = await customerLinkFor(ctx, est.id);
      { const c = await buildLinkContext(link.split('/l/')[1]); await signEstimateByLink(c, { valuationInitials: 'RR', signatureName: 'Robin Route', agree: true, ip: null, userAgent: null }); await payDepositByLink(c, { attemptKey: `dep${tag()}` }); }
      return job;
    };
    const first = await booked();
    await bookJob(ctx, first.id);
    const schedule = await scheduleBetween(ctx, moveDay, (await import('@/modules/hhmc/rules')).addDays(moveDay, 1));
    expect(schedule.days[0].entries.find((e) => e.jobId === first.id)?.truckNames).toEqual([truck.name]);

    const second = await booked();
    await expect(bookJob(ctx, second.id)).rejects.toThrow(new RegExp(`${truck.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is already booked`));
  });

  it('trucks picked after the move day exists: the day follows, and booking takes every picked truck', async () => {
    const ctx = await admin();
    const a = await addTruck(ctx, `Test truck ${tag()} · 16'`);
    const b = await addTruck(ctx, `Test truck ${tag()} · 26'`);
    const job = await newCustomerJob(ctx, { moveDate: day(70 + (counter % 20)) });
    await change(ctx, job.id, { truckIds: [a.id, b.id] });
    const days = await withScope(ctx, P.jobsRead, (s) => jobDaysOf(s, job.id));
    expect(days.map((d) => d.trucks)).toEqual([2]);
    const est = await sendEstimate(ctx, job.id);
    { const c = await buildLinkContext((await customerLinkFor(ctx, est.id)).split('/l/')[1]); await signEstimateByLink(c, { valuationInitials: 'RR', signatureName: 'Robin Route', agree: true, ip: null, userAgent: null }); await payDepositByLink(c, { attemptKey: `dep${tag()}` }); }
    await bookJob(ctx, job.id);
    const d = days[0].dayDate;
    const schedule = await scheduleBetween(ctx, d, (await import('@/modules/hhmc/rules')).addDays(d, 1));
    expect(schedule.days[0].entries.find((e) => e.jobId === job.id)?.truckNames.sort()).toEqual([a.name, b.name].sort());
  });

  it('a retired picked truck stops the booking with a clear message', async () => {
    const ctx = await admin();
    const truck = await addTruck(ctx, `Test truck ${tag()} · 22'`);
    const job = await newCustomerJob(ctx, { moveDate: day(95 + (counter % 20)), truckIds: [truck.id] });
    const est = await sendEstimate(ctx, job.id);
    { const c = await buildLinkContext((await customerLinkFor(ctx, est.id)).split('/l/')[1]); await signEstimateByLink(c, { valuationInitials: 'RR', signatureName: 'Robin Route', agree: true, ip: null, userAgent: null }); await payDepositByLink(c, { attemptKey: `dep${tag()}` }); }
    await withScope(ctx, CORE.schedulingWrite, (s) => archiveRecord(s, resourceEntity, truck.id));
    await expect(bookJob(ctx, job.id)).rejects.toThrow(/retired/);
  });
});

describe('mileage once the price is settled', () => {
  beforeEach(() => vi.stubEnv('GOOGLE_MAPS_API_KEY', 'fake-test-key'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('"Look up again" cannot change the miles after the customer signed', async () => {
    const ctx = await admin();
    fakeGoogle([12.4], [25]);
    const job = await newCustomerJob(ctx);
    await refreshMileage(ctx, job.id);
    const est = await sendEstimate(ctx, job.id);
    { const c = await buildLinkContext((await customerLinkFor(ctx, est.id)).split('/l/')[1]); await signEstimateByLink(c, { valuationInitials: 'RR', signatureName: 'Robin Route', agree: true, ip: null, userAgent: null }); await payDepositByLink(c, { attemptKey: `dep${tag()}` }); }
    vi.unstubAllGlobals();
    fakeGoogle([300], [300]);
    await expect(refreshMileage(ctx, job.id, { force: true })).rejects.toThrow(/price is settled/);
    expect((await jobOf(ctx, job.id)).distanceTenths).toBe(124);
  });

  it('at most 8 extra stops', async () => {
    const ctx = await admin();
    await expect(newCustomerJob(ctx, { extraStops: Array.from({ length: 9 }, (_, i) => `${i} Stop St`) })).rejects.toThrow(/At most 8/);
  });
});
