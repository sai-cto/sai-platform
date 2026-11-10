import { and, count, eq } from 'drizzle-orm';
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
