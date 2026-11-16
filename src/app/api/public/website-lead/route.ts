import { NextResponse } from 'next/server';
import { ValidationError } from '@/core/errors';
import { runPublicIntake } from '@/core/intake/intake';

/**
 * The Hired Hands website's quote form posts here and a lead is created (docs/DECISIONS.md, WEB-1).
 *
 * Nobody signs in, so the door is narrow: the business ("hhmc") and the intake are fixed here,
 * the environment comes from WEBSITE_INTAKE_ENVIRONMENT (default "sandbox", so a first test
 * never lands among real leads), and the intake holds only "add a lead".
 *
 *   WEBSITE_INTAKE_ORIGINS      comma-separated site addresses allowed to post, for example
 *                               "https://hiredhands-site.vercel.app,https://hiredhandsmoving.com".
 *                               Not set = this address does not exist (404).
 *   WEBSITE_INTAKE_ENVIRONMENT  "live" or "sandbox" (default).
 *
 * The Origin check stops other websites' pages from posting here. It does not stop a script
 * that sets its own Origin header: the hidden "website" field and the small per-address limit
 * below catch the common bots, and Vercel's firewall rate limit is the real defence.
 */
const BUSINESS = 'hhmc';
const INTAKE = 'hhmc.website-lead';
const MAX_BYTES = 20_000;
const LIMIT = 5; // requests per address per window
const WINDOW_MS = 10 * 60_000;

const hits = new Map<string, number[]>();

function allowedOrigins(): string[] {
  return (process.env.WEBSITE_INTAKE_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function cors(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function tooMany(request: Request, now: number): boolean {
  const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const recent = (hits.get(address) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(address, recent);
    return true;
  }
  recent.push(now);
  hits.set(address, recent);
  // Keep the map small on a long-lived instance.
  if (hits.size > 5000) for (const [key, times] of hits) if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
  return false;
}

/** The browser asks first ("may this page post here?"). */
export async function OPTIONS(request: Request) {
  const origin = (request.headers.get('origin') ?? '').replace(/\/$/, '');
  if (!origin || !allowedOrigins().includes(origin)) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(null, { status: 204, headers: cors(origin) });
}

export async function POST(request: Request) {
  const origins = allowedOrigins();
  if (origins.length === 0) return new NextResponse('Not found', { status: 404 });
  const origin = (request.headers.get('origin') ?? '').replace(/\/$/, '');
  if (!origins.includes(origin)) return new NextResponse('Not found', { status: 404 });
  const headers = cors(origin);
  const reply = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers });

  if (tooMany(request, Date.now()))
    return reply({ ok: false, error: 'Too many requests. Please try again in a few minutes or call us.' }, 429);

  const raw = await request.text();
  if (raw.length > MAX_BYTES) return reply({ ok: false, error: 'That request is too large.' }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply({ ok: false, error: 'That request could not be read.' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    return reply({ ok: false, error: 'That request could not be read.' }, 400);

  // The form has a hidden "website" field no person fills in. A bot that does gets a normal
  // "ok" and nothing is created.
  const trap = (body as Record<string, unknown>).website;
  if (typeof trap === 'string' && trap.trim() !== '') return reply({ ok: true }, 200);

  try {
    await runPublicIntake({
      businessSlug: BUSINESS,
      environment: process.env.WEBSITE_INTAKE_ENVIRONMENT === 'live' ? 'live' : 'sandbox',
      key: INTAKE,
      body,
    });
    return reply({ ok: true }, 200);
  } catch (error) {
    // A ValidationError message is written to be shown to the person.
    if (error instanceof ValidationError) return reply({ ok: false, error: error.message }, 400);
    console.error('Website lead failed:', error);
    return reply({ ok: false, error: 'Something went wrong on our side. Please call us.' }, 500);
  }
}
