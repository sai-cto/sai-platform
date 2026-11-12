'use server';

/** "Act as" (src/core/auth/acting-as.ts): start from a user's page, stop from the banner. */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { startActingAs, stopActingAs } from '@/core/auth/acting-as';
import { SESSION_COOKIE } from '@/core/auth/session';
import { UnauthenticatedError } from '@/core/errors';
import type { ActionResult } from '@/ui/action-form';
import { act } from '@/server/actions';
import { requirePlatformContext } from '@/server/session';

export async function startActingAsAction(userId: string): Promise<ActionResult> {
  const result = await act(async () => {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) throw new UnauthenticatedError();
    const { name } = await startActingAs(await requirePlatformContext(), token, userId);
    return `You are now acting as ${name}.`;
  });
  if (result.ok) redirect('/console');
  return result;
}

export async function stopActingAsAction(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await stopActingAs(token);
  redirect('/console/platform/users');
}
