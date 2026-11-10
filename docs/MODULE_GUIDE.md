# Module guide

How to build or change a business module. Read `docs/ARCHITECTURE.md` first.

A **module** is one folder, `src/modules/<key>/`, that exports one **manifest**. The manifest
tells the platform everything it needs: what the module is called, its permissions, its tables,
its screens, its dashboard numbers and its fake data. The console, the Data tab, People and
access, test mode, the importer and the executive dashboard are all driven by manifests. None of
them contains a business's name.

- The contract: `ModuleManifest` in `src/core/modules/contract.ts`.
- A working example to copy: `src/modules/_template/` (type-checked, not registered).
- The nine registered modules: `src/modules/registry.ts`.

## The contract

| Part of the manifest | What it is | What the platform does with it |
|---|---|---|
| `key` | The module's id. **Must equal the business's slug.** | Finds the module for a business. Prefix for permissions, entities and tables. |
| `name`, `version`, `status`, `description`, `plannedScope` | Facts about the module | Module registry, Settings tab, Overview "Module health", the "not built yet" page |
| `permissions` | Things a person can be allowed to do, e.g. `brss.orders.read` | Added to the permission matrix; grantable to staff in People and access; listed in `docs/PERMISSIONS.md` |
| `entities` | One entry per table: its label, columns to show, search fields, permissions | Data tab (browse, search, export, archive, restore, permanent delete), test-mode reset, automatic isolation and audit tests |
| `portals.staff` | Navigation and routes of the staff portal | The App tab renders these pages |
| `portals.customer`, `portals.field` | Optional. Same shape. | Served at `/portal/<business>` and `/field/<business>` once the toggle in Settings is on |
| `widgets` | Key numbers | Overview tab |
| `workItem` | The module's main unit of work ("Orders") | Executive dashboard |
| `settings` | A schema, defaults and form fields | Settings tab (changed by the tech team, logged) |
| `featureFlags` | Flags the module understands | Suggested in Platform → Feature flags |
| `seedDemoData` | A function that inserts fake data | Fills the sandbox and the local demo database |
| `healthChecks` | Optional checks | Overview and Platform → System health |

## Folder layout

```
src/modules/<key>/
  manifest.ts       The manifest. The only file the platform imports.
  schema.ts         Tables, created with tenantTable()
  permissions.ts    Permission keys and definitions
  entities.ts       One EntityDef per table
  services/         Business logic: plain functions taking (ctx, input)
  pages/            Screens (React server components) for the portals
  seed.ts           Fake data
  README.md         What the module does, the rules it implements, open questions
```

## Checklist: adding a module for a new business

Nothing in `src/core/` or `src/app/` changes. If you find yourself editing those, stop: either
the contract already has what you need, or the contract needs a change the tech lead should
review.

1. **Pick the key.** Lowercase letters only, the same as the business's slug (`tut`, `brss`).
2. **Add the business** to `src/seed/businesses.ts` if it is not there (name, slug, short code,
   accent colour, description). Businesses are data.
3. **Copy the template:** `cp -r src/modules/_template src/modules/<key>` and replace every
   `template` with your key (file contents, table names, permission keys, entity keys).
4. **Register it:** add one import and one entry in `src/modules/registry.ts`.
5. **Define the tables** in `schema.ts`. Use `tenantTable()`; link tenant tables with
   `sameTenant()`; prefix table names with the key.
6. **Create the migration:** `npm run db:generate`, read the generated SQL in `db/migrations/`,
   then `npm run db:migrate`.
7. **Define permissions** (`permissions.ts`) and **entities** (`entities.ts`). Register *every*
   table as an entity, parents before children.
8. **Write services** in `services/`. Reads use `withScope` + `listRecords`/`getRecord` (or a
   query that includes `s.where(table)`); writes use `createRecord`, `updateRecord`,
   `archiveRecord`, `restoreRecord`. Never write another way.
9. **Write pages** in `pages/` and list them in `portals.staff.routes`. Each route names the
   permission needed to open it.
10. **Write `seed.ts`** with fake data for every table.
11. **Fill in** `widgets`, `workItem`, `settings` as needed.
12. **Regenerate the permissions doc:** `npm run docs:permissions`.
13. **Run everything:** `npm run check` and `npm run test:e2e`. The registry-driven tests now
    cover your module automatically: tenant isolation for every entity, archive/restore
    logging, executive read-only, sandbox reset.
14. **Add tests for your own rules** in `tests/integration/<key>.test.ts`, and write the rules
    down in the module's `README.md`.
15. **Look at it:** `npm run db:reset && npm run dev`, sign in as the business's admin, open the
    App tab, try test mode.

## Checklist: turning a scaffold into a real module

Scaffolded modules (`status: 'scaffold'`) call `scaffoldModule()` and show a "not built yet"
page. To build one, do steps 3–15 above inside its existing folder, replacing the
`scaffoldModule(...)` call with `defineModule({ ... })`. Keep the export name, so
`registry.ts` does not change.

## Rules a module must follow

Most are enforced by the type checker, ESLint or a test, and say so when broken.

| Rule | Enforced by |
|---|---|
| Tables are created with `tenantTable()` | Test: every table with a `business_id` has row-level security |
| Links between tenant tables use `sameTenant()` | Test: every such foreign key includes business and environment |
| Every table is registered as an entity | Test |
| Permission, entity and table names start with the module key | `validateRegistry()` (test + System health) |
| No direct database access; no `txOf`; no platform tables | ESLint |
| Never import from `src/app` | ESLint |
| Writes go through the record functions | The query handle a module receives cannot write |
| Effects outside the database (payments, email, files) go through the core services | Review |
| Fake data only in `seed.ts` | Review |
| Do not name another business anywhere in the module | Review |

## Turning on a customer or field portal later

1. Add `portals.customer` (or `portals.field`) to the manifest: `nav` and `routes`, exactly like
   the staff portal.
2. The tech team switches the toggle on in the business's Settings tab.

That is all the platform needs; the hosting routes already exist. What is **not** decided is how
customers sign in (see `docs/HANDOFF.md`). Until it is, those portals use the console's login.

## Common mistakes

- **A query returns nothing.** It is not inside `withScope()`, or it lacks `s.where(table)`.
- **"A linked record does not exist in this business."** A link points at a row of another
  business or of the other environment (live vs sandbox), or at nothing.
- **A new table is missing from the Data tab.** It is not in the manifest's `entities`.
- **A staff member cannot open a page.** The route's permission is not granted to them; a
  business admin switches it on in People and access.
- **The sandbox reset fails.** An entity is listed before the entity it depends on.
