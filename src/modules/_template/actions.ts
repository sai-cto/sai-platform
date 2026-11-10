'use server';

/**
 * TEMPLATE — server actions: what this module's forms and buttons call.
 *
 * Every action: (1) builds the context from the session, (2) calls a service, (3) returns
 * { ok, message } through act(). Treat every argument as untrusted — anyone signed in can
 * call an action with any values — so never skip requireStaffPortalContext(). It checks who
 * is signed in, that they belong to this business, and that the staff portal is switched on.
 */
import { act, text } from '@/server/actions';
import { parseMode, requireStaffPortalContext } from '@/server/session';
import type { ActionResult } from '@/ui/action-form';
import { createItem } from './services/items';

export async function createItemAction(
  slug: string,
  mode: string,
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return act(async () => {
    const ctx = await requireStaffPortalContext(slug, parseMode(mode));
    await createItem(ctx, {
      name: text(formData, 'name'),
      price: text(formData, 'price'),
      notes: text(formData, 'notes'),
    });
    return 'Added.';
  });
}
