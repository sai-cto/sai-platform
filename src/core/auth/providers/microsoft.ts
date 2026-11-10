/**
 * Microsoft Entra ID (Microsoft 365) sign-in. READY TO ENABLE, NOT CONFIGURED.
 * To enable: set MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET and MICROSOFT_TENANT_ID in
 * .env.local and register the redirect URL  <APP_URL>/api/auth/microsoft/callback.
 * Not yet verified against a real tenant (see docs/HANDOFF.md).
 */
import { MicrosoftEntraId, decodeIdToken } from 'arctic';
import type { ExternalIdentity, OAuthProvider } from './types';

function client(): MicrosoftEntraId {
  return new MicrosoftEntraId(
    process.env.MICROSOFT_TENANT_ID ?? '',
    process.env.MICROSOFT_CLIENT_ID ?? '',
    process.env.MICROSOFT_CLIENT_SECRET ?? '',
    `${process.env.APP_URL ?? ''}/api/auth/microsoft/callback`,
  );
}

export const microsoftProvider: OAuthProvider = {
  id: 'microsoft',
  label: 'Microsoft 365',
  isEnabled: () =>
    Boolean(
      process.env.MICROSOFT_CLIENT_ID &&
      process.env.MICROSOFT_CLIENT_SECRET &&
      process.env.MICROSOFT_TENANT_ID &&
      process.env.APP_URL,
    ),
  createAuthorizationUrl: (state, codeVerifier) =>
    client().createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email']),
  async exchangeCode(code, codeVerifier): Promise<ExternalIdentity> {
    const tokens = await client().validateAuthorizationCode(code, codeVerifier);
    const claims = decodeIdToken(tokens.idToken()) as Record<string, unknown>;
    const email = String(claims.email ?? claims.preferred_username ?? '').toLowerCase();
    return {
      provider: 'microsoft',
      subject: String(claims.oid ?? claims.sub ?? ''),
      email,
      // A single-tenant Entra app only signs in accounts from our own directory.
      emailVerified: email !== '' && process.env.MICROSOFT_TENANT_ID !== 'common',
      name: typeof claims.name === 'string' ? claims.name : undefined,
    };
  },
};
