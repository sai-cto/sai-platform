'use server';

/**
 * The hosted demo's shared access password (src/proxy.ts). In a file of its own: the /access
 * page is reachable without the password, so it must not carry any other server action.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_COOKIE, accessCookieValue, accessPasswordMatches, safeLocalPath, slowDown } from '@/core/demo/demo';

export async function accessAction(formData: FormData): Promise<void> {
  const next = safeLocalPath(String(formData.get('next') ?? '/'));
  if (!accessPasswordMatches(String(formData.get('password') ?? ''))) {
    await slowDown();
    redirect(`/access?error=1&next=${encodeURIComponent(next)}`);
  }
  (await cookies()).set(ACCESS_COOKIE, accessCookieValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(next);
}
