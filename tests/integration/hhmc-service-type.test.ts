/**
 * Local / Intrastate / Interstate from the move's addresses and route (managers' feedback
 * round 1, Nov 2026). New York → New York City through New Jersey is Interstate.
 *
 * Google is never called: fetch is replaced by a fake Routes + Geocoding API. Fake data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { withScope } from '@/core/db/scope';
import type { BusinessContext } from '@/core/tenancy/context';
import { P } from '@/modules/hhmc/permissions';
import { hhmcNotes } from '@/modules/hhmc/schema';
import { refreshMileage } from '@/modules/hhmc/services/builder';
import { loadJob } from '@/modules/hhmc/services/common';
import { updateJob } from '@/modules/hhmc/services/jobs';
import { convertLead, createLead } from '@/modules/hhmc/services/leads';
import { routeThrough } from '@/modules/hhmc/services/maps';
import { DEFAULT_JOB_TYPE, decideServiceType, jobTypeFor } from '@/modules/hhmc/services/service-type';
import { stateCode, stateOfAddress } from '@/modules/hhmc/services/us-states';
import { gm, tag } from './hhmc-helpers';

const UPSTATE = '1 Test St, Ithaca, NY 14850';
const CITY = '2 Test Ave, New York, NY 10001';

/** Google's polyline encoding (the published algorithm), to build a fake route line. */
function encodePolyline(points: [number, number][]): string {
  let out = '';
  let prev: [number, number] = [0, 0];
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const [lat, lng] of points) {
    const p: [number, number] = [Math.round(lat * 1e5), Math.round(lng * 1e5)];
    out += enc(p[0] - prev[0]) + enc(p[1] - prev[1]);
    prev = p;
  }
  return out;
}

/**
 * A fake Google: the route goes from upstate New York down through New Jersey (latitudes under
 * 41.3 are "New Jersey") into New York City (latitude 40.75 and east of -74.03 is "New York").
 */
