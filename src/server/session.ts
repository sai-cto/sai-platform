/**
 * Glue between Next.js requests and the core. Every page and server action gets its
 * context from here; the context is rebuilt from the database on every request.
 */
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { SESSION_COOKIE, findSessionUserId } from '@/core/auth/session';
import { ForbiddenError, NotFoundError, UnauthenticatedError } from '@/core/errors';
import { buildLinkContext } from '@/core/links/links';
import { isPortalAvailable } from '@/core/modules/config';
import {
  buildBusinessContext,
  buildPlatformContext,
  type BusinessContext,
  type Environment,
  type PlatformContext,
} from '@/core/tenancy/context';

export async function currentUserId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return findSessionUserId(token);
}

/** The signed-in user's id, or a redirect to the login page. */
export async function requireUserId(): Promise<string> {
  const userId = await currentUserId();
  if (!userId) redirect('/login');
  return userId;
}

export async function requirePlatformContext(): Promise<PlatformContext> {
  const userId = await requireUserId();
  try {
    return await buildPlatformContext(userId);
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/login');
    throw error;
  }
}

export function parseMode(mode: string): Environment {
  if (mode !== 'live' && mode !== 'sandbox') notFound();
  return mode;
}

/**
 * The context for one business. A business the user cannot open — or cannot open in this
 * mode — is a plain "not found": the page gives no hint that it exists.
 */
export async function requireBusinessContext(
  slug: string,
  environment: Environment = 'live',
): Promise<BusinessContext> {
  const userId = await requireUserId();
  try {
    return await buildBusinessContext(userId, slug, environment);
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/login');
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound();
    throw error;
  }
}

/**
 * The context for a server action of a module's STAFF PORTAL. It is requireBusinessContext()
 * plus the two checks the App tab makes before it shows a page: the person may open the staff
 * portal, and the portal is switched on for this business. So switching a portal off in
 * Settings stops its buttons and forms as well as hiding its screens.
 */
export async function requireStaffPortalContext(
  slug: string,
  environment: Environment = 'live',
): Promise<BusinessContext> {
  const ctx = await requireBusinessContext(slug, environment);
  if (!ctx.permissions.has('business.app.use')) notFound();
  if (!(await isPortalAvailable(ctx.business.id, 'staff'))) notFound();
  return ctx;
}

/**
 * The context for someone holding a customer link (src/core/links): no account, no cookie.
 * A tampered, expired or switched-off link is a plain "not found". Customer-link pages and
 * their server actions get their context ONLY from here, from the token in the URL.
 */
export async function requireLinkContext(token: string): Promise<BusinessContext> {
  try {
    return await buildLinkContext(token);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound();
    throw error;
  }
}

/** Runs page code and turns "not found" / "forbidden" from the core into a 404 page. */
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound();
    throw error;
  }
}

/** A query-string value as a single string. `?q=a&q=b` gives the first; a missing one gives ''. */
export function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** A page number from the query string: a whole number from 1 to 100,000. */
export function pageNumber(value: string | string[] | undefined): number {
  const n = Number.parseInt(one(value), 10);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 100_000) : 1;
}
