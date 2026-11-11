import { generateCodeVerifier, generateState } from 'arctic';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getOAuthProvider } from '@/core/auth/login';
import { siteUrl } from '@/core/demo/pilot';

/** Starts a Microsoft / Google sign-in. Returns 404 while the provider is not configured. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const provider = getOAuthProvider((await params).provider);
  if (!provider) return new NextResponse('Not found', { status: 404 });
  // The provider returns to the site's own address; start there too, or the state cookie set
  // below would be on another host (e.g. a deployment-specific address) and sign-in would fail.
  const site = siteUrl('');
  if (site && new URL(site).host !== new URL(request.url).host)
    return NextResponse.redirect(`${site}/api/auth/${provider.id}/start`);
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const store = await cookies();
  const options = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  };
  store.set('sai_oauth_state', state, options);
  store.set('sai_oauth_verifier', codeVerifier, options);
  return NextResponse.redirect(provider.createAuthorizationUrl(state, codeVerifier));
}
