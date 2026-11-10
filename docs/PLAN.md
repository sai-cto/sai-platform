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
| `payments` | One row per charge or card authorization. | `customer_id`, `kind` (`charge`, `authorization`), `amount_cents`, `currency`, `status` (`pending`, `succeeded`, `failed`, `canceled`), `idempotency_key`, `method` (`card`, `cash`, `check`, `other`), `provider` (`stripe`, `mock`, `manual`), `provider_ref`, `card_brand`, `card_last4`, `subject_type`, `subject_id`, `description`, `effective_date` |
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

Source: `../brss-salesforce` at commit `233cf40`, read only. Three written analyses were produced (data model; order, article and payment rules; scheduling, pricing and zones) with 393 rules and 97 open questions, every one cited to a file and line. I re-checked the findings quoted in this section against the source myself. The full rule list with citations becomes the BRSS module's rules document in Phase 4.

### 6.1 Four things in the code that differ from the brief

The brief says to stop and ask when the code contradicts it. These do:

| # | The brief says | The code shows | Evidence |
|---|---|---|---|
| 1 | `BRSS_OrdersDashboard` and `BRSS_OrderDetails` are staff pages. | Both are **customer** pages. The dashboard loads only the logged-in customer's orders and is switched off for the manager profile; the detail page loads an order only if the logged-in user is its customer. | `classes/BRSS_OrdersDashboardController.cls:32-44`, `profiles/BRSS Manager Profile.profile-meta.xml:2487-2490`, `classes/BRSS_OrderDetailsController.cls:72-73` |
| 2 | Staff have an orders dashboard with status, campus/region and date filters. | There is **no custom staff screen** in the repo. Staff work in standard Salesforce record pages and list views (for example "Today → Future" appointments, "Storage Orders"). Page layouts were never retrieved into the repo, so what staff actually see is not recorded anywhere I can read. The only custom staff-side screens are the crew's phone pages. | `objects/Order/listViews/`, `objects/Appointment__c/listViews/`, `objects/Order/webLinks/ProcessOrder.webLink-meta.xml` |
| 3 | `Warehouse__c` is a warehouse. | It is one row **per order line** holding a location text, kept in step with the line by two flows. Warehouses themselves exist only as picklist values, and the lists disagree: Mecklenburg and Lansing on the article; plus Overflow and SAI Basement on the order. | `objects/Warehouse__c/`, `flows/Order_Product_Sync_Warehouse_Location.flow-meta.xml`, `objects/Article__c/fields/Warehouse__c.field-meta.xml` |
| 4 | There is an article status progression to port. | There are eight statuses and **no enforced order**; any status can follow any other. No Apex sets a status. Three automations do (see 6.3). | `objects/Article__c/fields/Status__c.field-meta.xml:13-52` |

Also: `Quote__c` and `Move__c` belong to HHMC, not BRSS; `Employment__c` is a public careers page shared by both; `BRSS_Pricing` and `BRSS_PreArrival` are static marketing pages with no pricing logic or data capture. None of these are carried into the BRSS module.

Consequence for Phase 4: the staff portal cannot be a port of existing staff screens, because there are none. It will be a new design built on the real data model, the real rules and the list views staff use today. Question B1 asks how you want to specify it.

### 6.2 Object mapping

Tables prefixed `brss_` live in the BRSS module. The others are core tables.

