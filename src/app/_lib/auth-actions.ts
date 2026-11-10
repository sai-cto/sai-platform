'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loginWithDev, logout } from '@/core/auth/login';
import { SESSION_COOKIE, type NewSession } from '@/core/auth/session';

export async function setSessionCookie(session: NewSession): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: session.expiresAt,
  });
}

/** Dev login: pick a seed user. Only works when AUTH_DEV_LOGIN=true outside production. */
export async function devLoginAction(formData: FormData): Promise<void> {
  const session = await loginWithDev(String(formData.get('userId') ?? ''));
  await setSessionCookie(session);
  redirect('/console');
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  await logout(store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);
  redirect('/login');
}
