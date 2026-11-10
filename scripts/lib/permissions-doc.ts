/** Builds docs/PERMISSIONS.md from the permission matrix in src/core/rbac/actions.ts. */
import {
  CORE_ACTIONS,
  RECORD_READ,
  RECORD_WRITE,
  type ActionDef,
  type Allow,
} from '../../src/core/rbac/actions';
import { DEFAULT_STAFF_GRANTS } from '../../src/core/people/memberships';
import { getModules } from '../../src/core/modules/registry';
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '../../src/core/rbac/roles';

const cell = (allow: Allow) => (allow === true ? '✅' : allow === 'grantable' ? '🔑' : '—');

function table(actions: ActionDef[]): string {
  const header = `| Action | Key | Type | ${ROLES.map((r) => ROLE_LABELS[r]).join(' | ')} |\n|---|---|---|${ROLES.map(() => ':-:').join('|')}|`;
  const rows = actions.map(
    (a) =>
      `| ${a.label} | \`${a.key}\` | ${a.kind} | ${ROLES.map((r) => cell(a.allow[r])).join(' | ')} |`,
  );
  return [header, ...rows].join('\n');
}

export function renderPermissionsDoc(): string {
  const platform = CORE_ACTIONS.filter((a) => a.scope === 'platform');
  const business = CORE_ACTIONS.filter((a) => a.scope === 'business');
  const modules = getModules().filter((m) => m.permissions.length > 0);
  const moduleSections = modules
    .map((m) => {
      const actions: ActionDef[] = m.permissions.map((p) => ({
        key: p.key,
        label: p.label + (p.defaultForStaff ? ' *(on by default for new staff)*' : ''),
        scope: 'business',
        kind: p.kind,
        allow: p.kind === 'read' ? RECORD_READ : RECORD_WRITE,
      }));
      return `### ${m.name} (\`${m.key}\`)\n\n${table(actions)}`;
    })
    .join('\n\n');

  return `# Permissions: the role × action matrix

> **Generated file — do not edit by hand.** It is built from \`src/core/rbac/actions.ts\` (and each
> module's \`permissions\`) by \`npm run docs:permissions\`. A test fails if this file does not match
> the code, so what you read here is what the server enforces.

## Roles

${ROLES.map((r) => `- **${ROLE_LABELS[r]}** (\`${r}\`): ${ROLE_DESCRIPTIONS[r]}`).join('\n')}

The first three are *platform roles*: they apply to every business. The last two are *business
roles*: a person holds one per business they are assigned to. A person has either a platform role
or business roles, never both.

## How to read the tables

| Symbol | Meaning |
|:-:|---|
| ✅ | Always allowed |
| 🔑 | Off by default. A business admin can switch it on for an individual staff member (People and access) |
| — | Never allowed |

"Type" is \`read\` or \`write\`. Executives hold no \`write\` action anywhere.

## Platform actions

These are not tied to one business. Business roles never hold them.

${table(platform)}

## Actions inside a business

Checked per business. A business admin or staff member holds them **only in their own business**;
in any other business they hold nothing and the business does not appear to exist.

${table(business)}

New staff members start with: ${DEFAULT_STAFF_GRANTS.map((k) => `\`${k}\``).join(', ')}, plus their module's defaults.

## Module actions

Every module permission follows one of two standard rows: a \`read\` permission is ✅ for super admin,
tech, executive and business admin and 🔑 for staff; a \`write\` permission is the same except — for executive.

${moduleSections || '_No module defines its own permissions yet._'}

## Rules that are not a single cell

These are enforced in code and each has a test (file in brackets).

| Rule | Where it is tested |
|---|---|
| A business admin or staff member cannot open, read or write another business — through the context, the record functions, or a raw database query | \`tests/integration/tenant-isolation.test.ts\` |
| Live and sandbox data cannot see or change each other | \`tests/integration/tenant-isolation.test.ts\` |
| Executives cannot write anything, in any business or on the platform | \`tests/integration/permissions.test.ts\` |
| "Delete" archives (recoverable). Permanent delete needs super admin **and** the record archived longer than the retention window (default 30 days, configurable by super admin only) | \`tests/integration/retention.test.ts\` |
| Every create, update, archive, restore, permanent delete, permission change, settings change and sign-in writes an activity log entry in the same transaction; the log cannot be edited or deleted | \`tests/integration/audit.test.ts\` |
| Only super admin can grant or remove platform roles, or deactivate a platform-role account | \`tests/integration/permissions.test.ts\` |
| The last super admin cannot be demoted or deactivated; a business always keeps one active admin | \`tests/integration/permissions.test.ts\` |
| A person with business roles cannot be given a platform role, and the reverse | \`tests/integration/permissions.test.ts\` |
| Staff can only be granted actions marked 🔑 | \`tests/integration/permissions.test.ts\` |
| Using test mode (sandbox) needs \`business.sandbox.use\`; the sandbox always uses the mock payment provider | \`tests/integration/permissions.test.ts\`, \`tests/integration/services.test.ts\` |
| Routes and exports return "not found" for another business | \`tests/e2e/isolation.spec.ts\` |
`;
}
