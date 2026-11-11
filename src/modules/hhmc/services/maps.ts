/**
 * Maps adapter: road distance and drive time between two addresses (managers: "Built-in Google
 * Maps ... automatic mileage"). Uses the Google Distance Matrix API when GOOGLE_MAPS_API_KEY is
 * set in .env.local (never committed); otherwise reports "not_configured" and the screens offer
 * manual entry, marked NEEDS JAI REVIEW.
 *
 * Addresses are sent to Google only when staff press "Look up mileage" (no background calls).
 */

export type Route = { distanceTenths: number; driveMinutes: number };

export function mapsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

export async function routeBetween(origin: string, destination: string): Promise<Route | null | 'not_configured'> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return 'not_configured';
  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
  url.searchParams.set('origins', origin);
  url.searchParams.set('destinations', destination);
  url.searchParams.set('units', 'imperial');
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('key', key);
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    status?: string;
    rows?: { elements?: { status?: string; distance?: { value: number }; duration?: { value: number } }[] }[];
  } | null;
  const element = body?.rows?.[0]?.elements?.[0];
  if (body?.status !== 'OK' || element?.status !== 'OK' || !element.distance || !element.duration) return null;
  // metres → tenths of a mile; seconds → minutes (rounded up).
  return {
    distanceTenths: Math.round(element.distance.value / 160.9344),
    driveMinutes: Math.ceil(element.duration.value / 60),
  };
}
