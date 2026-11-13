'use server';

/** The app's "Send feedback" button, and the tech team marking messages read or done. */
import { sendFeedback, setFeedbackStatus } from '@/core/feedback/feedback';
import { act } from '@/server/actions';
import { parseMode, requireBusinessContext } from '@/server/session';
import type { ActionResult } from '@/ui/action-form';

export async function sendFeedbackAction(slug: string, mode: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  return act(async () => {
    const ctx = await requireBusinessContext(slug, parseMode(mode));
    await sendFeedback(ctx, { message: String(form.get('message') ?? ''), pageUrl: String(form.get('pageUrl') ?? '') });
    return 'Thank you, it has been sent to the team.';
  });
}

export async function setFeedbackStatusAction(slug: string, mode: string, id: string, status: 'new' | 'read' | 'done'): Promise<ActionResult> {
  return act(async () => {
    const ctx = await requireBusinessContext(slug, parseMode(mode));
    await setFeedbackStatus(ctx, id, status);
    return 'Updated.';
  });
}
