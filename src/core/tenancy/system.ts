/**
 * The system actor. ONLY for seed scripts and automated tests: it holds every permission
 * of a business and has no user id. Never import this from src/app or from a module
 * (an ESLint rule blocks it).
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { businessModules, businesses } from '../db/schema';
import { businessActions } from '../rbac/permissions';
import type { BusinessContext, Environment } from './context';

export async function systemContext(
  businessSlug: string,
  environment: Environment,
): Promise<BusinessContext> {
  const [row] = await getDb()
    .select({
      id: businesses.id,
      slug: businesses.slug,
      code: businesses.code,
      name: businesses.name,
      timeZone: businesses.timeZone,
      accentColor: businesses.accentColor,
      description: businesses.description,
      moduleKey: businessModules.moduleKey,
    })
    .from(businesses)
    .leftJoin(businessModules, eq(businessModules.businessId, businesses.id))
    .where(eq(businesses.slug, businessSlug))
    .limit(1);
  if (!row) throw new Error(`Unknown business "${businessSlug}"`);
  return {
    kind: 'business',
    actor: { id: null, name: 'System (seed)', email: '', platformRole: 'super_admin' },
    role: 'super_admin',
    business: row,
    environment,
    permissions: new Set(businessActions(row.moduleKey).map((a) => a.key)),
  };
}
