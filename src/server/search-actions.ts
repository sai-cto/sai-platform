'use server';

/** The console's search box: the current business's module searches its own records. */
import { getModule } from '@/core/modules/registry';
import type { SearchHit } from '@/core/modules/contract';
import { requireBusinessContext } from '@/server/session';

export async function searchAction(slug: string, mode: string, query: string): Promise<SearchHit[]> {
  if (typeof slug !== 'string' || typeof query !== 'string' || (mode !== 'live' && mode !== 'sandbox')) return [];
  try {
    const ctx = await requireBusinessContext(slug, mode);
    if (!ctx.permissions.has('business.app.use')) return [];
    const mod = ctx.business.moduleKey ? getModule(ctx.business.moduleKey) : undefined;
    if (!mod?.search) return [];
    return await mod.search(ctx, query.slice(0, 100), `/console/${ctx.business.slug}/${ctx.environment}/app`);
  } catch {
    // Not signed in, no such business, nothing readable: no results, never an error box.
    return [];
  }
}
