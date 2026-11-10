# SAI Platform — Phase 0 plan

Status: **proposed, awaiting approval (Checkpoint 1).** Nothing here is built yet.
Once approved, the contents move into `ARCHITECTURE.md`, `DECISIONS.md`, `MODULE_GUIDE.md` and `PERMISSIONS.md`, and this file is deleted.

Contents:
1. [Stack](#1-stack)
2. [Core data model](#2-core-data-model)
3. [Tenancy and permission enforcement](#3-tenancy-and-permission-enforcement)
4. [Module contract](#4-module-contract)
5. [Console sitemap](#5-console-sitemap)
6. [BRSS object → new model mapping](#6-brss-object--new-model-mapping)
7. [Risks](#7-risks)
8. [Questions only the CTO can answer](#8-questions-only-the-cto-can-answer)

---

## 1. Stack

The default stack from the brief is kept. No deviations. Versions are the current stable releases on npm (checked 10 Nov 2026) and will be pinned exactly in `package.json`.

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, strict mode | One language end to end; the compiler catches mistakes a new student would otherwise ship. |
| Web framework | Next.js 16 (App Router), React 19 | The default; server components and server actions mean no separate API project to maintain. |
| Database | PostgreSQL 17 in Docker Compose | The default; one `docker compose up` gives every student the same database. |
| ORM and migrations | Drizzle ORM 0.45 + drizzle-kit, `postgres` driver | Tables are plain TypeScript files that live inside each module's folder, queries read like SQL, and migrations are plain `.sql` files that can be reviewed. |
| Styling | Tailwind CSS 4 | The default. |
| Unit and integration tests | Vitest, run against a real Postgres test database | Tenant-isolation tests are only meaningful against the real database. |
| End-to-end tests | Playwright | The default; also used for the screenshots at UI checkpoints. |
| Validation | Zod | One schema validates a form, a server action and a CSV import row. |
| Package manager | npm | Ships with Node; nothing extra to install. |
| Runtime | Node 22 or newer (LTS) | What Next.js 16 supports. |
| Lint and format | ESLint + Prettier | Standard; ESLint also enforces the "no raw database access outside core" rule (section 3). |

Why Drizzle rather than Prisma: the module contract needs each module to own its tables in its own folder and to share standard columns (business, environment, archive, audit) through one helper. That is a three-line function in Drizzle and is not possible in Prisma's schema language. The stable 0.45 line is used; Drizzle 1.0 is still a release candidate and will not be adopted until it is final.

### Dependencies that need your approval

The brief says to ask before adding anything beyond the default stack and ordinary small utilities. These are the ones that are more than a small utility:

| Dependency | Used for | Alternative if you say no |
|---|---|---|
| Radix UI primitives + `lucide-react` icons, used the shadcn/ui way (component source copied into `src/ui`, owned by us) | Accessible dialogs, menus, tabs, tooltips; keyboard support for free | Hand-write these components: slower, and accessibility is easy to get wrong. |
| `cmdk` | Command palette (Ctrl/Cmd-K) for keyboard navigation between businesses and pages | No command palette; sidebar keyboard shortcuts only. |
| `recharts` | Trend charts on the executive dashboard and business overviews | Hand-drawn SVG bar and line charts: fewer features, no dependency. |
| `arctic` | The OAuth sign-in handshake inside the Microsoft and Google adapters (inactive until configured) | Hand-write the OAuth code flow: about 150 lines per provider, security-sensitive. |
| `stripe` (official SDK) | The Stripe payment adapter, test mode only | Call Stripe's HTTP API by hand. |

Small utilities I plan to use without further asking: `zod`, `date-fns`, `clsx`, `tailwind-merge`, `class-variance-authority`, `papaparse` (CSV), `dotenv`.

Deliberately **not** used: any auth framework (sessions are about 150 lines we own, so logins go straight into our activity log and switching identity provider later touches one folder), any client state library, any job queue, any monorepo tooling, any hosted service.

### Repository layout

One Next.js application, one `package.json`. No monorepo.

```
src/
  app/                 Routes only. Each file parses the request, calls core or a module, renders.
  core/                The shared core. Modules import from here; core never imports a module.
    db/                Client, standard-column helpers, withScope() — the only door to the database
    auth/              Sessions and providers (dev, microsoft, google)
    rbac/              Roles, the permission matrix, can() and authorize()
    records/           create / update / archive / restore / purge — the only way to write tenant data
    audit/             Activity log writer
    customers/  payments/  scheduling/  notifications/  files/  analytics/
    imports/  flags/  settings/  sandbox/
    modules/           The module contract (types) and the registry loader
  modules/
    registry.ts        The list of modules. Adding a module adds one line here.
    hhmc/ sare/ brss/ corn/ cfr/ tut/ cbb/ brm/ cp/
  ui/                  Shared components (buttons, tables, dialogs, monograms…)
db/migrations/         Generated SQL migrations
scripts/               setup, seed, secret-scan, generate-permissions-doc
tests/                 integration/ (Vitest + Postgres) and e2e/ (Playwright)
docs/
```

One documented command sequence: `cp .env.example .env.local`, `npm install`, `npm run setup` (starts Postgres, migrates, seeds), `npm run dev`.

---

## 2. Core data model

Conventions for every table: `id` is a UUID; money is integer cents plus a currency code; timestamps are `timestamptz` in UTC; each business has a time zone (default `America/New_York`) used for display and for "which day is this".

### 2.1 Platform tables (not owned by a business)

| Table | Purpose | Key columns |
|---|---|---|
| `businesses` | The 9 businesses. Seeded as data, never hardcoded. | `slug`, `code`, `name`, `description`, `accent_color`, `secondary_color`, `time_zone`, `sort_order` |
| `business_modules` | What each business has enabled. | `business_id`, `module_key`, `enabled`, `staff_portal_enabled`, `customer_portal_enabled`, `field_portal_enabled`, `settings` (JSON validated by the module's schema) |
| `users` | One row per person. | `email`, `name`, `platform_role` (null, `super_admin`, `tech` or `executive`), `is_active`, `last_login_at` |
| `auth_identities` | Links a user to a sign-in provider. Moving to Microsoft 365 or Google later means adding rows here, not changing users. | `user_id`, `provider` (`dev`, `microsoft`, `google`), `provider_subject` |
| `sessions` | Server-side login sessions. The cookie holds a random token; the table holds its hash. | `user_id`, `token_hash`, `expires_at`, `revoked_at` |
| `memberships` | A person's role in one business. | `user_id`, `business_id`, `role` (`business_admin` or `business_staff`), `is_active` |
| `membership_permissions` | What a `business_staff` member has been granted by their business_admin. | `membership_id`, `permission_key` |
| `feature_flags` | Flags, global or per business. | `key`, `business_id` (null = all), `enabled` |
| `platform_settings` | Settings only super_admin can change. | `key`, `value` — includes `retention_days` (default 30) |
| `activity_log` | Append-only record of everything. | `occurred_at`, `actor_user_id`, `actor_role`, `business_id` (null for platform events), `environment`, `action`, `entity_type`, `entity_id`, `summary`, `before`, `after`, `request_id` |

`activity_log.action` is one of: `create`, `update`, `archive`, `restore`, `purge`, `permission_change`, `login`, `login_failed`, `logout`, `settings_change`, `export`, `import`, `sandbox_reset`. Append-only is enforced by the database: a trigger rejects every `UPDATE` and `DELETE` on the table, and the application's database role is granted only `INSERT` and `SELECT` on it.

The three platform roles are global and stored on the user. The two business roles are per business and stored on the membership. This matches the locked role model exactly; nothing is added.

### 2.2 Tenant tables (owned by exactly one business)

Every tenant table gets the same standard columns from one helper, `tenantTable()`:

| Column | Meaning |
|---|---|
| `business_id` | The owning business. Never null. |
| `environment` | `live` or `sandbox`. Test mode reads and writes `sandbox` rows only. |
| `created_at`, `created_by`, `updated_at`, `updated_by` | Who and when. |
| `archived_at`, `archived_by` | Set when "deleted". Null means active. |

Core tenant tables:

| Table | Purpose | Key columns |
|---|---|---|
| `customers` | A business's customers. A person who uses two businesses is two separate rows. | `first_name`, `last_name`, `email`, `phone`, `kind` (`person`, `organization`), `notes`, `external_ref` (the id in the system it was imported from) |
| `payments` | One row per charge attempt. | `customer_id`, `amount_cents`, `currency`, `status` (`pending`, `succeeded`, `failed`, `canceled`), `method` (`card`, `cash`, `check`, `other`), `provider` (`stripe`, `mock`, `manual`), `provider_ref`, `card_brand`, `card_last4`, `subject_type`, `subject_id`, `description`, `effective_date` |
| `refunds` | One row per refund against a payment. | `payment_id`, `amount_cents`, `reason`, `provider_ref`, `status` |
| `resources` | Things that can be scheduled: a truck, a crew, a room. | `kind`, `name`, `is_active` |
| `appointments` | A scheduled visit or slot. | `customer_id`, `kind`, `starts_at`, `ends_at`, `status` (`unconfirmed`, `confirmed`, `in_progress`, `completed`, `canceled`), `resource_id`, `subject_type`, `subject_id`, `notes` |
| `unavailability` | A blocked time range, for the whole business or one resource. | `resource_id` (null = whole business), `starts_at`, `ends_at`, `reason` |
| `notifications` | Every message the platform sent or tried to send. | `channel` (`email`), `recipient`, `subject`, `body`, `status`, `error`, `subject_type`, `subject_id` |
| `files` | Metadata for stored files; bytes live in the storage adapter. | `storage_key`, `filename`, `content_type`, `size_bytes`, `subject_type`, `subject_id` |
| `import_jobs` | One row per CSV import run. | `entity_key`, `file_id`, `mapping`, `status` (`uploaded`, `mapped`, `dry_run_ok`, `dry_run_failed`, `imported`), `row_count`, `error_count`, `errors` |

`subject_type` + `subject_id` let a core record point at a module record (for example a payment for a BRSS order) without the core knowing about the module.

### 2.3 How a module adds its own fields to a core record

A module that needs more than the core columns adds its own table keyed by the core row's id. Example: the core `appointments` row holds when, who and status; `brss_appointments` holds the BRSS-only fields (building, room, elevator, item estimates, field reps). The core never grows business-specific columns, and cross-business analytics keep working on the core tables.

### 2.4 Core services (interfaces, each with one dev adapter)

| Service | Interface | Adapter built now |
|---|---|---|
| Payments | `PaymentProvider`: create charge, refund, look up | `mock` (default) and `stripe`. The Stripe adapter refuses to start unless the key begins with `sk_test_`. No key is committed. |
| Notifications | `NotificationChannel`: send | `console-email`: writes the message to the server console and to the `notifications` table. |
| Files | `FileStorage`: put, get, delete | `local-disk`: writes under `./storage` (git-ignored). |
| Scheduling | Functions, not an adapter: find conflicts, check a time against unavailability, list a day's appointments | — |
| Analytics | Query helpers: count and sum by day/week/month, per business and across all businesses (live data only) | — |

---

## 3. Tenancy and permission enforcement

The rule: **module code and route code cannot reach the database except through the core, and the core always knows who is asking, for which business, in which environment.** Three layers enforce it. A request must pass all three.

### Layer 1 — the request context

Every request builds one `Context` object on the server from the session cookie:

```ts
type Context = {
  user: { id: string; platformRole: 'super_admin' | 'tech' | 'executive' | null };
  business: { id: string; slug: string } | null;   // null only on platform pages
  role: 'super_admin' | 'tech' | 'executive' | 'business_admin' | 'business_staff';
  permissions: Set<string>;                        // resolved for this business
  environment: 'live' | 'sandbox';
};
```

The business comes from the URL, but the role comes from the database. If the user has no platform role and no active membership in that business, building the context fails and the request returns "not found". A business_admin of A therefore cannot even construct a context for B.

### Layer 2 — one door for reads, one door for writes

- **Reads:** `withScope(ctx, permission, fn)` checks the permission, opens a transaction and hands `fn` a query handle. Tenant queries are built with `scoped(ctx, table)`, which always adds `business_id = …`, `environment = …` and, unless archived rows are asked for, `archived_at IS NULL`.
- **Writes:** only five functions in `core/records` write tenant tables: `createRecord`, `updateRecord`, `archiveRecord`, `restoreRecord`, `purgeRecord`. Each one: checks the permission → loads the row inside the scope (so a row from another business does not exist as far as it can tell) → writes → inserts the activity log entry with before and after, **in the same transaction**. If the log insert fails, the change rolls back. This is what makes "every mutation produces an activity log entry" a property of the structure rather than of developer discipline.
- **`purgeRecord`** additionally requires `role === 'super_admin'` and `archived_at` older than `retention_days`. There is no other code path that issues `DELETE` on a tenant table.
- An ESLint rule forbids importing the raw database client anywhere outside `src/core/db` and `src/core/records`. A module that tries fails lint.
- Cross-business reads (executive dashboard, platform pages) use a separate, explicitly named door, `withPlatformScope(ctx, permission, fn)`, which only platform roles can pass.

### Layer 3 — the database refuses too (row-level security)

Every tenant table has a Postgres row-level-security policy, added automatically by `tenantTable()`: a row is visible or writable only if its `business_id` and `environment` match the values the core set for the current transaction. The application connects as a database role that cannot bypass these policies. If a future developer (or Claude) writes a query that forgets the business filter, it returns nothing instead of another business's data.

This layer is the one piece of the design that is not strictly required by the brief. I recommend it because the team turns over every year and the cost of a cross-business leak is high; the cost is one extra concept in `ARCHITECTURE.md` and a second database role in local setup (handled by `npm run setup`). Say so at this checkpoint if you would rather not have it.

### Permissions

- One file, `src/core/rbac/matrix.ts`, is the single source of truth: role × action → allowed. `docs/PERMISSIONS.md` is generated from it by a script, and a test fails if the committed doc is out of date. That is how the doc is guaranteed to match what the tests check.
- Actions are strings: core actions (`customers.read`, `people.manage`, `data.export`, `records.purge`, `platform.settings.write`, …) and module actions declared in each manifest (`brss.orders.update`, …).
- `business_admin` holds every action of their own business except purge. `business_staff` holds only the actions their business_admin granted (stored in `membership_permissions`); each module declares a sensible default set.
- `executive` holds read actions only. `tech` holds everything except `records.purge` and `platform.settings.write`. `super_admin` holds everything.
- UI hiding is a convenience on top: buttons a role cannot use are not rendered, but the server refuses regardless.

### Tests that prove it (Phase 1)

| Requirement | How it is tested |
|---|---|
| business_admin of A cannot read or write B through any route or API | (a) Integration: for every registered entity of every module, attempt list, get, create, update, archive and restore against B with A's context; all must fail. (b) Database: a raw query with A's scope set returns zero B rows. (c) Playwright: logged in as A's admin, request every B console URL, export URL and server action; all must return not-found or forbidden. |
| executive cannot write anything | Loop over every write action in the matrix and every write function; all must be refused. |
| Only super_admin can purge, only past retention | Each role × {archived yesterday, archived 31 days ago}; exactly one combination succeeds. |
| Every mutation is logged | Loop over every registered entity × each of the five write functions, plus login, permission change, settings change; assert exactly one matching log row with before and after. Because the loop runs over the registry, a new module is covered automatically. |

### Test mode (sandbox)

- `environment` is part of the scope, exactly like `business_id`. Sandbox requests cannot see live rows and the reverse.
- The mode is in the URL (`/console/brss/live/…` vs `/console/brss/sandbox/…`), not in a cookie, so two browser tabs can never disagree about which data is on screen.
- In sandbox the console shows a persistent striped banner and a coloured frame on every page.
- Sandbox data is fake data produced by the module's seed function. "Reset sandbox" deletes the business's sandbox rows and re-seeds. Live data is never copied into the sandbox.
- Sandbox payments always use the mock provider; sandbox notifications are logged, never sent.

### Portals

All three portal types share the session system, the context and the data layer. Hosting routes exist for all three from day one:

- `/console/[business]/[mode]/app/…` — staff portal, embedded in the console
- `/portal/[business]/…` — customer portal
- `/field/[business]/…` — field portal (mobile)

Customer and field routes return "not found" until a module declares that portal in its manifest **and** the toggle in `business_modules` is on. Turning one on later is a manifest entry plus a toggle; nothing is restructured. How customers sign in is not designed now (it depends on the undecided identity question), but `customers` and `users` are separate tables so either answer fits.

---

## 4. Module contract

A module is a folder under `src/modules/<key>/` that exports one manifest. The console, the data browser, the importer, the permission system, the sandbox and the dashboards are all driven by the manifest; none of them contain business names.

```
src/modules/brss/
  manifest.ts       The contract (below)
  schema.ts         Tables, all created with tenantTable()
  permissions.ts    The module's actions and the default staff grants
  services/         Business logic. Plain functions taking (ctx, input).
  pages/            Staff portal screens (React server components)
  widgets/          Overview widgets
  seed.ts           Fake data for the sandbox
  README.md         What the module does, ported rules, open questions
```

```ts
export interface ModuleManifest {
  key: string;                    // 'brss' — must equal the business slug it serves
  name: string;
  version: string;                // shown in the module registry
  status: 'scaffold' | 'in_development' | 'live';
  description: string;
  plannedScope: string[];         // shown on the "not built yet" page

  permissions: PermissionDef[];   // { key, label, description, defaultForStaff }
  entities: EntityDef[];          // { key, label, table, listColumns, searchColumns, import? }
                                  //   → Data browser, export, archive/restore/purge, importer, isolation tests
  portals: {
    staff: PortalDef;             // { nav: NavItem[], routes: RouteDef[] }
    customer?: PortalDef;         // absent = this module has no customer portal
    field?: PortalDef;
  };
  widgets: WidgetDef[];           // key numbers on the business Overview
  metrics: {                      // feeds the executive dashboard
    workItem: { label: string; count(scope, range): Promise<number> };  // "Orders" for BRSS
  };
  settings?: { schema: ZodSchema; defaults: unknown };
  featureFlags?: FlagDef[];
  seedSandbox(ctx: Context): Promise<void>;
  healthChecks?(ctx: Context): Promise<HealthCheck[]>;
}
```

How the staff portal is embedded: the console has one catch-all route, `/console/[business]/[mode]/app/[[...path]]`. It loads the business, finds its module in the registry, matches the rest of the path against `manifest.portals.staff.routes` and renders that page inside the console frame. Modules never add files under `src/app/`.

Adding a tenth business (this becomes the `MODULE_GUIDE.md` checklist):
1. Copy `src/modules/_template/` to `src/modules/<key>/` and fill in the manifest.
2. Add one line to `src/modules/registry.ts`.
3. Add the business row (seed file now; a console form is not in scope).
4. `npm run db:generate` if the module has tables, then `npm run db:migrate`.
5. `npm test` — the registry-driven isolation and audit tests now cover the new module.

No file in `src/core/` or `src/app/` changes.

---

## 5. Console sitemap

`[mode]` is `live` or `sandbox`.

```
/login                                    Dev login (pick a seed user). Microsoft / Google buttons appear only when configured.

/console                                  Home: your businesses, your recent activity
/console/executive                        Cross-business dashboard, read-only        (executive, super_admin, tech)

/console/platform                         Platform section                            (super_admin, tech)
  /users                                  All users, platform roles, memberships
  /users/[id]
  /modules                                Module registry: business, module, version, status, portals
  /flags                                  Feature flags, global and per business
  /activity                               Global activity log
  /imports                                Import jobs
  /imports/new                            Upload CSV → map fields → dry-run preview → import into sandbox
  /imports/[id]
  /health                                 Database, migrations, adapters, per-module health checks
  /settings                               Retention window and other platform settings (super_admin only)

/console/[business]                       → redirects to live/overview
  /[mode]/overview                        Key numbers, recent activity, module health
  /[mode]/app/[[...path]]                 The business's staff portal, embedded
  /[mode]/data                            Entity list
  /[mode]/data/[entity]                   Browse, search, export CSV, archive, restore; purge (super_admin only)
  /[mode]/data/[entity]/[id]              One record and its history
  /[mode]/activity                        This business's activity log, filterable
  /people                                 Members, roles, staff permission grants
  /settings                               Module configuration, portal toggles
  /sandbox                                Test mode: status, reset and re-seed, link into sandbox

/portal/[business]/[[...path]]            Customer portal host (not found until enabled)
/field/[business]/[[...path]]             Field portal host (not found until enabled)

/api/auth/[provider]/callback             Sign-in callbacks for the inactive adapters
/api/health                               Liveness for local checks
```

Sidebar: a "Platform" group (only for super_admin and tech), an "Executive" link (only for roles that can see it), then the businesses the person can access, each with a coloured monogram of its short code. A business_admin of one business sees exactly one business and no Platform group.

Keyboard: Ctrl/Cmd-K command palette; `g` then a letter to jump between a business's tabs; `[` / `]` to move between businesses.

---

## 6. BRSS object → new model mapping

_To be completed from the Salesforce analysis — see below._

---

## 7. Risks

_See below._

---

## 8. Questions only the CTO can answer

_See below._
