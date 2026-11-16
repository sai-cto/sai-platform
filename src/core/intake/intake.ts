/**
 * PUBLIC INTAKE: lets a website the business owns put one kind of record into the business
 * (a quote request becoming a lead) without anyone signing in. See docs/DECISIONS.md, WEB-1.
 *
 * The visitor is "Website (intake)": no user id, role "customer_link" (the platform's existing
 * "someone without an account" role), and exactly the permissions the module declared for this
 * intake (ModuleManifest.publicIntakes), module permissions only. The business and the
 * environment are chosen by the server (the route), never by anything the browser sends.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { businessModules, businesses } from '../db/schema';
import { NotFoundError } from '../errors';
import { getModule } from '../modules/registry';
import type { BusinessContext, Environment } from '../tenancy/context';

export async function runPublicIntake(input: {
  businessSlug: string;
  environment: Environment;
  key: string;
  body: unknown;
}): Promise<void> {
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
      enabled: businessModules.enabled,
    })
    .from(businesses)
    .innerJoin(businessModules, eq(businessModules.businessId, businesses.id))
    .where(eq(businesses.slug, input.businessSlug))
    .limit(1);
  // Anything missing or switched off is a plain "not found": nothing about the business leaks.
  if (!row || !row.enabled) throw new NotFoundError();
  const intake = getModule(row.moduleKey)?.publicIntakes?.find((i) => i.key === input.key);
  if (!intake) throw new NotFoundError();

  const ctx: BusinessContext = {
    kind: 'business',
    actor: { id: null, name: 'Website (intake)', email: '', platformRole: null },
    role: 'customer_link',
    business: {
      id: row.id,
      slug: row.slug,
      code: row.code,
      name: row.name,
      timeZone: row.timeZone,
      accentColor: row.accentColor,
      description: row.description,
      moduleKey: row.moduleKey,
    },
    environment: input.environment,
    permissions: new Set(intake.permissions),
  };
  await intake.run(ctx, input.body);
}
