/** Feature flags: global, or overridden for one business. Changes are logged. */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { logActivity } from '../audit/log';
import { getDb } from '../db/client';
import { businesses, featureFlags } from '../db/schema';
import { ValidationError } from '../errors';
import { isUuid } from '../ids';
import { authorize } from '../rbac/permissions';
import type { PlatformContext } from '../tenancy/context';

export type Flag = {
  id: string;
  key: string;
  businessId: string | null;
  businessCode: string | null;
  enabled: boolean;
  description: string;
};

export async function listFlags(ctx: PlatformContext): Promise<Flag[]> {
  authorize(ctx, 'platform.flags.read');
  return getDb()
    .select({
      id: featureFlags.id,
      key: featureFlags.key,
      businessId: featureFlags.businessId,
      businessCode: businesses.code,
      enabled: featureFlags.enabled,
      description: featureFlags.description,
    })
    .from(featureFlags)
    .leftJoin(businesses, eq(businesses.id, featureFlags.businessId))
    .orderBy(asc(featureFlags.key), asc(businesses.sortOrder));
}

/** Is a flag on for this business? A business-specific row wins over the global one. */
export async function isFlagEnabled(key: string, businessId: string | null): Promise<boolean> {
  const db = getDb();
  if (businessId) {
    const [own] = await db
      .select({ enabled: featureFlags.enabled })
      .from(featureFlags)
      .where(and(eq(featureFlags.key, key), eq(featureFlags.businessId, businessId)))
      .limit(1);
    if (own) return own.enabled;
  }
  const [global] = await db
    .select({ enabled: featureFlags.enabled })
    .from(featureFlags)
    .where(and(eq(featureFlags.key, key), isNull(featureFlags.businessId)))
    .limit(1);
  return global?.enabled ?? false;
}

export async function setFlag(
  ctx: PlatformContext,
  input: { key: string; businessId: string | null; enabled: boolean; description?: string },
): Promise<void> {
  authorize(ctx, 'platform.flags.write');
  const key = input.key.trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,60}$/.test(key)) {
    throw new ValidationError(
      'Flag keys use lowercase letters, numbers, dots, dashes and underscores.',
    );
  }
  if (input.businessId !== null && !isUuid(input.businessId))
    throw new ValidationError('Unknown business.');
  if (input.businessId !== null) {
    const [business] = await getDb()
      .select({ id: businesses.id })
      .from(businesses)
      .where(eq(businesses.id, input.businessId))
      .limit(1);
    if (!business) throw new ValidationError('Unknown business.');
  }
  await getDb().transaction(async (tx) => {
    const scopeFilter = input.businessId
      ? eq(featureFlags.businessId, input.businessId)
      : isNull(featureFlags.businessId);
    const [existing] = await tx
      .select()
      .from(featureFlags)
      .where(and(eq(featureFlags.key, key), scopeFilter))
      .limit(1);
    if (existing) {
      if (
        existing.enabled === input.enabled &&
        (input.description === undefined || input.description === existing.description)
      )
        return;
      await tx
        .update(featureFlags)
        .set({
          enabled: input.enabled,
          description: input.description ?? existing.description,
          updatedAt: new Date(),
        })
        .where(eq(featureFlags.id, existing.id));
    } else {
      await tx.insert(featureFlags).values({
        key,
        businessId: input.businessId,
        enabled: input.enabled,
        description: input.description ?? '',
      });
    }
    await logActivity(
      tx,
      ctx,
      {
        action: 'settings_change',
        entityType: 'feature_flag',
        entityId: key,
        summary: `Turned flag "${key}" ${input.enabled ? 'on' : 'off'}${input.businessId ? ' for one business' : ' for all businesses'}`,
        before: existing ? { enabled: existing.enabled, businessId: input.businessId } : null,
        after: { enabled: input.enabled, businessId: input.businessId },
      },
      input.businessId,
    );
  });
}
