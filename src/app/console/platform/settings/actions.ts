'use server';

import { setRetentionDays } from '@/core/settings/platform';
import type { ActionResult } from '@/ui/action-form';
import { act, text } from '@/server/actions';
import { requirePlatformContext } from '@/server/session';

export async function saveRetentionAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return act(async () => {
    await setRetentionDays(await requirePlatformContext(), Number(text(formData, 'days')));
    return 'Saved.';
  });
}
