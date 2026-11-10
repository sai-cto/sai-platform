/**
 * The five roles. This list is LOCKED by the project brief; do not add or rename roles
 * without the CTO's sign-off.
 */
export const PLATFORM_ROLES = ['super_admin', 'tech', 'executive'] as const;
export const BUSINESS_ROLES = ['business_admin', 'business_staff'] as const;
export const ROLES = [...PLATFORM_ROLES, ...BUSINESS_ROLES] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export type BusinessRole = (typeof BUSINESS_ROLES)[number];
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super admin',
  tech: 'Tech team',
  executive: 'Executive',
  business_admin: 'Business admin',
  business_staff: 'Business staff',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  super_admin: 'The CTO. Everything, including permanent deletion and platform settings.',
  tech: 'Builds and tests in every module and manages module settings. Cannot permanently delete or change platform settings.',
  executive: 'Read-only overview and analytics across every business.',
  business_admin:
    'Full day-to-day use of their own business. Manages their own staff. Cannot permanently delete.',
  business_staff: 'Day-to-day use of their own business, limited to what a business admin grants.',
};
