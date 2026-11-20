/**
 * Maps adapter: road distance and drive time for a move (managers: "Built-in Google Maps ...
 * automatic mileage"; Nov 2026 follow-up: "Work request should immediately see Google Maps
 * (distance, number of miles)" and "automatically estimates mileage").
 *
 * - Mileage: the Google Routes API when GOOGLE_MAPS_API_KEY is set in .env.local (never
 *   committed); otherwise "not_configured" and staff type the miles in. The route is every stop
 *   in order (pick-up → extra stops → drop-off), in ONE request.
 * - When it runs: when a work request is created or its addresses change, and when staff press
 *   "Look up mileage" (DECISIONS P5D-1). Never in the background, never on a page view.
 * - The map on the work request: a plain Google Maps directions link (no key, opened by staff),
 *   and an embedded map only when GOOGLE_MAPS_EMBED_KEY is set (a separate, browser-restricted
 *   key: it is visible in the page).
 */

import { stateCode } from './us-states';

/** `states`: the US states the route passes through (two-letter codes), or null when they could
 *  not be checked (the route was found but the state lookup failed). */
export type Route = { distanceTenths: number; driveMinutes: number; states?: string[] | null };

/** Stops Google could not match exactly. Google then guesses (a "partial match": e.g. the same
 *  street name in another town) and routes to the guess, so its miles would price the wrong move. */
export type Unmatched = { unmatched: string[] };

/** At most this many points along the route are looked up for their state (Geocoding API). */
export const ROUTE_STATE_SAMPLES = 25;

export function mapsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

/** The stops of a move in driving order; blank addresses are skipped. */
export function routeStops(job: { originAddress: string | null; extraStops: string[]; destinationAddress: string | null }): string[] {
  return [job.originAddress, ...job.extraStops, job.destinationAddress].map((a) => (a ?? '').trim()).filter(Boolean);
}

/** Road distance and drive time through every stop, in order (at most 10 stops).
 *  Google Routes API "computeRoutes": one route through the stops, billed once. (The older
 *  Distance Matrix API is "Legacy" since March 2025 and cannot be enabled in new projects.) */
export async function routeThrough(stops: string[]): Promise<Route | Unmatched | null | 'not_configured'> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return 'not_configured';
  if (stops.length < 2 || stops.length > 10) return null;
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      // Only what we use (Google bills by the fields asked for): the two numbers, and the line of
      // the route and its turn-by-turn text to find the states it passes through, and how well
      // each address was matched.
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.steps.navigationInstruction.instructions,geocodingResults',
    },
    body: JSON.stringify({
      origin: { address: stops[0] },
      destination: { address: stops[stops.length - 1] },
      intermediates: stops.slice(1, -1).map((address) => ({ address })),
      travelMode: 'DRIVE',
      units: 'IMPERIAL',
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as RoutesBody | null;
  const unmatched = unmatchedStops(stops, body?.geocodingResults);
  if (unmatched.length) return { unmatched };
  const route = body?.routes?.[0];
  const seconds = route?.duration ? Number(/^(\d+(?:\.\d+)?)s$/.exec(route.duration)?.[1]) : NaN;
  if (!route || typeof route.distanceMeters !== 'number' || !Number.isFinite(seconds)) return null;
  const instructions = (route.legs ?? []).flatMap((l) => l.steps ?? []).map((st) => st.navigationInstruction?.instructions ?? '');
  const states = await statesAlong(key, route.polyline?.encodedPolyline ?? null, instructions);
  // metres → tenths of a mile; seconds → minutes (rounded up).
  return { distanceTenths: Math.round(route.distanceMeters / 160.9344), driveMinutes: Math.ceil(seconds / 60), states };
}

type Geocoded = { partialMatch?: boolean; geocoderStatus?: { code?: number } };
type RoutesBody = {
  geocodingResults?: { origin?: Geocoded; destination?: Geocoded; intermediates?: (Geocoded & { intermediateWaypointRequestIndex?: number })[] };
  routes?: {
    distanceMeters?: number;
    duration?: string;
    polyline?: { encodedPolyline?: string };
    legs?: { steps?: { navigationInstruction?: { instructions?: string } }[] }[];
  }[];
};

/** The stops Google only partly matched or could not find, in driving order. */
function unmatchedStops(stops: string[], results: RoutesBody['geocodingResults']): string[] {
  if (!results) return [];
  const bad = (g: Geocoded | undefined) => Boolean(g && (g.partialMatch || (g.geocoderStatus?.code ?? 0) !== 0));
  return stops.filter((_, i) => {
    if (i === 0) return bad(results.origin);
    if (i === stops.length - 1) return bad(results.destination);
    return bad(results.intermediates?.find((g) => (g.intermediateWaypointRequestIndex ?? 0) === i - 1));
  });
}

/** Google's encoded polyline → [lat, lng] points (the published algorithm). */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/** Up to `count` points spread evenly along the line (by distance), ends included. */
export function samplePoints(points: [number, number][], count: number): [number, number][] {
  if (points.length <= count) return points;
  const km = (a: [number, number], b: [number, number]) => {
    const rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad;
    const dLng = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };
  const along = [0];
  for (let i = 1; i < points.length; i++) along.push(along[i - 1] + km(points[i - 1], points[i]));
  const total = along[along.length - 1];
  const out: [number, number][] = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = (total * k) / (count - 1);
    while (j < points.length - 1 && along[j] < target) j++;
    out.push(points[j]);
  }
  return out;
}

