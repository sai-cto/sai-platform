import { and, count, eq, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { memberships, users } from '../db/schema';

/**
 * How many usable admins a business has: an active membership AND an active account.
 * It first locks the business's admin memberships, so two people removing "the other
 * admin" at the same moment are handled one after the other and the second is refused.
 */
export async function lockAndCountAdmins(tx: Tx, businessId: string): Promise<number> {
  await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.businessId, businessId), eq(memberships.role, 'business_admin')))
    .for('update');
  const [row] = await tx
    .select({ n: count() })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.businessId, businessId),
        eq(memberships.role, 'business_admin'),
        eq(memberships.isActive, true),
        eq(users.isActive, true),
      ),
    );
  return row.n;
}

/**
 * Serialises changes to who has access. Every function that changes a membership takes the
 * business's lock FIRST and reads afterwards, so it always decides on up-to-date facts.
 * Functions that change an account take the user's lock first, then business locks in a
 * fixed order (sorted), which rules out deadlocks. Locks are released when the transaction ends.
 */
export async function lockBusinessPeople(tx: Tx, businessId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`people:business:${businessId}`}, 0))`,
  );
}

export async function lockUserAccess(tx: Tx, userId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`people:user:${userId}`}, 0))`,
  );
}