| Salesforce | New model | What changes |
|---|---|---|
| `User` (customers are community users) + `Account` | core `customers` + `brss_customer_profiles` (NetID, class year, college, affiliation, marketing opt-out) | A customer is a customer record, not a login. The parent Account and the "default account" workaround disappear. |
| `Order` | `brss_orders`: order number, customer, status, campus category, discount, tip, ship-home address and zone, storage term months, storage effective date, delivery-scheduled flag, pre-arrival flag, notes | Tax and totals are computed in one function instead of formula fields. The standard `Type` field is dropped; the multi-select `Type__c` is the real one. |
| `Order.Type__c` (multi-select: Packing, Ship to Cornell, Ship to Home, Storage, Supplies) | `brss_order_services` (one row per service on the order) | Queryable for filters and reporting. |
| `OrderItem` | `brss_order_items`: order, product, optional article, description, quantity, unit price, status (`new`, `paid`) | |
| `Product2`, `PricebookEntry`, `Pricebook2` | `brss_products`: name, code, kind, unit price, non-boxed flag, pre-arrival flag, active, and a `role` (see next row) | One price list. The org only ever uses the standard price book. |
| `BRSS_HierarchySettings__c` product-id fields (ship to home, ship to Cornell, flat rate ×2, insurance, other non-boxed, packing ×2, pre-arrival) | `brss_products.role` | Record ids pasted into text settings become a column on the product. |
| `BRSS_HierarchySettings__c` other fields (tax %, authorization amount, max non-admin discount %, blocked days before an appointment, pre-arrival regions) | BRSS module settings (validated, edited in the console, logged) | The Stripe secret key moves to `.env.local` and is never stored in the database. |
| `BRSS_StorageTermProduct__c` | `brss_storage_term_products`: term months, overweight flag, product | Real foreign key to the product. |
| `Article__c` | `brss_articles`: article number, customer, type, description, weight, dimensions, status, product, additional insurance, other storage price, warehouse, section, row, pallet | Billable weight computed by one function (see question B7). |
| `OrderArticle__c` | `brss_order_articles`: order, article, Cornell-shipping-account flag, received-from zip | Many-to-many kept. The two text "relay" fields that flows used to push statuses are dropped; a service function does it directly. |
| `Appointment__c` | core `appointments` + `brss_appointments`: order, type (Pickup, Delivery, Packing, Supplies), region, building, address, room, elevator, phone, item estimates, packing hours, truck, crew | The five two-hour slots become `starts_at`/`ends_at`. "Truck En Route" maps to core status `in_progress`. The copied customer name, email and NetID fields are read from the customer instead. |
| `ApptNonavailability__c` | core `unavailability` + `brss_unavailability_buildings` (empty = everywhere) | Enforced on the server. Today it is only enforced by JavaScript in the customer's browser. |
| `Truck__c` (name, shared login user, five crew contacts) | core `resources` (kind `truck`) + `brss_truck_crew` | Shared truck logins go away: the locked decision is individual accounts. |
| `Warehouse__c` (per-line location) | Not carried over as it is. New `brss_warehouses` table (a real list of warehouses) and the location on the article. | Needs your answer to question B2. |
| `Payment__c` (Charge, Authorize, 0-Amount; card snapshot; manual refund fields) | core `payments` + `refunds` | Refunds become real records through the payment provider instead of a hand-ticked checkbox. Card numbers never touch our server. |
| `ZipZone__c` | `brss_zip_zones`: zip-prefix low, zip-prefix high, zone | Rule kept: the first three digits of the zip pick the zone. |
| `ZoneWeight__c` | `brss_zone_rates`: zone, weight (lb), ship-to-home price, ship-to-Cornell price | |
| `Region__c` and `Building__c` picklists (6 regions, 72 buildings) | `brss_regions`, `brss_buildings` (each building has a region and a campus category) | Managers can edit the list without a developer. Campus category becomes data instead of a hard-coded flow (question B9). |
| 14 active flows, 2 triggers, 1 workflow field update | Functions in `src/modules/brss/services/`, each with a test and a source citation | |
| ~12 active email rules | Core notifications, sent by the service function at the moment the event happens | Rules like "date = tomorrow" only fire today if someone happens to save the record that day; real reminders need a scheduler, which is out of scope for now. |
| `Quote__c`, `Move__c`, `Employment__c`, `fb_Fulfillment__c` | Not carried over | HHMC objects, a careers page, and an unused leftover. |

### 6.3 Rules confirmed in the source that will be ported

