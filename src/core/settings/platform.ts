/** Platform settings: values only a super_admin can change. */
import { eq } from 'drizzle-orm';
import { logActivity } from '../audit/log';
import { getDb, type Tx } from '../db/client';
import { platformSettings } from '../db/schema';
import { ValidationError } from '../errors';
import { authorize } from '../rbac/permissions';
import type { PlatformContext } from '../tenancy/context';

export const DEFAULT_RETENTION_DAYS = 30;

/** How many days a record must stay archived before a super_admin may permanently delete it. */
export async function getRetentionDays(tx?: Tx): Promise<number> {
  const [row] = await (tx ?? getDb())
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, 'retention_days'))
    .limit(1);
  // Anything that is not a whole number of days from 1 upwards falls back to the default,
  // so a bad value in the table can never shorten the window to zero.
  const value = typeof row?.value === 'number' ? row.value : Number.NaN;
  return Number.isInteger(value) && value >= 1 ? value : DEFAULT_RETENTION_DAYS;
}

export async function setRetentionDays(ctx: PlatformContext, days: number): Promise<void> {
  authorize(ctx, 'platform.settings.write');
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new ValidationError('Retention must be a whole number of days between 1 and 3650.');
  }
  await getDb().transaction(async (tx) => {
    const before = await getRetentionDays(tx);
    await tx
      .insert(platformSettings)
      .values({ key: 'retention_days', value: days })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: days, updatedAt: new Date() },
      });
    await logActivity(tx, ctx, {
      action: 'settings_change',
      entityType: 'platform.setting',
      entityId: 'retention_days',
      summary: `Changed retention window from ${before} to ${days} days`,
      before: { retention_days: before },
      after: { retention_days: days },
    });
  });
}
