/**
 * Google Workspace sign-in. READY TO ENABLE, NOT CONFIGURED.
 * To enable: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local and register the
 * redirect URL  <APP_URL>/api/auth/google/callback.
 * Not yet verified against a real Workspace (see docs/HANDOFF.md).
 */
import { Google, decodeIdToken } from 'arctic';
import type { ExternalIdentity, OAuthProvider } from './types';

function client(): Google {
  return new Google(
    process.env.GOOGLE_CLIENT_ID ?? '',
    process.env.GOOGLE_CLIENT_SECRET ?? '',
    `${process.env.APP_URL ?? ''}/api/auth/google/callback`,
  );
}

export const googleProvider: OAuthProvider = {
  id: 'google',
  label: 'Google Workspace',
  isEnabled: () =>
    Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_URL,
    ),
  createAuthorizationUrl: (state, codeVerifier) =>
    client().createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email']),
  async exchangeCode(code, codeVerifier): Promise<ExternalIdentity> {
    const tokens = await client().validateAuthorizationCode(code, codeVerifier);
    const claims = decodeIdToken(tokens.idToken()) as Record<string, unknown>;
    return {
      provider: 'google',
      subject: String(claims.sub ?? ''),
      email: String(claims.email ?? '').toLowerCase(),
      emailVerified: claims.email_verified === true,
      name: typeof claims.name === 'string' ? claims.name : undefined,
    };
  },
};