| Rule | Source |
|---|---|
| Order total = subtotal + tax + tip − discount; tax = (subtotal − discount) × tax rate. | `classes/BRSS_AmountInfo.cls:88-99` |
| A non-admin's discount is capped at a configured percentage; an admin's at 100%. | `classes/BRSS_OrderProcessingCtrl.cls:351-354` |
| Billable weight = the larger of actual weight and length × width × height ÷ divisor, rounded up; an article over 150 lb billable is rejected. | `objects/Article__c/fields/BillableWeight__c.field-meta.xml:6`, `objects/Article__c/validationRules/MaxBillableWeight.validationRule-meta.xml:6-7` |
| Storage price for a standard box = the term product's price × billable weight, using a separate overweight product at 70 lb or more; non-boxed and flat-rate items = unit price × months. If no product exists for the exact term, the nearest shorter term is used. | `classes/BRSS_OrderItemUtils.cls:78-121,447-458`, `classes/BRSS_SettingsUtils.cls:102-105,169-189` |
| Shipping price = the rate row for the zone and the exact billable weight; the zone comes from the first three zip digits. | `classes/BRSS_ZipZoneDAO.cls:10-26`, `classes/BRSS_ZoneWeightDAO.cls:16-57` |
| Storage effective date is set once, the first time a charge is recorded on an order that includes storage. | `flows/BRSS_StorageEffectiveDatePayment.flow-meta.xml:54-58,85-89,199-233` |
| Storage expiration = effective date + term months. | `objects/Order/fields/Storage_Expiration_Date__c.field-meta.xml:5` |
| Setting a warehouse, section, row or pallet on an article sets its status to Stored. | `workflows/Article__c.workflow-meta.xml:14-39` |
| Closing an order sets all of its articles to Delivered. | `flows/BRSS_Update_Order_Article_Status.flow-meta.xml:54-57`, `flows/BRSS_UpdateArticleStatusDelivered.flow-meta.xml:54-57,156-158` |
| Setting the order's "master article status" sets that status on all of its articles. | `flows/BRSS_MasterArticleStatus.flow-meta.xml`, `flows/BRSS_MasterArticleStatusStep2.flow-meta.xml` |
| A customer can cancel only an open order whose earliest appointment is after today; cancelling also cancels its appointments. | `classes/BRSS_OrderDetailsController.cls:87-90,178-206` |
| Changing an appointment's truck copies the truck's crew onto the appointment. | `flows/BRSS_TruckFieldRepUpdate.flow-meta.xml:187-310` |
| An unavailability record covering all five time slots is treated as all day. | `classes/BRSS_ApptNonavailabilityUtils.cls:36-59` |

### 6.4 Behaviour I will **not** copy unless you tell me to

These look like defects or unsafe practice in the current system. Each is an open question in section 8 where a business decision is needed.

| Current behaviour | Source | Plan |
|---|---|---|
| "Storage Delivery By" is one year late whenever start month + term is a multiple of 12 (April + 8, June + 6, August + 4 all give December of the *following* year). This date drives the delivery deadline and reminder. | `objects/Order/fields/StorageDeliveryBy__c.field-meta.xml:6-9` | Use plain calendar-month addition (question B6). |
| The crew's phone shows billable weight using ÷166; the price is calculated using ÷139. A box can be billed at a higher weight than the crew saw. | `classes/BRSS_ArticleDAO.cls:14` vs `objects/Article__c/fields/BillableWeight__c.field-meta.xml:6` | One divisor everywhere (question B7). |
| Records are saved first and the card is charged in a second request. If the second request never arrives, lines stay marked Paid with no payment. The undo on failure is best-effort and ignores errors. | `classes/BRSS_BasicOrderEditorController.cls:333-414`, `classes/BRSS_TransactionManager.cls:90-164` | Charge and save in one transaction with an idempotency key. |
| Card number and CVC pass through the server; the Stripe key is a plain-text setting. | `classes/BRSS_PaymentManager.cls:126-143`, `classes/BRSS_StripeRequest.cls:25-29` | Provider-hosted card entry only; key in the environment. |
| A missing rate row, zone or term product means the line is silently not billed. | `classes/BRSS_SettingsUtils.cls:175-188`, `classes/BRSS_OrderItemUtils.cls:129-170` | Show staff a clear "no price found" error instead of charging nothing. |
| Lead time and unavailability are checked only in the customer's browser; the server accepts any appointment. | `components/BRSS_Form_Appointment.component:117-148` | Check on the server. |
| West Campus (and everything except North Campus) is classed Off-Campus. | `flows/Appointment_Trigger_After_Save.flow-meta.xml:160-165` | Ask (question B9). |

---

## 7. Risks

