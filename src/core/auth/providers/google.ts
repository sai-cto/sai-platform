/**
 * Google Workspace sign-in. READY TO ENABLE, NOT CONFIGURED.
 *
 * To enable: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_WORKSPACE_DOMAIN in
 * .env.local and register the redirect URL  <APP_URL>/api/auth/google/callback.
 *
 * GOOGLE_WORKSPACE_DOMAIN is SAI's Workspace domain. Only accounts of that Workspace are
 * accepted (the token's `hd` claim); a personal Gmail account is refused even if someone
 * typed a matching address into it.
 *
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

/** Turns the claims of a Google ID token into an identity. Exported for tests. */
export function googleIdentityFromClaims(
  claims: Record<string, unknown>,
  workspaceDomain: string,
): ExternalIdentity {
  const domain = workspaceDomain.trim().toLowerCase();
  const fromOurWorkspace =
    domain !== '' && typeof claims.hd === 'string' && claims.hd.toLowerCase() === domain;
  const email = String(claims.email ?? '').toLowerCase();
  return {
    provider: 'google',
    subject: fromOurWorkspace ? String(claims.sub ?? '') : '',
    email,
    emailVerified:
      fromOurWorkspace && claims.email_verified === true && email.endsWith(`@${domain}`),
    name: typeof claims.name === 'string' ? claims.name : undefined,
  };
}

export const googleProvider: OAuthProvider = {
  id: 'google',
  label: 'Google Workspace',
  isEnabled: () =>
    Boolean(
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_WORKSPACE_DOMAIN &&
      process.env.APP_URL,
    ),
  createAuthorizationUrl: (state, codeVerifier) =>
    client().createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email']),
  async exchangeCode(code, codeVerifier): Promise<ExternalIdentity> {
    const tokens = await client().validateAuthorizationCode(code, codeVerifier);
    return googleIdentityFromClaims(
      decodeIdToken(tokens.idToken()) as Record<string, unknown>,
      process.env.GOOGLE_WORKSPACE_DOMAIN ?? '',
    );
  },
};
