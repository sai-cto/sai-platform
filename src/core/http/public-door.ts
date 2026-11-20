/**
 * Shared pieces of the addresses under /api/public/ that nobody signs in to: which websites may
 * call them (WEBSITE_INTAKE_ORIGINS), the CORS answer for those sites, and a small per-address
 * rate limit. The limit lives in memory on each server, so it catches a busy bot, not a
 * determined one; the real caps sit with whatever is being protected (e.g. Google's daily quota).
 */

/** The site addresses allowed to call, e.g. "https://www.example.com". */
export function allowedOrigins(): string[] {
  return (process.env.WEBSITE_INTAKE_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function originOf(request: Request): string {
  return (request.headers.get('origin') ?? '').replace(/\/$/, '');
}

export function corsHeaders(origin: string, methods: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function clientAddress(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/** At most `limit` requests per caller address in each `windowMs`; true = refuse this one. */
export function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return function tooMany(request: Request, now = Date.now()): boolean {
    const address = clientAddress(request);
    const recent = (hits.get(address) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(address, recent);
      return true;
    }
    hits.set(address, [...recent, now]);
    // Keep the map small on a long-lived server.
    if (hits.size > 5000) for (const [key, times] of hits) if (times.every((t) => now - t >= windowMs)) hits.delete(key);
    return false;
  };
}
