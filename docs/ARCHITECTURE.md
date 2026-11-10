# Architecture

Read this before changing code. It explains how the platform is put together and the few
rules that must not be broken.

## The shape of it

One Next.js application, one PostgreSQL database, one `package.json`.

```
src/
  app/        Routes only. Each file reads the request, calls the core or a module, renders.
  core/       The shared core. Modules import from it; it never imports a module.
  modules/    One folder per business + registry.ts (the list of modules).
  seed/       The 9 businesses and the fake test users, as data.
  ui/         Shared interface components (added with the console in Phase 2).
db/migrations/   Generated SQL migrations (plus one hand-written one, 0001).
scripts/         setup, seed, migrate, secret scan, permissions doc generator.
tests/           integration/ (Vitest + real Postgres) and e2e/ (Playwright).
```

Inside `src/core/`:

| Folder | What it owns |
|---|---|
| `db/` | The connection, the schema, `tenantTable()`, `withScope()` |
| `tenancy/` | The request context (who, which business, which environment) |
| `rbac/` | Roles, the permission matrix, `can()` and `authorize()` |
| `records/` | `createRecord` / `updateRecord` / `archiveRecord` / `restoreRecord` / `purgeRecord` |
| `audit/` | The activity log: writing and reading |
| `auth/` | Sessions and sign-in providers (dev, Microsoft, Google) |
| `people/` | Users, memberships, staff permission grants |
| `customers/` `payments/` `scheduling/` `notifications/` `files/` `analytics/` | The shared services |
| `sandbox/` | Test mode: reset and fake data |
| `modules/` | The module contract and registry access |
| `flags/` `settings/` `health/` | Feature flags, platform settings, health checks |

## Tenancy: three layers

Every business's data is strictly separate. Three layers enforce it, and a request must pass
all three. The UI hiding a button is **not** one of them.

**Layer 1 — the context.** Every request builds a `Context` on the server
(`src/core/tenancy/context.ts`). The business comes from the URL, but the role and permissions
come from the database. If the user has no access to that business, building the context
throws "not found" — a business admin of A cannot even construct a context for B.

**Layer 2 — one door for reads, five functions for writes.**

- Reads go through `withScope(ctx, permission, fn)` (`src/core/db/scope.ts`). It checks the
  permission, opens a transaction and gives `fn` a **read-only** query handle. Every tenant query
  includes `s.where(table)`, which adds "this business, this environment, not archived".
- Writes go through the five record functions in `src/core/records/records.ts`. Each checks the
  permission, finds the row inside the scope, writes, and adds the activity log entry **in the
  same transaction**. There is no other way to write a tenant table: the query handle modules
  receive has no insert, update or delete, and ESLint blocks importing the database connection
  or `txOf()` outside `src/core`.
- Cross-business reads (executive dashboard, Platform section) use the separate, explicitly
  named `withPlatformScope()`, which only platform roles can pass.

**Layer 3 — the database refuses too.** Every tenant table is created with `tenantTable()`
(`src/core/db/tenant-table.ts`), which adds row-level-security policies. `withScope()` tells
Postgres which business and environment the transaction is for; rows of any other business are
invisible and unwritable, even to a query that forgets its filter. The app connects as the role
`sai_app`, which owns nothing and cannot bypass these policies. Migrations run as `sai_owner`.

Links between tenant tables are guarded the same way. A foreign key ignores row-level security,
so a plain one would let a row point at another business's row, or a live row at a sandbox row.
`sameTenant()` (same file) builds a link that includes the business and the environment, and
never cascades a delete. A test fails if a tenant table links to another tenant table without it.

> If a query returns nothing and you expected rows, check that it runs inside `withScope()`.
> Outside a scope the app role sees no tenant rows at all. That is the design working.

**What layer 3 does not cover.** Row-level security protects *tenant* tables against a
forgotten filter. It is a seatbelt for honest mistakes, not a wall against hostile code running
inside the server: such code could set the scope itself. Platform tables (`users`,
`memberships`, `sessions`, …) have no row-level security at all; they are protected by layer 2
(every core function that touches them checks the context) and by an ESLint rule that stops
routes and modules importing them. Routes and modules import core tables from
`@/core/db/schema/tenant` only.

**Order inside a function that does something outside the database.** Charging a card, sending
an email or writing a file cannot be rolled back. Such a function checks the permission and the
input on its first lines, before the outside call (`takePayment`, `refundPayment`, `saveFile`,
`sendNotification`). Read helpers that take a scope check their own permission too; the
permission passed to `withScope()` is the door, not the only check.

