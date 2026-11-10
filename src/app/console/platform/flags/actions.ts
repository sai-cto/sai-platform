'use server';

import { setFlag } from '@/core/flags/flags';
import type { ActionResult } from '@/ui/action-form';
import { act, text } from '../../../_lib/actions';
import { requirePlatformContext } from '../../../_lib/session';

export async function saveFlagAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return act(async () => {
    const businessId = text(formData, 'businessId');
    await setFlag(await requirePlatformContext(), {
      key: text(formData, 'key'),
      businessId: businessId === '' ? null : businessId,
      enabled: formData.get('enabled') === 'on',
      description: text(formData, 'description') || undefined,
    });
    return 'Saved.';
  });
}

export async function toggleFlagAction(
  key: string,
  businessId: string | null,
  enabled: boolean,
): Promise<ActionResult> {
  return act(async () => {
    await setFlag(await requirePlatformContext(), { key, businessId, enabled });
  });
}
