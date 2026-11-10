/**
 * takeLock(): "one at a time, please".
 *
 * Two requests that take the same lock name run one after the other instead of at the same
 * moment: the second waits until the first one's transaction has finished. Use it when two
 * people pressing the same button at once would otherwise both read the old state and both
 * act on it (two payments for one order, two records given the same number).
 *
 * The lock belongs to this business and environment, and is released automatically when the
 * surrounding withScope() transaction ends. There is nothing to unlock.
 */
import { sql } from 'drizzle-orm';
import { txOf, type Scope } from './scope';

export async function takeLock(s: Scope, name: string): Promise<void> {
  const key = `${s.ctx.business.id}:${s.ctx.environment}:${name}`;
  await txOf(s).execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}
