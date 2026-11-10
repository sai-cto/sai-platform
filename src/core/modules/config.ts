/** A business's module configuration: settings and portal toggles (the Settings tab). */
import { eq } from 'drizzle-orm';
import { logActivity } from '../audit/log';
import { getDb } from '../db/client';
import { businessModules } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';
import { authorize } from '../rbac/permissions';
import type { BusinessContext } from '../tenancy/context';
import { getModule } from './registry';

export type PortalKind = 'staff' | 'customer' | 'field';

export type ModuleConfig = {
  moduleKey: string;
  enabled: boolean;
  portals: Record<PortalKind, boolean>;
  settings: Record<string, unknown>;
};

async function loadRow(businessId: string) {
  const [row] = await getDb()
    .select()
    .from(businessModules)
    .where(eq(businessModules.businessId, businessId))
    .limit(1);
  if (!row) throw new NotFoundError('This business has no module installed.');
  return row;
}

/** Settings with the module's defaults filled in. No permission check: for use by module code. */
export async function loadModuleSettings<T extends Record<string, unknown>>(
  ctx: BusinessContext,
): Promise<T> {
  const row = await loadRow(ctx.business.id);
  const defaults = getModule(row.moduleKey)?.settings?.defaults ?? {};
  return { ...defaults, ...row.settings } as T;
}

export async function getModuleConfig(ctx: BusinessContext): Promise<ModuleConfig> {
  authorize(ctx, 'business.settings.read');
  const row = await loadRow(ctx.business.id);
  const defaults = getModule(row.moduleKey)?.settings?.defaults ?? {};
  return {
    moduleKey: row.moduleKey,
    enabled: row.enabled,
    portals: {
      staff: row.staffPortalEnabled,
      customer: row.customerPortalEnabled,
      field: row.fieldPortalEnabled,
    },
    settings: { ...defaults, ...row.settings },
  };
}

export async function updateModuleSettings(
  ctx: BusinessContext,
  raw: Record<string, unknown>,
): Promise<void> {
  authorize(ctx, 'business.settings.write');
  const row = await loadRow(ctx.business.id);
  const definition = getModule(row.moduleKey)?.settings;
  if (!definition) throw new ValidationError('This module has no settings.');
  const parsed = definition.schema.safeParse({ ...definition.defaults, ...row.settings, ...raw });
  if (!parsed.success)
    throw new ValidationError(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  await getDb().transaction(async (tx) => {
    await tx
      .update(businessModules)
      .set({ settings: parsed.data, updatedAt: new Date() })
      .where(eq(businessModules.businessId, ctx.business.id));
    await logActivity(tx, ctx, {
      action: 'settings_change',
      entityType: 'module.settings',
      entityId: row.moduleKey,
      summary: `Changed ${ctx.business.name} module settings`,
      before: { ...definition.defaults, ...row.settings },
      after: parsed.data,
    });
  });
}

const PORTAL_COLUMN = {
  staff: 'staffPortalEnabled',
  customer: 'customerPortalEnabled',
  field: 'fieldPortalEnabled',
} as const;

export async function setPortalEnabled(
  ctx: BusinessContext,
  portal: PortalKind,
  enabled: boolean,
): Promise<void> {
  authorize(ctx, 'business.settings.write');
  const row = await loadRow(ctx.business.id);
  const column = PORTAL_COLUMN[portal];
  if (!column) throw new ValidationError('Unknown portal.');
  if (enabled && !getModule(row.moduleKey)?.portals[portal]) {
    throw new ValidationError(
      `This module does not have a ${portal} portal yet, so it cannot be switched on.`,
    );
  }
  if (row[column] === enabled) return;
  await getDb().transaction(async (tx) => {
    await tx
      .update(businessModules)
      .set({ [column]: enabled, updatedAt: new Date() })
      .where(eq(businessModules.businessId, ctx.business.id));
    await logActivity(tx, ctx, {
      action: 'settings_change',
      entityType: 'module.portal',
      entityId: `${row.moduleKey}.${portal}`,
      summary: `Turned the ${portal} portal ${enabled ? 'on' : 'off'} for ${ctx.business.name}`,
      before: { [portal]: row[column] },
      after: { [portal]: enabled },
    });
  });
}

/** Is this portal live for this business? (Module defines it AND the toggle is on.) */
export async function isPortalAvailable(businessId: string, portal: PortalKind): Promise<boolean> {
  const [row] = await getDb()
    .select()
    .from(businessModules)
    .where(eq(businessModules.businessId, businessId))
    .limit(1);
  if (!row || !row.enabled) return false;
  return Boolean(getModule(row.moduleKey)?.portals[portal]) && row[PORTAL_COLUMN[portal]];
}
