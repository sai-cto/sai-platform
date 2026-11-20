/**
 * Address suggestions while someone types an address (asked for in Nov 2026: "a few
 * addresses pop up underneath; you just click one"). Any business's address box can use it
 * (ui/address-input.tsx); so can the websites, through /api/public/address.
 *
 * Google Places API (New), called from the server with GOOGLE_MAPS_API_KEY (the key never reaches
 * a browser). One typing "session" (a random token from the page) groups the suggestions with
 * the one address picked, which Google bills as one session. Daily caps on the Google project
 * keep it inside the free allowance; when a cap is reached the box simply shows no suggestions.
 */

export type AddressSuggestion = { id: string; text: string };
export type PickedAddress = { full: string; line1: string; city: string; state: string; zip: string };

/** Suggestions start after this many characters. */
export const MIN_QUERY = 4;
const MAX_QUERY = 150;
const MAX_SUGGESTIONS = 5;
/** The businesses are in Ithaca: suggestions near it come first (not a limit; any US address works). */
const ITHACA = { latitude: 42.444, longitude: -76.5019 };
const BIAS_METRES = 50_000;

const SESSION = /^[A-Za-z0-9_-]{8,64}$/;
const PLACE_ID = /^[A-Za-z0-9_-]{10,400}$/;

export function validSession(session: string): boolean {
  return SESSION.test(session);
}

export function validPlaceId(id: string): boolean {
  return PLACE_ID.test(id);
}

/** The cleaned query, or null when it is too short or too long to look up. */
export function cleanQuery(query: string): string | null {
  const q = query.replace(/\s+/g, ' ').trim();
  return q.length >= MIN_QUERY && q.length <= MAX_QUERY ? q : null;
}

async function google<T>(url: string, init: RequestInit & { fieldMask: string }): Promise<T | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const { fieldMask, headers, ...rest } = init;
  const response = await fetch(url, {
    ...rest,
    headers: { ...headers, 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!response?.ok) return null;
  return (await response.json().catch(() => null)) as T | null;
}

type AutocompleteBody = { suggestions?: { placePrediction?: { placeId?: string; text?: { text?: string } } }[] };

/** Up to five US addresses matching what was typed, nearest Ithaca first. Empty when Google is
 *  not set up, the daily cap is reached, or nothing matches. */
export async function suggestAddresses(query: string, session: string): Promise<AddressSuggestion[]> {
  const input = cleanQuery(query);
  if (!input || !validSession(session)) return [];
  const body = await google<AutocompleteBody>('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    fieldMask: 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text',
    body: JSON.stringify({
      input,
      sessionToken: session,
      includedRegionCodes: ['us'],
      locationBias: { circle: { center: ITHACA, radius: BIAS_METRES } },
    }),
  });
  return (body?.suggestions ?? [])
    .map((s) => ({ id: s.placePrediction?.placeId ?? '', text: (s.placePrediction?.text?.text ?? '').replace(/, USA$/, '') }))
    .filter((s) => validPlaceId(s.id) && s.text)
    .slice(0, MAX_SUGGESTIONS);
}

type DetailsBody = { addressComponents?: { types?: string[]; shortText?: string; longText?: string }[] };

/** The picked suggestion as a full postal address ("23 W Main St, Trumansburg, NY 14886"), with
 *  its parts for forms that ask for the ZIP separately. Null when it cannot be looked up. */
export async function addressFor(id: string, session: string): Promise<PickedAddress | null> {
  if (!validPlaceId(id) || !validSession(session)) return null;
  const body = await google<DetailsBody>(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?sessionToken=${encodeURIComponent(session)}`, {
    method: 'GET',
    fieldMask: 'addressComponents',
  });
  const parts = body?.addressComponents ?? [];
  const part = (type: string) => parts.find((p) => p.types?.includes(type))?.shortText?.trim() ?? '';
  const street = [part('street_number'), part('route')].filter(Boolean).join(' ');
  const unit = part('subpremise');
  const line1 = [street, unit && `#${unit}`].filter(Boolean).join(' ');
  const city = part('locality') || part('postal_town') || part('sublocality') || part('administrative_area_level_3');
  const state = part('administrative_area_level_1');
  const zip = part('postal_code');
  if (!line1 || !city || !state) return null;
  return { full: `${line1}, ${city}, ${state}${zip ? ` ${zip}` : ''}`, line1, city, state, zip };
}