## Live and sandbox (test mode)

`environment` (`live` or `sandbox`) is part of the scope exactly like the business is. Sandbox
requests cannot see live rows and the reverse. Sandbox data is fake data from the module's
`seedDemoData`; "reset sandbox" deletes the business's sandbox rows and re-seeds. Live data is
never copied into a sandbox. In the sandbox, payments always use the mock provider and
notifications are only logged.

## Permissions

`src/core/rbac/actions.ts` is the single source of truth: one row per action, one column per
role. `docs/PERMISSIONS.md` is generated from it and a test fails when the two differ.

- Platform roles (`super_admin`, `tech`, `executive`) are stored on the user and apply everywhere.
- Business roles (`business_admin`, `business_staff`) are stored per membership.
- A staff member holds the actions marked "grantable" only if their admin switched them on.
- Modules add their own permissions in their manifest; they follow the same two standard rows.

Server code calls `authorize(ctx, 'some.action')`. Hiding a button in the UI is a courtesy on top.

## Deleting

"Delete" means **archive**: `archivedAt` is set, the row disappears from normal queries and can
be restored. `purgeRecord()` is the only permanent delete: super admin only, and only when the
row has been archived longer than the retention window (`platform_settings.retention_days`,
default 30). The log keeps a tombstone of a purge, not the record's contents.

## The activity log

`activity_log` records who, what, when, which business and environment, and before/after for
every create, update, archive, restore, purge, permission change, settings change and sign-in.
It is append-only twice over: the app role has no UPDATE/DELETE privilege on it, and a trigger
rejects UPDATE, DELETE and TRUNCATE even for the owner (`db/migrations/0001_…sql`).

## Data model

Platform tables (`src/core/db/schema/platform.ts`): `businesses`, `business_modules`, `users`,
`auth_identities`, `sessions`, `memberships`, `membership_permissions`, `feature_flags`,
`platform_settings`, `activity_log`.

Core tenant tables (`src/core/db/schema/tenant.ts`): `customers`, `payments`, `refunds`,
`resources`, `appointments`, `unavailability`, `notifications`, `files`, `import_jobs`.

Every tenant table has the standard columns: `id`, `business_id`, `environment`, `created_at`,
`created_by`, `updated_at`, `updated_by`, `archived_at`, `archived_by`. Callers never set these.

Conventions: ids are UUIDs; money is integer cents; timestamps are UTC `timestamptz`.

`subject_type` + `subject_id` let a core row point at a module row (a payment for a BRSS order)
without the core knowing the module. A module that needs extra fields on a core record adds its
own table keyed by the core row's id; the core never grows business-specific columns.

## Modules and portals

A module is a folder under `src/modules/<key>/` exporting one manifest
(`src/core/modules/contract.ts`). Everything in the console is driven by manifests. See
`docs/MODULE_GUIDE.md`.

There are three portal types — staff, customer, field — sharing one login and one data layer.
The staff portal is embedded in the console. Customer and field portals get hosting routes
(added with the console in Phase 2) that answer "not found" until a module defines that portal
**and** its toggle is on.

## Core services and their adapters

| Service | Interface | Adapter today |
|---|---|---|
| Payments | `PaymentProvider` | `mock` (default). `stripe`, test keys only: it refuses any other key |
| Notifications | `NotificationChannel` | `console-email`: prints the email, sends nothing |
| Files | `FileStorage` | `local-disk` under `FILE_STORAGE_DIR` |
| Sign-in | `OAuthProvider` | `dev` login; Microsoft and Google built, not configured |

## Rules that must not be broken

1. Never define a business table with `pgTable()`. Use `tenantTable()`, and link tenant tables to each other with `sameTenant()`, never `.references()`.
2. Never import `src/core/db/client` outside `src/core`. Use `withScope()`.
3. Never write a tenant table except through the record functions.
4. Never hardcode a business (name, slug, colour) in a component. Businesses are data.
5. Never put a secret in the repository or the database. Secrets live in `.env.local`.
6. Never change the permission matrix or role list without the CTO's sign-off.
7. In a function with an effect outside the database (payment, email, file), check the permission and every link first, and use `afterCommit()` / `onRollback()` for clean-up that must follow the transaction.
8. For records with business rules (payments, refunds, appointments), call the service (`takePayment`, `refundPayment`, `bookAppointment`), not `createRecord` directly.
9. Every new rule gets a test. Run `npm run check` before committing.
