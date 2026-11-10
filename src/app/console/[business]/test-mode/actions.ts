'use server';

import { resetSandbox } from '@/core/sandbox/sandbox';
import type { ActionResult } from '@/ui/action-form';
import { act } from '../../../_lib/actions';
import { requireBusinessContext } from '../../../_lib/session';

export async function resetSandboxAction(slug: string): Promise<ActionResult> {
  return act(async () => {
    await resetSandbox(await requireBusinessContext(slug));
  });
}