| # | Risk | Effect | What I propose |
|---|---|---|---|
| 1 | **Unpushed work lives only in this cloud session.** I am running in a temporary cloud container, not on your machine. With the no-push rule, every commit exists only here, and the container is reclaimed after a period of inactivity. | A whole phase could be lost between checkpoints. | Your decision — question A1. |
| 2 | **The repository is public.** BRSS's business rules, price structure and the file layout of the private Salesforce repo will be readable by anyone once pushed, because the brief asks for ported rules with source citations. | Disclosure of internal business logic; none of it is credentials or customer data. | Your decision — question A2. I will not copy the org id, internal email addresses or personal names that appear in the private repo. |
| 3 | **BRSS staff screens are not in the reference repo** (section 6.1). | The Phase 4 staff portal is a new design, not a port. If it does not match how managers work, it gets rebuilt. | Question B1. A 30-minute walkthrough or screenshots from a BRSS manager before Phase 4 would remove most of this risk. |
| 4 | **Real prices, products, zone tables, tax rate and storage terms are org data and not in the repo.** | Seed data will be invented. Numbers on screen will look plausible but will not be BRSS's real prices. | Acceptable for a proof module; say if you want real tables loaded through the import tool instead. |
| 5 | **The Stripe adapter cannot be exercised against Stripe.** I may not create accounts and no test key exists. | It will be tested against recorded responses only. The mock provider is what actually runs. | Supply a `sk_test_` key in `.env.local` later if you want it verified end to end. |
| 6 | **The Microsoft and Google adapters cannot be exercised** without a tenant. | They are "ready to enable" but unverified until someone configures one. | Documented as such in `HANDOFF.md`. |
| 7 | **Scope.** Phase 2 (the whole console) is the largest phase by far. | Long phase, large review at Checkpoint 3. | I can split it into 2a (shell, sidebar, per-business tabs) and 2b (platform section, importer, executive view) with a checkpoint between, if you prefer smaller reviews. |
| 8 | **Row-level security adds a concept** students must learn (section 3, layer 3). | Slightly steeper onboarding. | Recommended anyway; easy to decline now, harder to add later. |
| 9 | **Framework churn.** Next.js and Drizzle both release often. | Upgrade work for future students. | Exact version pins, no experimental features, and an "upgrading" note in `HANDOFF.md`. |
| 10 | **Accent colours.** Five of the nine brand colours are reds within a narrow range and two are near-black. | Businesses are hard to tell apart in the sidebar. | I will adjust them in Phase 2 against real screenshots and record the final values in `DECISIONS.md`, as the brief asks. The monogram text carries the identity; colour only supports it. |
| 11 | **Reminder emails need a scheduler** ("the day before your pickup"). | Not possible with "no hosting, no job queue" yet. | Out of scope now; the notification interface is ready for it. Listed in `HANDOFF.md`. |

---

## 8. Questions only the CTO can answer

Each question has a default. "Go with the defaults" is a complete answer.

### A. Needed before Phase 1 starts

| # | Question | Default if you do not answer |
|---|---|---|
| A1 | **Pushing.** This session runs in a temporary cloud container, so unpushed commits can be lost. May I push phase branches at each checkpoint (never `main` without approval)? And which branch names: your phase names (`phase-1-core`), or the name this cloud session was configured with (`claude/sai-platform-foundation-xvvr2z`)? | No push. I keep working locally and repeat the warning at each checkpoint. |
| A2 | **Public repo.** Are you content for BRSS's ported business rules, with citations into the private Salesforce repo, to be public? If not, the simplest fix is to make `sai-platform` private before the first push. | Rules are documented in the repo as the brief asks. |
| A3 | **Dependencies** in section 1 (Radix/shadcn, `cmdk`, `recharts`, `arctic`, `stripe`): approve all, or name the ones to drop. | I wait; these need a yes. |
| A4 | **Row-level security** as a third enforcement layer (section 3): keep or drop? | Keep. |
| A5 | **Can one person hold a platform role and business roles at once?** For example, a President (executive, read-only) who also manages one business. | No. A user has either one platform role or business memberships. |
| A6 | **Tech and live data.** "Builds and tests in every module" — may `tech` create and edit *live* business records (a real BRSS order), or only sandbox records plus settings? | Tech can read and write live and sandbox data in every business; cannot purge; cannot change platform settings. |
| A7 | **Who manages people.** May `tech` create users and assign business roles? Who may grant `tech`, `executive` and `super_admin`? May a `business_admin` promote someone to `business_admin`, or only add `business_staff`? | Tech can create users and assign business roles. Only super_admin grants the three platform roles. A business_admin can add, change and remove both admins and staff of their own business, but cannot remove the last admin. |
| A8 | **What executives can open.** Dashboards only, or also each business's record-level data (customer names, addresses) and activity log, read-only? May they export? | Executives see the executive dashboard and every business's Overview, Data and Activity log, read-only, with no export. |
| A9 | **Business_admin and settings.** May a business_admin change their module's settings and portal toggles, or only tech and super_admin? May they export data (it contains customer details)? | Business_admins can view settings but only tech and super_admin change them. Business_admins can export their own business's data; every export is logged. |
| A10 | **Permanent delete and the log.** The log is append-only and stores "before" values. When a record is permanently deleted, should the log keep its full contents forever, or only who deleted what and when? | Keep only a tombstone (type, id, label, who, when) for the purge event. Earlier log entries about that record keep their before/after values. |
| A11 | **Sandbox.** Confirm sandbox data is always generated fake data, never a copy of live data. Who may reset a business's sandbox? | Fake data only. Tech, super_admin and that business's admin may reset. |
| A12 | **Imports.** After a file has been imported into the sandbox and checked, who may run the same import into live? | Tech and super_admin only, and only after a successful sandbox run of the same file and mapping. |

