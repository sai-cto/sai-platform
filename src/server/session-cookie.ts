/** The one definition of how the session cookie is set. */
export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true, // not readable by page scripts
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  };
}
