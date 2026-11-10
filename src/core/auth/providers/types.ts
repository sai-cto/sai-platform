/**
 * Sign-in providers. The rest of the platform only knows this interface, so the company
 * can move to Microsoft 365 or Google Workspace by configuring an adapter, not by
 * changing users, roles or sessions.
 */
export type AuthProviderId = 'dev' | 'microsoft' | 'google';

/** What a provider tells us about the person who just signed in. */
export type ExternalIdentity = {
  provider: AuthProviderId;
  /** The provider's stable id for this person. */
  subject: string;
  email: string;
  emailVerified: boolean;
  name?: string;
};

export interface OAuthProvider {
  id: Exclude<AuthProviderId, 'dev'>;
  label: string;
  /** True only when every setting it needs is present in the environment. */
  isEnabled(): boolean;
  createAuthorizationUrl(state: string, codeVerifier: string): URL;
  /** Exchanges the code from the callback for the person's identity. */
  exchangeCode(code: string, codeVerifier: string): Promise<ExternalIdentity>;
}
