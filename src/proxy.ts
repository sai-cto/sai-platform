/**
 * Runs before every request. Its one job: on the hosted demo site, the shared access password
 * (DEMO_ACCESS_PASSWORD) is required before anything else — pages, customer links, sign-in.
 * Off everywhere else (local development, tests): accessGateEnabled() is false there.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE, accessCookieValid, accessGateEnabled, bypassesAccessGate } from '@/core/demo/demo';

export function proxy(request: NextRequest) {
  if (!accessGateEnabled() || bypassesAccessGate(request.nextUrl.pathname)) return NextResponse.next();
  if (accessCookieValid(request.cookies.get(ACCESS_COOKIE)?.value)) return NextResponse.next();
  const target = new URL('/access', request.url);
  target.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
  // Server actions and other non-GET requests are refused outright rather than redirected.
  if (request.method !== 'GET' && request.method !== 'HEAD') return new NextResponse('Access password required.', { status: 401 });
  return NextResponse.redirect(target);
}

export const config = {
  // Everything except Next's own static files.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
