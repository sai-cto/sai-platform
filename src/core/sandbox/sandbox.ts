/**
 * Test mode. Each business has a sandbox: a separate set of rows (environment = 'sandbox')
 * filled with FAKE data. Live data is never copied into it.
 *
 * resetSandbox() deletes the business's sandbox rows and re-seeds them. It is the only
 * place besides purgeRecord() that deletes tenant rows, and it can only touch sandbox rows:
 *  - the scope it runs in is forced to 'sandbox', and row-level security enforces that;
 *  - links between tenant tables never cascade and can never cross from live to sandbox
 *    (sameTenant() in src/core/db/tenant-table.ts), so deleting a sandbox row cannot take
 *    a live row with it.
 */
import { and, eq } from 'drizzle-orm';
import { logActivity } from '../audit/log';
import { files } from '../db/schema';
import { afterCommit, txOf, withScope, type Scope } from '../db/scope';
import { fileStorage, ownsStorageKey } from '../files/storage';
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
    // Remember which stored files belong to the rows about to go, so exactly those bytes are
    // removed once the reset has committed (files the fresh seed creates are left alone).
    const oldFiles = await s.db
      .select({ key: files.storageKey })
      .from(files)
      .where(s.where(files, 'include'));
    afterCommit(s, async () => {
      for (const file of oldFiles) {
        if (ownsStorageKey(ctx.business.id, 'sandbox', file.key))
          await fileStorage.delete(file.key);
      }
    });
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
