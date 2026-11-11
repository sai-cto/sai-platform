'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loginWithDemoPassword, loginWithDev, logout } from '@/core/auth/login';
import { UnauthenticatedError } from '@/core/errors';
import { ACCESS_COOKIE, accessCookieValue, accessPasswordMatches } from '@/core/demo/demo';
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
  try {
    const session = await loginWithDemoPassword(String(formData.get('email') ?? ''), String(formData.get('password') ?? ''));
    (await cookies()).set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/login?error=1');
    throw error;
  }
  redirect('/console');
}

/** Demo site: the shared access password, asked before anything else (src/proxy.ts). */
export async function accessAction(formData: FormData): Promise<void> {
  const next = String(formData.get('next') ?? '/');
  // Only a path on this site (never "//elsewhere" or a full URL).
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  if (!accessPasswordMatches(String(formData.get('password') ?? ''))) {
    redirect(`/access?error=1&next=${encodeURIComponent(safeNext)}`);
  }
  (await cookies()).set(ACCESS_COOKIE, accessCookieValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(safeNext);
}
