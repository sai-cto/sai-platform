/**
 * Address suggestions while typing (core/places/places.ts, /api/public/address). Google is never
 * called: fetch is replaced by a fake that answers like the Places API (New).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, OPTIONS } from '@/app/api/public/address/route';
import { rateLimiter } from '@/core/http/public-door';
import { addressFor, cleanQuery, suggestAddresses } from '@/core/places/places';

const SESSION = 'test-session-0001';
const SITE = 'https://hiredhands.example.com';

/** A fake Places API: autocomplete answers `suggestions`, place details answer `components`. */
function fakePlaces(components: { types: string[]; shortText: string }[] = []) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith(':autocomplete'))
        return new Response(
          JSON.stringify({
            suggestions: [
              { placePrediction: { placeId: 'ChIJVWaobOePplace1', text: { text: '23 West Main Street, Trumansburg, NY, USA' } } },
              { placePrediction: { placeId: 'ChIJRVXt3place2', text: { text: '23 East Main Street, Trumansburg, NY, USA' } } },
              { queryPrediction: { text: { text: 'not an address' } } },
            ],
          }),
          { status: 200 },
        );
      return new Response(JSON.stringify({ addressComponents: components }), { status: 200 });
    }),
  );
  return calls;
}

const W_MAIN = [
  { types: ['street_number'], shortText: '23' },
  { types: ['route'], shortText: 'W Main St' },
  { types: ['locality', 'political'], shortText: 'Trumansburg' },
  { types: ['administrative_area_level_1', 'political'], shortText: 'NY' },
  { types: ['country', 'political'], shortText: 'US' },
  { types: ['postal_code'], shortText: '14886' },
];

describe('address suggestions (Google Places, faked)', () => {
  beforeEach(() => vi.stubEnv('GOOGLE_MAPS_API_KEY', 'fake-test-key'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('suggests US addresses near Ithaca, without ", USA", from the server key', async () => {
    const calls = fakePlaces();
    const found = await suggestAddresses('  23 Main  St Tru ', SESSION);
    expect(found).toEqual([
      { id: 'ChIJVWaobOePplace1', text: '23 West Main Street, Trumansburg, NY' },
      { id: 'ChIJRVXt3place2', text: '23 East Main Street, Trumansburg, NY' },
    ]);
    const sent = JSON.parse(String(calls[0].init?.body));
    expect(sent).toMatchObject({ input: '23 Main St Tru', sessionToken: SESSION, includedRegionCodes: ['us'] });
    expect(sent.locationBias.circle.center).toEqual({ latitude: 42.444, longitude: -76.5019 });
    expect((calls[0].init?.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('fake-test-key');
  });

  it('a picked suggestion becomes a full postal address with its ZIP', async () => {
    const calls = fakePlaces(W_MAIN);
    expect(await addressFor('ChIJVWaobOePplace1', SESSION)).toEqual({
      full: '23 W Main St, Trumansburg, NY 14886',
      line1: '23 W Main St',
      city: 'Trumansburg',
      state: 'NY',
      zip: '14886',
    });
    expect(calls[0].url).toBe(`https://places.googleapis.com/v1/places/ChIJVWaobOePplace1?sessionToken=${SESSION}`);
  });

  it('an apartment keeps its number; a place without a street is not an address', async () => {
    fakePlaces([...W_MAIN, { types: ['subpremise'], shortText: '2B' }]);
    expect((await addressFor('ChIJVWaobOePplace1', SESSION))?.full).toBe('23 W Main St #2B, Trumansburg, NY 14886');
    fakePlaces(W_MAIN.filter((p) => p.types[0] !== 'street_number' && p.types[0] !== 'route'));
    expect(await addressFor('ChIJVWaobOePplace1', SESSION)).toBeNull();
  });

  it('Google is not called for short or odd input, or without a key', async () => {
    const calls = fakePlaces();
    expect(cleanQuery('23 ')).toBeNull();
    expect(await suggestAddresses('23', SESSION)).toEqual([]);
    expect(await suggestAddresses('23 Main St', 'bad session!')).toEqual([]);
    expect(await addressFor('../../secrets', SESSION)).toBeNull();
    expect(await suggestAddresses('x'.repeat(151), SESSION)).toEqual([]);
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
    expect(await suggestAddresses('23 Main St', SESSION)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('a Google failure or a reached daily cap shows no suggestions, never an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"code":429}}', { status: 429 })));
    expect(await suggestAddresses('23 Main St', SESSION)).toEqual([]);
    expect(await addressFor('ChIJVWaobOePplace1', SESSION)).toBeNull();
  });
});

describe('/api/public/address', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'fake-test-key');
    vi.stubEnv('WEBSITE_INTAKE_ORIGINS', SITE);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const ask = (query: string, headers: Record<string, string>) =>
    new Request(`https://console.example.com/api/public/address?${query}`, { headers: { 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}`, ...headers } });

  it('the website gets suggestions with its CORS header; the console itself without', async () => {
    fakePlaces(W_MAIN);
    const site = await GET(ask(`q=23+Main+St&s=${SESSION}`, { origin: SITE }));
    expect(site.status).toBe(200);
    expect(site.headers.get('access-control-allow-origin')).toBe(SITE);
    expect((await site.json()).suggestions).toHaveLength(2);
    const own = await GET(ask(`id=ChIJVWaobOePplace1&s=${SESSION}`, { 'sec-fetch-site': 'same-origin' }));
    expect(own.headers.get('access-control-allow-origin')).toBeNull();
    expect((await own.json()).address.zip).toBe('14886');
    expect((await OPTIONS(ask('', { origin: SITE }))).status).toBe(204);
  });

  it('any other site, or a script with no origin, gets "not found" and Google is not called', async () => {
    const calls = fakePlaces();
    expect((await GET(ask(`q=23+Main+St&s=${SESSION}`, { origin: 'https://other.example.com' }))).status).toBe(404);
    expect((await GET(ask(`q=23+Main+St&s=${SESSION}`, {}))).status).toBe(404);
    expect((await GET(ask(`q=23+Main+St&s=${SESSION}`, { 'sec-fetch-site': 'cross-site' }))).status).toBe(404);
    expect((await OPTIONS(ask('', { 'sec-fetch-site': 'same-origin' }))).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('one caller address is limited; others are not', () => {
    const tooMany = rateLimiter(2, 60_000);
    const from = (ip: string) => new Request('https://x.example.com', { headers: { 'x-forwarded-for': ip } });
    expect([tooMany(from('1.1.1.1'), 0), tooMany(from('1.1.1.1'), 1), tooMany(from('1.1.1.1'), 2)]).toEqual([false, false, true]);
    expect(tooMany(from('2.2.2.2'), 3)).toBe(false);
    expect(tooMany(from('1.1.1.1'), 60_001)).toBe(false);
  });
});
