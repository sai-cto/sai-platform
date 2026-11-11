/**
 * Runs the modules' scheduled tasks (ModuleManifest.scheduledTasks) for every business, in
 * live and test mode, as the system actor. Called by the hosting's cron through
 * /api/cron/scheduled (protected by CRON_SECRET). A task with a settingKey runs only where that
 * module setting is switched on.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { businessModules, businesses } from '../db/schema';
import { withScope } from '../db/scope';
import { systemContext } from '../tenancy/system';
import { loadModuleSettings } from './config';
import { getModule } from './registry';

export type ScheduledResult = { business: string; environment: string; task: string; result: string };

export async function runScheduledTasks(now: Date = new Date()): Promise<ScheduledResult[]> {
  const rows = await getDb()
    .select({ slug: businesses.slug, moduleKey: businessModules.moduleKey, enabled: businessModules.enabled })
    .from(businesses)
    .innerJoin(businessModules, eq(businessModules.businessId, businesses.id));
  const results: ScheduledResult[] = [];
  for (const row of rows) {
    const tasks = row.enabled ? (getModule(row.moduleKey)?.scheduledTasks ?? []) : [];
    for (const task of tasks) {
      for (const environment of ['live', 'sandbox'] as const) {
        const ctx = await systemContext(row.slug, environment);
        if (task.settingKey) {
          const settings = await loadModuleSettings<Record<string, unknown>>(ctx);
          if (settings[task.settingKey] !== true) {
            results.push({ business: row.slug, environment, task: task.key, result: 'switched off' });
            continue;
          }
        }
        try {
          const result = await withScope(ctx, 'business.overview.read', (s) => task.run(s, now));
          results.push({ business: row.slug, environment, task: task.key, result });
        } catch (error) {
          // One business's failure must not stop the others.
          console.error(`Scheduled task ${task.key} failed for ${row.slug}/${environment}:`, error);
          results.push({ business: row.slug, environment, task: task.key, result: 'failed' });
        }
      }
    }
  }
  return results;
}
