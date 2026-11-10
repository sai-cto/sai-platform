'use server';

import { getModuleConfig, setPortalEnabled, updateModuleSettings, type PortalKind } from '@/core/modules/config';
import { getModule } from '@/core/modules/registry';
import type { ActionResult } from '@/ui/action-form';
import { act } from '../../../_lib/actions';
import { requireBusinessContext } from '../../../_lib/session';

export async function setPortalAction(slug: string, portal: PortalKind, enabled: boolean): Promise<ActionResult> {
  return act(async () => {
    await setPortalEnabled(await requireBusinessContext(slug), portal, enabled);
  });
}

/** Reads each field the module declares from the form, converts it to its type, and saves. */
export async function saveSettingsAction(slug: string, _previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return act(async () => {
    const ctx = await requireBusinessContext(slug);
    const config = await getModuleConfig(ctx);
    const fields = getModule(config.moduleKey)?.settings?.fields ?? [];
    const values: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = formData.get(field.key);
      if (field.type === 'boolean') values[field.key] = raw === 'on';
      else if (field.type === 'number') values[field.key] = raw === null || raw === '' ? Number.NaN : Number(raw);
      else values[field.key] = typeof raw === 'string' ? raw.trim() : '';
    }
    await updateModuleSettings(ctx, values);
    return 'Saved.';
  });
}