/**
 * The states a route passes through: "Entering New Jersey" in Google's directions, plus the
 * state of points sampled along the route (Geocoding API, same key). Null when nothing could
 * be looked up, so the work request says "route not checked" instead of guessing.
 */
async function statesAlong(key: string, polyline: string | null, instructions: string[]): Promise<string[] | null> {
  const found = new Set<string>();
  for (const text of instructions) {
    for (const m of text.matchAll(/Entering ([A-Z][A-Za-z.]*(?: [A-Z][A-Za-z.]*)*)/g)) {
      const code = stateCode(m[1]);
      if (code) found.add(code);
    }
  }
  if (!polyline) return found.size ? [...found].sort() : null;
  const samples = samplePoints(decodePolyline(polyline), ROUTE_STATE_SAMPLES);
  const looked = await Promise.all(samples.map(([lat, lng]) => stateAt(key, lat, lng)));
  if (looked.every((s) => s === undefined)) return found.size ? [...found].sort() : null;
  for (const s of looked) if (s) found.add(s);
  return [...found].sort();
}

/** The US state at a point; null outside the US; undefined when the lookup failed. */
async function stateAt(key: string, lat: number, lng: number): Promise<string | null | undefined> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('latlng', `${lat},${lng}`);
  url.searchParams.set('result_type', 'administrative_area_level_1');
  url.searchParams.set('key', key);
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!response?.ok) return undefined;
  const body = (await response.json().catch(() => null)) as {
    status?: string;
    results?: { address_components?: { short_name?: string; types?: string[] }[] }[];
  } | null;
  if (!body || (body.status !== 'OK' && body.status !== 'ZERO_RESULTS')) return undefined;
  const parts = body.results?.[0]?.address_components ?? [];
  const country = parts.find((p) => p.types?.includes('country'))?.short_name;
  const state = parts.find((p) => p.types?.includes('administrative_area_level_1'))?.short_name;
  return country === 'US' && state ? stateCode(state) : null;
}

/** A Google Maps directions link for the route. Needs no key; Google sees the addresses only
 *  when someone opens it. Null when there are fewer than two stops. */
export function directionsLink(stops: string[]): string | null {
  if (stops.length < 2) return null;
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('origin', stops[0]);
  url.searchParams.set('destination', stops[stops.length - 1]);
  if (stops.length > 2) url.searchParams.set('waypoints', stops.slice(1, -1).join('|'));
  url.searchParams.set('travelmode', 'driving');
  return url.toString();
}

/** The embedded route map (Maps Embed API), only when GOOGLE_MAPS_EMBED_KEY is set. */
export function embedMapUrl(stops: string[]): string | null {
  const key = process.env.GOOGLE_MAPS_EMBED_KEY;
  if (!key || stops.length < 2) return null;
  const url = new URL('https://www.google.com/maps/embed/v1/directions');
  url.searchParams.set('key', key);
  url.searchParams.set('origin', stops[0]);
  url.searchParams.set('destination', stops[stops.length - 1]);
  if (stops.length > 2) url.searchParams.set('waypoints', stops.slice(1, -1).join('|'));
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('units', 'imperial');
  return url.toString();
}

/** "283.4 mi · 4 h 52 min" */
export function formatRoute(distanceTenths: number | null, driveMinutes: number | null): string | null {
  if (distanceTenths === null) return null;
  const miles = `${(distanceTenths / 10).toFixed(1)} mi`;
  if (driveMinutes === null) return miles;
  const h = Math.floor(driveMinutes / 60);
  const m = driveMinutes % 60;
  return `${miles} · ${h ? `${h} h ` : ''}${m} min`;
}
