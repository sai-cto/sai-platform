'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loginWithDemoPassword, loginWithDev, logout } from '@/core/auth/login';
import { UnauthenticatedError } from '@/core/errors';
import { ACCESS_COOKIE, accessCookieValid, slowDown } from '@/core/demo/demo';
import { SESSION_COOKIE } from '@/core/auth/session';
import { sessionCookieOptions } from './session-cookie';

/** Dev login: pick a seed user. Only works when AUTH_DEV_LOGIN=true outside production. */
export async function devLoginAction(formData: FormData): Promise<void> {
  const session = await loginWithDev(String(formData.get('userId') ?? ''));
  (await cookies()).set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  redirect('/console');
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  await logout(store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);
  redirect('/login');
}

/** Demo site: sign in with a demo account's email and password (DEMO_ACCOUNTS). */
export async function demoLoginAction(formData: FormData): Promise<void> {
  // Second line of defence: the proxy already demands the access password, but this action
  // must never work without it, whichever page it is posted from.
  if (!accessCookieValid((await cookies()).get(ACCESS_COOKIE)?.value)) redirect('/access');
  try {
    const session = await loginWithDemoPassword(String(formData.get('email') ?? ''), String(formData.get('password') ?? ''));
    (await cookies()).set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      await slowDown();
      redirect('/login?error=1');
    }
    throw error;
  }
  redirect('/console');
}
