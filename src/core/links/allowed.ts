/**
 * Core permissions a customer link purpose may hold (checked by validateRegistry()).
 * Nothing about people, settings, the Data tab, test mode or deletion, ever.
 * Kept in its own file so the registry can import it without loading the link code.
 */
export const LINK_ALLOWED_CORE_PERMISSIONS = [
  'customers.read',
  'payments.read',
  'payments.write',
  'notifications.write',
  'files.read',
  'files.write',
  'scheduling.read',
] as const;
