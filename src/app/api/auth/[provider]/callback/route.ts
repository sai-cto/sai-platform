import { cookies } from 'next/headers';
import { siteUrl } from '@/core/demo/pilot';
import { NextResponse } from 'next/server';
import { getOAuthProvider, loginWithIdentity, recordFailedSignIn } from '@/core/auth/login';
import { SESSION_COOKIE } from '@/core/auth/session';
import { UnauthenticatedError } from '@/core/errors';
import { sessionCookieOptions } from '@/server/session-cookie';

/** Finishes a Microsoft / Google sign-in. Returns 404 while the provider is not configured. */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const provider = getOAuthProvider((await params).provider);
  if (!provider) return new NextResponse('Not found', { status: 404 });
  const url = new URL(request.url);
  const store = await cookies();
  const expectedState = store.get('sai_oauth_state')?.value;
  const codeVerifier = store.get('sai_oauth_verifier')?.value;
  store.delete('sai_oauth_state');
  store.delete('sai_oauth_verifier');
  const code = url.searchParams.get('code');
  const failed = NextResponse.redirect(
    new URL('/login?error=1', siteUrl(url.origin)),
  );
  if (!code || !expectedState || !codeVerifier || url.searchParams.get('state') !== expectedState)
    return failed;
  try {
    const identity = await provider.exchangeCode(code, codeVerifier);
    const session = await loginWithIdentity(identity);
    store.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    return NextResponse.redirect(new URL('/console', siteUrl(url.origin)));
  } catch (error) {
    // loginWithIdentity logs its own refusals; anything else (the code exchange) is logged here.
    if (!(error instanceof UnauthenticatedError))
      await recordFailedSignIn(provider.id, 'could not complete the exchange with the provider');
    return failed;
  }
}
