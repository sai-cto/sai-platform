/**
 * Unexpected server errors, kept for the tech team (System health › Errors). Written from
 * src/instrumentation.ts (pages, route handlers) and from server actions that fail unexpectedly.
 * Logging never throws: a broken log must not turn into a second error for the person.
 * Database errors carry the query's parameters (customer data): those are cut off.
 */
import { desc } from 'drizzle-orm';
import { getDb } from '../db/client';
import { serverErrors } from '../db/schema';
import { withPlatformScope } from '../db/scope';
import type { PlatformContext } from '../tenancy/context';

/** Message and stack with anything that could be data (query parameters) removed. */
export function scrubError(error: unknown): { message: string; stack: string | null; digest: string | null } {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
  // Query parameters, and quoted values (Postgres quotes the bad input: invalid input syntax … "<value>").
  const scrub = (text: string) =>
    text
      .replace(/params:[\s\S]*/i, 'params: [hidden]')
      .replace(/"[^"\n]{0,200}"/g, '"[hidden]"')
      .replace(/\u0000/g, '');
  const digest = typeof error === 'object' && error !== null && 'digest' in error ? String((error as { digest: unknown }).digest).slice(0, 100) : null;
  const stack = error instanceof Error && error.stack ? scrub(error.stack).slice(0, 4000) : null;
  return { message: scrub(raw).slice(0, 1000) || 'Unknown error', stack, digest };
}

export async function logServerError(error: unknown, where: { source: string; path?: string | null; userId?: string | null }): Promise<void> {
  try {
    const { message, stack, digest } = scrubError(error);
    await getDb()
      .insert(serverErrors)
      .values({ source: where.source.slice(0, 40), message, stack, digest, path: (where.path ?? '').slice(0, 500) || null, userId: where.userId ?? null });
  } catch {
    // Nowhere to log the logging failure; the server's own output still has the original error.
  }
}

export async function listServerErrors(ctx: PlatformContext, limit = 100) {
  return withPlatformScope(ctx, 'platform.health.read', (s) =>
    s.db.select().from(serverErrors).orderBy(desc(serverErrors.occurredAt)).limit(Math.min(limit, 500)),
  );
}
