# Module guide

How to build or change a business module. Read `docs/ARCHITECTURE.md` first.

A **module** is one folder, `src/modules/<key>/`, that exports one **manifest**. The manifest
tells the platform everything it needs: what the module is called, its permissions, its tables,
its screens, its dashboard numbers and its fake data. The console, the Data tab, People and
access, test mode, the importer and the executive dashboard are all driven by manifests. None of
them contains a business's name.

- The contract: `ModuleManifest` in `src/core/modules/contract.ts`.
- A working example to copy: `src/modules/_template/` (type-checked, not registered).
- A complete real module to learn from: `src/modules/brss/` (start with its `README.md`, then `rules.ts`).
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
  actions.ts        Server actions: what the screens' forms and buttons call
  seed.ts           Fake data
  README.md         What the module does, the rules it implements, open questions
```

## Checklist: adding a module for a new business

Nothing in `src/core/` or `src/app/` changes. If you find yourself editing those, stop: either
the contract already has what you need, or the contract needs a change the tech lead should
review.

1. **Pick the key.** Lowercase letters only, the same as the business's slug (`tut`, `brss`).
2. **Add the business** to `src/seed/businesses.ts` if it is not there (name, slug, short code,
   accent colour, description), and add a test login for its admin in `src/seed/users.ts`
   (copy an existing `<slug>.admin@sai.example` entry). Businesses are data.
3. **Copy the template:** `cp -r src/modules/_template/. src/modules/<key>/` and replace every
   `template` with your key (file contents, table names, permission keys, entity keys). Then
   set the module's real `name`, `description` and `plannedScope` in `manifest.ts`, remove the
   "TEMPLATE —" notes at the top of each file, and rewrite `README.md` for your module.
4. **Register it:** add one import and one entry in `src/modules/registry.ts`, in the same
   position as the business has in `src/seed/businesses.ts` (a test compares the two lists).
5. **Define the tables** in `schema.ts`. Use `tenantTable()`; link tenant tables with
   `sameTenant()`; prefix table names with the key.
6. **Create the migration:** `npm run db:generate`, read the generated SQL in `db/migrations/`,
   then `npm run db:migrate`.
7. **Define permissions** (`permissions.ts`) and **entities** (`entities.ts`). Register *every*
   table as an entity, parents before children.
8. **Put business rules in `rules.ts`** as plain functions (no database), one per rule, each
   with a test. Then **write services** in `services/`. Reads use `withScope` + `listRecords`/`getRecord` (or a
   query that includes `s.where(table)`); writes use `createRecord`, `updateRecord`,
   `archiveRecord`, `restoreRecord`. Never write another way.
9. **Write pages** in `pages/` and list them in `portals.staff.routes`. Each route names the
   permission needed to open it. Forms and buttons call **server actions** in `actions.ts`
   (see below).
10. **Write `seed.ts`** with fake data for every table: at least two rows per table (the
    automatic tests archive one row and compare it with another).
11. **Fill in** `widgets`, `workItem`, `settings` as needed.
12. **Regenerate the permissions doc:** `npm run docs:permissions`.
13. **Run everything:** `npm run check` and `npm run test:e2e`. The registry-driven tests now
    cover your module automatically: tenant isolation for every entity, archive/restore
    logging, executive read-only, sandbox reset.
14. **Add tests for your own rules** in `tests/integration/<key>.test.ts`, and write the rules
    down in the module's `README.md`.
15. **Look at it:** `npm run db:reset && npm run dev`, sign in as the business's admin (the
    login you added in step 2, or the tech user), open the App tab, try test mode.

## Checklist: turning a scaffold into a real module

Scaffolded modules (`status: 'scaffold'`) call `scaffoldModule()` and show a "not built yet"
page. To build one, do steps 3–15 above inside its existing folder. The copy command in step 3
overwrites the scaffold's `manifest.ts` and `README.md` with the template's; that is intended:
you are replacing the `scaffoldModule(...)` call with a full `defineModule({ ... })`. Keep the
export name the scaffold had (for example `tutModule`), so `registry.ts` does not change.

Two businesses are held back on purpose: a test (`tests/integration/modules.test.ts`, "…are
scaffolds whose scope is pending requirements") fails if anything is built in their folders.
Remove a business from that test only when the CTO says its requirements are agreed.

## Server actions in a module

A page shows data; a server action changes it. Put a module's actions in
`src/modules/<key>/actions.ts`, starting with `'use server'`. Every action follows one shape:

```ts
export async function createItemAction(slug: string, mode: string, _previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return act(async () => {
    const ctx = await requireStaffPortalContext(slug, parseMode(mode)); // who is asking, for which business, live or test
    await createItem(ctx, { name: text(formData, 'name') });           // the service checks permission and writes the log
    return 'Added.';
  });
}
```

- `requireStaffPortalContext` and `parseMode` come from `@/server/session`; `act` and `text`
  from `@/server/actions`.
- `requireStaffPortalContext` checks who is signed in, that they belong to this business, that
  they may open the staff portal, and that the portal is switched on. (Switching a portal off
  in Settings therefore stops its actions too, not only its screens.)
- The page binds the business and mode: `createItemAction.bind(null, ctx.business.slug, ctx.environment)`
  and passes the result to `<ActionForm>` or `<ConfirmButton>` (from `@/ui`).
- **Everything an action receives is untrusted**, including the slug and ids: anyone signed in
  can call it with any values. Never skip `requireStaffPortalContext`, and let the service
  decide what is allowed.

## Rules a module must follow

Most are enforced by the type checker, ESLint or a test, and say so when broken.

| Rule | Enforced by |
|---|---|
| Tables are created with `tenantTable()` | Test: every table outside the platform schema has the business columns and row-level security |
| Links between tenant tables use `sameTenant()` | Test: every such foreign key includes business and environment |
| Every table is registered as an entity | Test |
| Permission keys, entity keys and table names start with the module key | `validateRegistry()` (test + System health) |
| No direct database access; no `txOf`; no platform tables | ESLint |
| Never import from `src/app` | ESLint |
| Writes go through the record functions | The query handle a module receives cannot write |
| Effects outside the database (payments, email, files) go through the core services | Review |
| Fake data only in `seed.ts` | Review |
| Do not name another business anywhere in the module | Review |
| A route's `component` is a plain server-side function (no `'use client'`, no React hooks) | Review |

**About route pages.** The platform calls a route's `component` itself, as an ordinary (usually
`async`) function, so that a page which finds nothing — or is refused by the core — becomes a
normal "not found" page. That only works for a server component. If a page needs something
interactive (a form that reacts as you type), put that part in its own `'use client'` file and
render it *from* the page; do not register the client component as the route. Errors thrown by
components *nested inside* a page are not turned into "not found", so do the loading (and so the
permission checks) at the top of the page function.

## Turning on a customer or field portal later

1. Add `portals.customer` (or `portals.field`) to the manifest: `nav` and `routes`, exactly like
   the staff portal.
2. The tech team switches the toggle on in the business's Settings tab.

That is all the platform needs; the hosting routes already exist. One thing to add when the
first such portal is built: its server actions need their own version of
`requireStaffPortalContext()` in `src/server/session.ts` (that one checks the *staff* portal's
switch and the staff "open the portal" permission). What is **not** decided is how
customers sign in (see `docs/HANDOFF.md`). Until it is, those portals use the console's login.

## Common mistakes

- **A query returns nothing.** It is not inside `withScope()`, or it lacks `s.where(table)`.
- **"A linked record does not exist in this business."** A link points at a row of another
  business or of the other environment (live vs sandbox), or at nothing.
- **A new table is missing from the Data tab.** It is not in the manifest's `entities`.
- **A staff member cannot open a page.** The route's permission is not granted to them; a
  business admin switches it on in People and access.
- **The sandbox reset fails.** An entity is listed before the entity it depends on.
- **Two people did the same thing at the same moment and it happened twice.** Call
  `takeLock(s, 'some-name')` (`@/core/db/lock`) at the start of the service, before reading the
  rows it decides on. For running numbers use `nextRecordNumber()` (`@/core/records/numbering`).
- **A service throws instead of returning a rejected promise.** Declare service functions
  `async`, so a validation error always arrives the same way.
- **"Cannot read properties of undefined" as soon as the app or a test starts.** A file in the
  module uses a *value* from one of the core's services at the top level of the file (outside
  any function), for example `const schema = someCoreSchema.extend(...)`. The core and the
  modules import each other, so at that moment the value may not exist yet. Calling the
  building blocks at the top level is fine and expected (`tenantTable()`, `sameTenant()`,
  `defineModule()`, zod's `z.object()`); everything from a core *service* (people, payments,
  scheduling, …) should be used inside functions only.
