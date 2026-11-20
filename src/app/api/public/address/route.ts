import { NextResponse } from 'next/server';
import { allowedOrigins, corsHeaders, originOf, rateLimiter } from '@/core/http/public-door';
import { addressFor, suggestAddresses } from '@/core/places/places';

/**
 * Address suggestions while typing (core/places/places.ts):
 *
 *   GET ?q=23 Main St Tru&s=<session>   → { suggestions: [{ id, text }] }
 *   GET ?id=<suggestion id>&s=<session> → { address: { full, line1, city, state, zip } | null }
 *
 * Callers: the console's own pages (the browser marks them Sec-Fetch-Site: same-origin) and the
 * websites in WEBSITE_INTAKE_ORIGINS. Anyone else gets 404. Google's key stays on the server;
 * a per-address limit here and Google's daily caps bound the cost.
 */
const LIMIT = 120; // requests per address per window: about 20 addresses typed
const WINDOW_MS = 10 * 60_000;
const tooMany = rateLimiter(LIMIT, WINDOW_MS);

/** The CORS headers for a website caller, {} for the console itself, null = not allowed. */
function callerHeaders(request: Request): Record<string, string> | null {
  const origin = originOf(request);
  if (origin && allowedOrigins().includes(origin)) return corsHeaders(origin, 'GET, OPTIONS');
  if (request.headers.get('sec-fetch-site') === 'same-origin') return {};
  return null;
}

export async function OPTIONS(request: Request) {
  const headers = callerHeaders(request);
  if (!headers || !headers['Access-Control-Allow-Origin']) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(null, { status: 204, headers });
}

export async function GET(request: Request) {
  const headers = callerHeaders(request);
  if (!headers) return new NextResponse('Not found', { status: 404 });
  const reply = (body: Record<string, unknown>, status = 200) =>
    NextResponse.json(body, { status, headers: { ...headers, 'Cache-Control': 'no-store' } });
  if (tooMany(request)) return reply({ error: 'Too many lookups. Type the address in full.' }, 429);

  const params = new URL(request.url).searchParams;
  const session = params.get('s') ?? '';
  const id = params.get('id');
  try {
    if (id !== null) return reply({ address: await addressFor(id, session) });
    return reply({ suggestions: await suggestAddresses(params.get('q') ?? '', session) });
  } catch (error) {
    console.error('Address lookup failed:', error instanceof Error ? error.name : 'error');
    return reply({ suggestions: [], address: null });
  }
}
