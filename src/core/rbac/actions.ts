/**
 * THE PERMISSION MATRIX. Single source of truth: role × action → allowed.
 *
 * - docs/PERMISSIONS.md is generated from this file (npm run docs:permissions) and a test
 *   fails if the committed doc is out of date.
 * - Changing anything here changes what people can do. The role model is locked by the
 *   project brief, so changes need the CTO's sign-off.
 *
 * "grantable" (business_staff only) means: off by default, a business_admin can switch it on
 * for an individual staff member in People and access.
 */
import type { Role } from './roles';

export type Allow = boolean | 'grantable';

export type ActionDef = {
  key: string;
  label: string;
  /** platform = not tied to one business; business = checked per business. */
  scope: 'platform' | 'business';
  /** write = changes something. Executives never hold a write action. */
  kind: 'read' | 'write';
  allow: Record<Role, Allow>;
};

const Y = true;
const N = false;
const G = 'grantable' as const;

function row(sa: Allow, tech: Allow, exec: Allow, admin: Allow, staff: Allow): Record<Role, Allow> {
  return { super_admin: sa, tech, executive: exec, business_admin: admin, business_staff: staff };
}

function action(
  key: string,
  label: string,
  scope: ActionDef['scope'],
  kind: ActionDef['kind'],
  allow: Record<Role, Allow>,
): ActionDef {
  return { key, label, scope, kind, allow };
}

/** Standard rows for record permissions, used by the core below and by every module. */
export const RECORD_READ = row(Y, Y, Y, Y, G);
export const RECORD_WRITE = row(Y, Y, N, Y, G);

// One action per line keeps the matrix readable as a table.
// prettier-ignore
export const CORE_ACTIONS: ActionDef[] = [
  // ---- Platform section ---------------------------------- SA  tech exec admin staff
  action('executive.dashboard.read', 'See the cross-business executive dashboard', 'platform', 'read', row(Y, Y, Y, N, N)),
  action('platform.users.read', 'See all users and their roles', 'platform', 'read', row(Y, Y, N, N, N)),
  action('platform.users.manage', 'Create users and assign business roles', 'platform', 'write', row(Y, Y, N, N, N)),
  action('platform.roles.grant', 'Grant or remove super_admin, tech and executive', 'platform', 'write', row(Y, N, N, N, N)),
  action('platform.modules.read', 'See the module registry', 'platform', 'read', row(Y, Y, N, N, N)),
  action('platform.flags.read', 'See feature flags', 'platform', 'read', row(Y, Y, N, N, N)),
  action('platform.flags.write', 'Change feature flags', 'platform', 'write', row(Y, Y, N, N, N)),
  action('platform.activity.read', 'See the global activity log', 'platform', 'read', row(Y, Y, N, N, N)),
  action('platform.imports.read', 'See data imports', 'platform', 'read', row(Y, Y, N, N, N)),
  action('platform.imports.run', 'Import a file into a sandbox', 'platform', 'write', row(Y, Y, N, N, N)),
  action('platform.imports.run_live', 'Import a checked file into live data', 'platform', 'write', row(Y, Y, N, N, N)),
  action('platform.health.read', 'See system health', 'platform', 'read', row(Y, Y, N, N, N)),
  action('platform.feedback.read', 'Read the feedback people sent from the apps', 'platform', 'read', row(Y, Y, N, N, N)),
  action('platform.settings.read', 'See platform settings', 'platform', 'read', row(Y, Y, N, N, N)),
  action('platform.settings.write', 'Change platform settings (e.g. retention window)', 'platform', 'write', row(Y, N, N, N, N)),

  // ---- Per business: console tabs ------------------------ SA  tech exec admin staff
  action('business.overview.read', 'See the business overview', 'business', 'read', row(Y, Y, Y, Y, Y)),
  action('business.app.use', 'Open the staff portal', 'business', 'read', row(Y, Y, N, Y, Y)),
  action('business.feedback.send', 'Send feedback about the app (Send feedback button)', 'business', 'write', row(Y, Y, N, Y, Y)),
  action('business.feedback.read', "Read this business's app feedback", 'business', 'read', row(Y, Y, N, N, N)),
  action('business.people.read', 'See who has access', 'business', 'read', row(Y, Y, N, Y, N)),
  action('business.people.manage', 'Add people, change roles and staff permissions', 'business', 'write', row(Y, Y, N, Y, N)),
  action('business.data.read', 'Browse records in the Data tab', 'business', 'read', row(Y, Y, Y, Y, G)),
  action('business.data.export', 'Export records to CSV', 'business', 'read', row(Y, Y, N, Y, G)),
  action('business.data.purge', 'Permanently delete archived records past retention', 'business', 'write', row(Y, N, N, N, N)),
  action('business.activity.read', "See the business's activity log (staff: only entries about records they may read)", 'business', 'read', row(Y, Y, Y, Y, G)),
  action('business.settings.read', 'See module settings', 'business', 'read', row(Y, Y, N, Y, N)),
  // Business admins also get this in a module that runs its admin inside the app (adminInApp).
  action('business.settings.write', 'Change module settings (business admins too, where the module runs its admin inside the app)', 'business', 'write', row(Y, Y, N, N, N)),
  action('business.portals.write', 'Switch portals on and off', 'business', 'write', row(Y, Y, N, N, N)),
  action('business.sandbox.use', 'Use test mode (sandbox data)', 'business', 'read', row(Y, Y, N, Y, G)),
  action('business.sandbox.reset', 'Reset the sandbox to fresh fake data', 'business', 'write', row(Y, Y, N, Y, N)),

  // ---- Per business: shared core records ------------------
  action('customers.read', 'See customers', 'business', 'read', RECORD_READ),
  action('customers.write', 'Add, edit, archive and restore customers', 'business', 'write', RECORD_WRITE),
  action('payments.read', 'See payments and refunds', 'business', 'read', RECORD_READ),
  action('payments.write', 'Take payments and issue refunds', 'business', 'write', RECORD_WRITE),
  action('scheduling.read', 'See appointments, resources and unavailability', 'business', 'read', RECORD_READ),
  action('scheduling.write', 'Add and change appointments, resources and unavailability', 'business', 'write', RECORD_WRITE),
  action('notifications.read', 'See sent notifications', 'business', 'read', RECORD_READ),
  action('notifications.write', 'Send notifications', 'business', 'write', RECORD_WRITE),
  action('files.read', 'See and download files', 'business', 'read', RECORD_READ),
  action('files.write', 'Upload and archive files', 'business', 'write', RECORD_WRITE),
  action('imports.read', 'See import runs for this business', 'business', 'read', row(Y, Y, N, N, N)),
  action('imports.write', 'Run imports for this business', 'business', 'write', row(Y, Y, N, N, N)),
];
