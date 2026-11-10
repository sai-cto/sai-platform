/**
 * Microsoft Entra ID (Microsoft 365) sign-in. READY TO ENABLE, NOT CONFIGURED.
 *
 * To enable: set MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET and MICROSOFT_TENANT_ID in
 * .env.local and register the redirect URL  <APP_URL>/api/auth/microsoft/callback.
 *
 * MICROSOFT_TENANT_ID must be SAI's own directory id (a GUID). The shared values "common",
 * "organizations" and "consumers" are refused: they would let any Microsoft account in.
 * Every sign-in is also checked to come from that directory (the token's `tid` claim).
 *
 * Not yet verified against a real tenant (see docs/HANDOFF.md).
 */
import { MicrosoftEntraId, decodeIdToken } from 'arctic';
import { isUuid } from '../../ids';
import type { ExternalIdentity, OAuthProvider } from './types';

function client(): MicrosoftEntraId {
  return new MicrosoftEntraId(
    process.env.MICROSOFT_TENANT_ID ?? '',
    process.env.MICROSOFT_CLIENT_ID ?? '',
    process.env.MICROSOFT_CLIENT_SECRET ?? '',
    `${process.env.APP_URL ?? ''}/api/auth/microsoft/callback`,
  );
}

/**
 * Turns the claims of a Microsoft ID token into an identity. The email counts as verified
 * only when the token was issued by OUR directory: accounts there are created and managed
 * by the company, so their sign-in name can be trusted. Exported for tests.
 */
export function microsoftIdentityFromClaims(
  claims: Record<string, unknown>,
  tenantId: string,
): ExternalIdentity {
  const fromOurDirectory =
    isUuid(tenantId) &&
    typeof claims.tid === 'string' &&
    claims.tid.toLowerCase() === tenantId.toLowerCase();
  const email = String(claims.email ?? claims.preferred_username ?? '').toLowerCase();
  return {
    provider: 'microsoft',
    // Nothing from another directory may ever match or be linked to an account.
    subject: fromOurDirectory ? String(claims.oid ?? claims.sub ?? '') : '',
    email,
    emailVerified: fromOurDirectory && email.includes('@'),
    name: typeof claims.name === 'string' ? claims.name : undefined,
  };
}

export const microsoftProvider: OAuthProvider = {
  id: 'microsoft',
  label: 'Microsoft 365',
  isEnabled: () =>
    Boolean(
      process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET && process.env.APP_URL,
    ) && isUuid(process.env.MICROSOFT_TENANT_ID),
  createAuthorizationUrl: (state, codeVerifier) =>
    client().createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email']),
  async exchangeCode(code, codeVerifier): Promise<ExternalIdentity> {
    const tokens = await client().validateAuthorizationCode(code, codeVerifier);
    return microsoftIdentityFromClaims(
      decodeIdToken(tokens.idToken()) as Record<string, unknown>,
      process.env.MICROSOFT_TENANT_ID ?? '',
    );
  },
};
