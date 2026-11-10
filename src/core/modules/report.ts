/** The module registry as the Platform section shows it: what each business has installed. */
import { asc, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { businessModules, businesses } from '../db/schema';
import { authorize } from '../rbac/permissions';
import type { PlatformContext } from '../tenancy/context';
import type { ModuleManifest } from './contract';
import { getModule, getModules, validateRegistry } from './registry';

export type InstalledModule = {
  businessId: string;
  slug: string;
  code: string;
  businessName: string;
  accentColor: string;
  moduleKey: string | null;
  enabled: boolean;
  /** Undefined when the business's module key has no manifest in the registry. */
  manifest: ModuleManifest | undefined;
  portals: Record<'staff' | 'customer' | 'field', { built: boolean; on: boolean }>;
};

export async function moduleRegistryReport(
  ctx: PlatformContext,
): Promise<{ installed: InstalledModule[]; problems: string[]; registered: number }> {
  authorize(ctx, 'platform.modules.read');
  const rows = await getDb()
    .select({ business: businesses, mod: businessModules })
    .from(businesses)
    .leftJoin(businessModules, eq(businessModules.businessId, businesses.id))
    .orderBy(asc(businesses.sortOrder));
  const installed = rows.map(({ business, mod }) => {
    const manifest = mod ? getModule(mod.moduleKey) : undefined;
    return {
      businessId: business.id,
      slug: business.slug,
      code: business.code,
      businessName: business.name,
      accentColor: business.accentColor,
      moduleKey: mod?.moduleKey ?? null,
      enabled: mod?.enabled ?? false,
      manifest,
      portals: {
        staff: { built: Boolean(manifest?.portals.staff), on: mod?.staffPortalEnabled ?? false },
        customer: {
          built: Boolean(manifest?.portals.customer),
          on: mod?.customerPortalEnabled ?? false,
        },
        field: { built: Boolean(manifest?.portals.field), on: mod?.fieldPortalEnabled ?? false },
      },
    };
  });
  const problems = [...validateRegistry()];
  for (const row of installed) {
    if (row.moduleKey && !row.manifest)
      problems.push(
        `${row.businessName} expects module "${row.moduleKey}", which is not in src/modules/registry.ts.`,
      );
  }
  return { installed, problems, registered: getModules().length };
}