### B. BRSS questions — needed before Phase 4, best answered with a BRSS manager

| # | Question | Default if you do not answer |
|---|---|---|
| B1 | **Staff screens.** No custom staff screen exists to model (section 6.1). Can a BRSS manager describe or screenshot what they use day to day (order page, list views, reports)? | I design the staff portal from the data model, the rules and the existing list views, and you review it at the final checkpoint. |
| B2 | **Warehouses and locations.** What are the real warehouses (Mecklenburg, Lansing, Overflow, SAI Basement)? Location is stored three ways today: on the article (warehouse/section/row/pallet), on the order line (free text), and on the order ("Order Location"). Which one do staff actually use? | A warehouses table seeded with those four names; location recorded on the article as warehouse, section, row, pallet. |
| B3 | **Article status order.** Is the intended path: on truck to warehouse → in warehouse → stored → ready for delivery → on truck to delivery → delivered, with ready for shipment → shipped as the alternative ending? Should the new system enforce it, or allow any change as today? | That path is suggested by the interface; staff with permission can override to any status, and every change is logged. |
| B4 | **Manual status changes.** Nothing in the code ever sets an order to Activated or Closed, or an appointment to Confirmed, Truck En Route or Completed. Staff must do it by hand. When, and who? What does "Activated" mean? | All are manual actions in the staff portal, with the automatic consequences kept (closing an order marks its articles Delivered). |
| B5 | **Storage effective date.** Two active automations set it: the first charge on a storage order, and a completed pickup appointment (which says "not being used" but is switched on). Which is the rule? | First charge, as the payment flow says. The pickup rule is not ported. |
| B6 | **"Storage Delivery By" is a year late** for some start-month and term combinations (section 6.4). Confirm this is a bug and should not be reproduced. | Treated as a bug; plain month addition is used. |
| B7 | **Billable weight divisor:** 139 (what pricing uses) or 166 (what the crew sees)? | 139 everywhere, since that is what customers are charged on today. |
| B8 | **Capacity.** There is no limit on appointments per slot, day or truck. Is that right, with managers blocking time by hand? | No capacity limit; unavailability records only. |
| B9 | **Campus category.** As coded, only North Campus counts as On-Campus; West Campus is Off-Campus. Intended? When is "Counter" used? | Each building carries its own campus category as editable data, seeded as coded today. "Counter" can be set by hand. |
| B10 | **Intake.** Article intake and charging are done today on the crew's phone pages, which the brief treats as the later field portal. For Phase 4, should intake be a staff-portal screen that also works on a phone? | Yes: intake lives in the staff portal and is usable at 375px. No separate field portal. |
| B11 | **Truck crews.** Trucks have a shared login and up to five crew "contacts" today. In the new system, are crew members individual users with a BRSS role? | Yes, crew are users with BRSS `business_staff` membership. |
| B12 | **Fees that exist only as website text** (peak fee, late and missed appointment fees, $20 supplies minimum, packing hourly rate) are not in the code. Should the new system calculate any of them? | No. Staff add them as manual order lines, as today. |

Further BRSS questions of detail (about 80, each with a citation) are recorded in the analysis files and will be listed in the BRSS module's "open questions" in Phase 4 rather than asked here.