function fakeGoogleThroughNewJersey(options: { instructions?: string[]; geocode?: boolean } = {}) {
  const calls: string[] = [];
  const line: [number, number][] = [[42.44, -76.5], [41.8, -75.0], [41.0, -74.4], [40.85, -74.1], [40.75, -73.99]];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://routes.googleapis.com/')) {
        return new Response(
          JSON.stringify({
            routes: [
              {
                distanceMeters: Math.round(225 * 1609.344),
                duration: `${240 * 60}s`,
                polyline: { encodedPolyline: encodePolyline(line) },
                legs: [{ steps: (options.instructions ?? []).map((instructions) => ({ navigationInstruction: { instructions } })) }],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (options.geocode === false) return new Response('{}', { status: 500 });
      const [lat, lng] = (new URL(url).searchParams.get('latlng') ?? '0,0').split(',').map(Number);
      const state = lat < 41.3 && lng < -74.03 ? 'NJ' : 'NY';
      return new Response(JSON.stringify({ status: 'OK', results: [{ address_components: [{ short_name: state, types: ['administrative_area_level_1'] }, { short_name: 'US', types: ['country'] }] }] }), { status: 200 });
    }),
  );
  return calls;
}

async function jobAt(ctx: BusinessContext, originAddress: string, destinationAddress: string) {
  const t = tag();
  const lead = await createLead(ctx, { firstName: 'Sam', lastName: `State${t}`, email: `sam.${t}@example.com`, source: 'Google', originAddress, destinationAddress });
  const { job } = await convertLead(ctx, lead.id, {});
  return job;
}

const reload = (ctx: BusinessContext, id: string) => withScope(ctx, P.jobsRead, (s) => loadJob(s, id));

describe('which state an address is in', () => {
  it('reads a state code, a state name, NYC and the ZIP code', () => {
    expect(stateOfAddress(UPSTATE)).toBe('NY');
    expect(stateOfAddress('10 Grove St, Newark, New Jersey')).toBe('NJ');
    expect(stateOfAddress('Times Square, NYC')).toBe('NY');
    expect(stateOfAddress('500 River Rd 07030')).toBe('NJ');
    expect(stateOfAddress('12 Penn Ave, Scranton, PA 18503, USA')).toBe('PA');
    expect(stateCode('new jersey')).toBe('NJ');
  });

  it('never takes a street name for a state, and says so when it cannot tell', () => {
    expect(stateOfAddress('12 Virginia Rd, Ithaca, NY')).toBe('NY');
    expect(stateOfAddress('Somewhere nice')).toBeNull();
    expect(stateOfAddress('')).toBeNull();
  });
});

describe('the rule', () => {
  const local = 150;
  it('more than one state is Interstate, by the addresses alone', () => {
    const d = decideServiceType({ stops: [UPSTATE, '9 Shore Rd, Hoboken, NJ 07030'], routeStates: null, distanceTenths: null, localMaxMiles: local });
    expect(d).toMatchObject({ serviceType: 'interstate', states: ['NJ', 'NY'], routeChecked: false });
  });

  it('a route through another state is Interstate even when both ends are in New York', () => {
    const d = decideServiceType({ stops: [UPSTATE, CITY], routeStates: ['NJ', 'NY'], distanceTenths: 2250, localMaxMiles: local });
    expect(d.serviceType).toBe('interstate');
    expect(d.reason).toMatch(/passes through NJ/);
  });

  it('one state: Local up to the setting, Intrastate beyond it', () => {
    expect(decideServiceType({ stops: [UPSTATE, '5 Main St, Ithaca, NY 14850'], routeStates: ['NY'], distanceTenths: 80, localMaxMiles: local }).serviceType).toBe('local');
    expect(decideServiceType({ stops: [UPSTATE, CITY], routeStates: ['NY'], distanceTenths: 2250, localMaxMiles: local }).serviceType).toBe('intrastate');
    expect(decideServiceType({ stops: [UPSTATE, CITY], routeStates: ['NY'], distanceTenths: 1500, localMaxMiles: local }).serviceType).toBe('local');
  });

  it('an address with no clear state decides nothing', () => {
    expect(decideServiceType({ stops: [UPSTATE, 'the old barn'], routeStates: null, distanceTenths: null, localMaxMiles: local }).serviceType).toBeNull();
  });

  it('the job type always belongs to the service type (never "-")', () => {
    expect(jobTypeFor('interstate', 'Local Full Service Move')).toBe(DEFAULT_JOB_TYPE.interstate);
    expect(jobTypeFor('local', '')).toBe(DEFAULT_JOB_TYPE.local);
    expect(jobTypeFor('local', 'Local Full Service Move')).toBe('Local Full Service Move');
  });
});

describe('on a work request', () => {
  beforeEach(() => vi.stubEnv('GOOGLE_MAPS_API_KEY', 'fake-test-key'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('the route is checked on Google Maps: Ithaca → New York City through New Jersey is Interstate', async () => {
    const ctx = await gm();
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
    const job = await jobAt(ctx, UPSTATE, CITY);
    expect(job).toMatchObject({ serviceType: 'local', serviceTypeSource: 'auto', routeChecked: false });
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'fake-test-key');
    fakeGoogleThroughNewJersey();
    expect(await refreshMileage(ctx, job.id)).toMatchObject({ status: 'updated' });
    const after = await reload(ctx, job.id);
    expect(after).toMatchObject({ serviceType: 'interstate', jobType: DEFAULT_JOB_TYPE.interstate, routeChecked: true, distanceTenths: 2250 });
    expect(after.routeStates).toEqual(['NJ', 'NY']);
  });

  it('"Entering New Jersey" in the directions is enough when the map points cannot be looked up', async () => {
    fakeGoogleThroughNewJersey({ instructions: ['Head south', 'Entering New Jersey', 'Entering New York'], geocode: false });
    const route = await routeThrough([UPSTATE, CITY]);
    expect(route).toMatchObject({ states: ['NJ', 'NY'] });
  });

  it('without a maps key the addresses decide and the route is "not checked"', async () => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
    const ctx = await gm();
    const across = await jobAt(ctx, UPSTATE, '12 Penn Ave, Scranton, PA 18503');
    expect(across).toMatchObject({ serviceType: 'interstate', jobType: DEFAULT_JOB_TYPE.interstate, routeChecked: false });
    const within = await jobAt(ctx, UPSTATE, CITY);
    expect(within).toMatchObject({ serviceType: 'local', routeChecked: false });
    expect(within.jobType).not.toBe('');
  });

  it('a manager can override it, and every override is logged on the work request', async () => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
    const ctx = await gm();
    const job = await jobAt(ctx, UPSTATE, '12 Penn Ave, Scranton, PA 18503');
    await updateJob(ctx, job.id, { ...job, serviceType: 'local', jobType: '' });
    const after = await reload(ctx, job.id);
    expect(after).toMatchObject({ serviceType: 'local', serviceTypeSource: 'manual', suggestedServiceType: 'interstate', jobType: DEFAULT_JOB_TYPE.local });
    const notes = await withScope(ctx, P.jobsRead, (s) => s.db.select().from(hhmcNotes).where(and(s.where(hhmcNotes), eq(hhmcNotes.jobId, job.id))));
    expect(notes.map((n) => n.body).join('\n')).toMatch(/Service type overridden from Interstate to Local/);
    // Back to automatic: the addresses decide again.
    await updateJob(ctx, job.id, { ...after, serviceType: 'auto', jobType: '' });
    expect(await reload(ctx, job.id)).toMatchObject({ serviceType: 'interstate', serviceTypeSource: 'auto' });
  });
});
