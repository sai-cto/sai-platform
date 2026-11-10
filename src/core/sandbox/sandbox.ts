/**
 * Test mode. Each business has a sandbox: a separate set of rows (environment = 'sandbox')
 * filled with FAKE data. Live data is never copied into it.
 *
 * resetSandbox() deletes the business's sandbox rows and re-seeds them. It is the only
 * place besides purgeRecord() that deletes tenant rows, and it can only touch sandbox rows:
 * the scope it runs in is forced to 'sandbox', and row-level security enforces that.
 */
import { and, eq } from 'drizzle-orm';
import { logActivity } from '../audit/log';
import { txOf, withScope, type Scope } from '../db/scope';
import { entitiesFor, getModule } from '../modules/registry';
import { authorize } from '../rbac/permissions';
import type { BusinessContext } from '../tenancy/context';
import { seedCoreDemoData } from './demo-data';

/** Fills the scope's business with fake data: the module's own, or the generic core set. */
export async function seedDemoData(s: Scope): Promise<void> {
  const mod = s.ctx.business.moduleKey ? getModule(s.ctx.business.moduleKey) : undefined;
  if (mod?.seedDemoData) await mod.seedDemoData(s);
  else await seedCoreDemoData(s);
}

export async function resetSandbox(ctx: BusinessContext): Promise<void> {
  authorize(ctx, 'business.sandbox.reset');
  const sandboxCtx: BusinessContext = { ...ctx, environment: 'sandbox' };
  await withScope(sandboxCtx, 'business.sandbox.reset', async (s) => {
    // Children before parents: entities are declared parents-first, so delete in reverse.
    for (const entity of [...entitiesFor(ctx.business.moduleKey)].reverse()) {
      await txOf(s)
        .delete(entity.table)
        .where(
          and(
            eq(entity.table.businessId, ctx.business.id),
            eq(entity.table.environment, 'sandbox'),
          ),
        );
    }
    await seedDemoData(s);
    await logActivity(txOf(s), sandboxCtx, {
      action: 'sandbox_reset',
      entityType: 'sandbox',
      entityId: ctx.business.slug,
      summary: `Reset the ${ctx.business.name} sandbox to fresh fake data`,
    });
  });
}
