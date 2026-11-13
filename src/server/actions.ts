/**
 * Helpers for server actions. Every action in the console is written as:
 *
 *   export async function doThing(...): Promise<ActionResult> {
 *     return act(async () => { ...call the core...; return 'Saved.'; });
 *   }
 *
 * act() turns the core's "safe to show" errors into a message for the form. Anything else is
 * recorded (System health › Errors) and shown as a plain "something went wrong" message.
 */
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import {
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '@/core/errors';
import { logServerError } from '@/core/health/errors';
import type { ActionResult } from '@/ui/action-form';

export async function act(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn();
    // Whatever changed, the console's pages should show it on the next render.
    revalidatePath('/console', 'layout');
    revalidatePath('/l', 'layout'); // customer-link pages (src/app/l)
    return { ok: true, message: message ?? undefined };
  } catch (error) {
    unstable_rethrow(error); // lets redirect() and notFound() do their job
    if (error instanceof ValidationError) return { ok: false, message: error.message };
    if (error instanceof ForbiddenError)
      return { ok: false, message: 'You do not have permission to do that.' };
    if (error instanceof NotFoundError)
      return { ok: false, message: 'That no longer exists, or you cannot access it.' };
    if (error instanceof UnauthenticatedError)
      return { ok: false, message: 'Your session has ended. Sign in again.' };
    // Anything else is our fault: recorded for the tech team, a plain message for the person.
    await logServerError(error, { source: 'action' });
    return { ok: false, message: 'Something went wrong on our side, and it has been reported. Please try again; if it keeps happening, use "Send feedback".' };
  }
}

export function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}
