/**
 * Maps adapter: road distance and drive time for a move (managers: "Built-in Google Maps ...
 * automatic mileage"; Nov 2026 follow-up: "Work request should immediately see Google Maps
 * (distance, number of miles)" and "automatically estimates mileage").
 *
 * - Mileage: the Google Distance Matrix API when GOOGLE_MAPS_API_KEY is set in .env.local (never
 *   committed); otherwise "not_configured" and staff type the miles in. The route is every stop
 *   in order (pick-up → extra stops → drop-off), each leg summed, in ONE request.
 * - When it runs: when a work request is created or its addresses change, and when staff press
 *   "Look up mileage" (DECISIONS P5D-1). Never in the background, never on a page view.
 * - The map on the work request: a plain Google Maps directions link (no key, opened by staff),
 *   and an embedded map only when GOOGLE_MAPS_EMBED_KEY is set (a separate, browser-restricted
 *   key: it is visible in the page).
 */

export type Route = { distanceTenths: number; driveMinutes: number };

export function mapsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

/** The stops of a move in driving order; blank addresses are skipped. */
export function routeStops(job: { originAddress: string | null; extraStops: string[]; destinationAddress: string | null }): string[] {
  return [job.originAddress, ...job.extraStops, job.destinationAddress].map((a) => (a ?? '').trim()).filter(Boolean);
}

/** Road distance and drive time through every stop, in order (at most 10 stops). */
export async function routeThrough(stops: string[]): Promise<Route | null | 'not_configured'> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return 'not_configured';
  if (stops.length < 2 || stops.length > 10) return null;
  // One request: origins = every stop but the last, destinations = every stop but the first.
  // Leg i is row i, element i (the diagonal).
  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
  url.searchParams.set('origins', stops.slice(0, -1).join('|'));
  url.searchParams.set('destinations', stops.slice(1).join('|'));
  url.searchParams.set('units', 'imperial');
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('key', key);
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    status?: string;
    rows?: { elements?: { status?: string; distance?: { value: number }; duration?: { value: number } }[] }[];
  } | null;
  if (body?.status !== 'OK') return null;
  let metres = 0;
  let seconds = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const leg = body.rows?.[i]?.elements?.[i];
    if (leg?.status !== 'OK' || !leg.distance || !leg.duration) return null;
    metres += leg.distance.value;
    seconds += leg.duration.value;
  }
  // metres → tenths of a mile; seconds → minutes (rounded up).
  return { distanceTenths: Math.round(metres / 160.9344), driveMinutes: Math.ceil(seconds / 60) };
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
