# The project brief

This is the CTO's brief for the build, kept here so any session (or reviewer) can read the
requirements without the original conversation. Decisions taken since are in `DECISIONS.md`.

## Objective

Build the foundation of one proprietary software platform for Student Agencies Inc. (SAI):

1. The **SAI Console**, a single web app. You log in, the businesses are listed in a left
   sidebar, and the tech team can see, manage, test and change every business's software from it.
2. The **shared core** that every business module is built on.

After that, scaffold a module for each business. Then build one realistic proof module, a
**BRSS staff portal** modelled on the current Salesforce system, to show the core works.

Optimize for correctness, clear structure, and maintainability by a small student tech team that
turns over every year and builds mostly with Claude. Clever code that is hard to maintain is a failure.

## Context (locked decisions)

- SAI is an umbrella company with 9 student-run businesses running on third-party tools
  (Movegistics, Salesforce, AppFolio, Shopify), to be replaced by one SAI-owned platform.
- **One platform, a module per business.** One codebase and one login. A shared core provides
  login, users, roles, customers, payments, scheduling, notifications, files, the activity log and
  analytics. Each business is a module on top of the core, and its data stays strictly separate.
- **Module order:** #1 Hired Hands Moving Company (HHMC), #2 Student Agencies Real Estate (SARE).
  **Do NOT build HHMC or Real Estate features.** Scaffold their modules only.
- **Individual accounts.** Every person has their own account and is assigned to one or more
  businesses, with a role in each.
- **Roles (locked):**
  - `super_admin` (CTO): everything, including permanent deletion and platform settings.
  - `tech`: builds and tests in every module and manages module settings. Cannot permanently
    delete. Cannot change super_admin settings.
  - `executive` (CEO, President): a read-only, cross-business overview and analytics. No edits, no deletes.
  - `business_admin`: full day-to-day use of their own business only. Manages their own staff's
    access. Cannot permanently delete. Cannot see other businesses.
  - `business_staff`: day-to-day use of their own business only, limited to what their business_admin grants.
- **Three portal types per module:** staff (every module), customer (some), field (mobile, for
  crews). All share one login system and one data layer. Build only staff portals now, but design
  the core so any module can turn on a customer or field portal later without restructuring.
- **Deletion is safe by default.** "Delete" means archive (soft delete, recoverable). Only
  super_admin can permanently delete, and only records archived for longer than a configurable
  retention window (default 30 days).
- **Everything is logged.** Every create, update, archive, restore, permanent delete, permission
  change and login goes to an append-only activity log: who, what, when, which business, before and after.
- **Login identity is undecided.** Build auth behind a provider-agnostic layer with a dev-only
  login. Leave Microsoft and Google sign-in as ready-to-enable adapters, NOT configured.
- **No hosting yet.** Everything runs locally with one documented command. No sign-ups, deploys or paid services.
- **BRSS reference code:** `../brss-salesforce` (read-only).

## The 9 businesses

Seeded as data: name, slug, short code, accent colour, description, enabled modules and portals.
NEVER hardcode businesses in components. Accent colours are starting points; adjust until each is
distinguishable in the sidebar and record final values in `DECISIONS.md`.

| # | Name | Code | Accent | Description | Module status |
|---|------|------|--------|-------------|---------------|
| 1 | Hired Hands Moving Company | HHMC | blue `#1F4E9C` (orange `#F28C28` secondary) | Student moving company | Module #1, scaffold only |
| 2 | Student Agencies Real Estate | SARE | slate gray `#5A5A5A` | Leasing and management of SAI's owned and affiliated properties: apartments, commercial spaces, eHub (replacing AppFolio) | Module #2, scaffold only |
| 3 | Big Red Shipping & Storage | BRSS | red `#E2231A` on black | Shipping and storage for the Cornell community; Cornell's preferred vendor | Proof module (Phase 4) |
| 4 | The Cornellian | CORN | near-black `#1A1A1A` | Cornell University's official yearbook | scaffold only |
| 5 | Cornell Freshman Register | CFR | red `#C8102E` | First-year guide produced by The Cornellian | scaffold only |
| 6 | Student Agencies Tutoring | TUT | maroon `#8B1E2D` | Tutoring service | scaffold only |
| 7 | Cornell Bigger Beds | CBB | dark red `#9B1C1C` | Dorm bed extension service | scaffold only |
| 8 | Big Red Mailroom | BRM | brick red `#B3322A` | Mailroom service | scaffold only |
| 9 | Campus Promotions | CP | black `#111111` | Marketing campaigns for local and national businesses targeting Cornell and Ithaca College students | scaffold only |

## Target state

- **SAI Console:** login → home → left sidebar with a "Platform" section and the 9 businesses
  (each person sees only what their role allows). For each business:
  - **Overview:** key numbers, recent activity, module health
  - **App:** the business's staff portal, embedded in the console
  - **People and access:** who has access and with which role; business_admins manage their own staff here
  - **Data:** browse, search and export records; archive and restore; permanent delete visible only to super_admin
  - **Activity log:** filterable
  - **Settings:** module configuration and portal toggles
  - **Test mode:** switch between live data and a sandbox copy seeded with fake data
- **Platform section (super_admin and tech):** all users and roles across businesses, the module
  registry (what each business has enabled, its version and status), feature flags per business,
  the global activity log, a data import tool framework (CSV → mapped fields → dry-run preview →
  import into sandbox first), and system health.
- **Executive view:** a read-only cross-business dashboard (orders, revenue, activity and trends
  per business, with all-SAI totals).
- **Shared core:** tenancy, auth, RBAC, audit log, soft delete and retention, customers, payments
  interface (Stripe adapter in test mode only, no keys committed), scheduling primitives,
  notifications interface (email adapter that logs to the console in dev), file storage interface
  (local disk in dev), and analytics query helpers.
- **A module system:** a documented module contract (manifest, routes, permissions, data models,
  seed data, dashboard widgets, portals). Adding a module follows a checklist in `docs/MODULE_GUIDE.md`.
- **9 scaffolded modules** that register correctly and show a clean "not built yet" staff portal
  with the module's description and planned scope.
- **The BRSS proof module** (Phase 4).
- **Docs:** `README.md` (setup in under 10 minutes), `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`,
  `docs/MODULE_GUIDE.md`, `docs/PERMISSIONS.md` (the full role × action matrix), `docs/HANDOFF.md`.

## Phases

- **Phase 1: shared core.** Tenancy, auth (dev login plus inactive SSO adapters), RBAC, the
  activity log, soft delete and retention, and the core services, with seed data: the 9 businesses
  and fake users covering every role. Tenant isolation and permissions MUST be enforced in the
  data access layer, not just hidden in the UI. Tests must prove:
  - a business_admin of business A cannot read or write business B through any route or API
  - executive cannot write anything
  - only super_admin can permanently delete, and only past retention
  - every mutation produces an activity log entry
- **Phase 2: SAI Console.** The full console shell and everything under Target state except
  module internals. A polished internal product (think Linear or Vercel's dashboard): calm, dense
  but readable, fast sidebar, keyboard-friendly, consistent components, each business's accent
  colour used as an accent only. No brand logos; a coloured monogram (the short code) per business.
  Must work at 1440px and at 375px.
- **Phase 3: module scaffolds.** Register all 9 modules through the module contract. HHMC and SARE
  stubs list their planned scope as "pending requirements". The rest get a placeholder with their description.
- **Phase 4: BRSS proof module (staff portal only).** Entirely new and custom; do NOT imitate
  Salesforce's look. Model it on what the Salesforce org actually does:
  - orders dashboard (filter by status, campus/region, date)
  - order detail (customer, articles and their status/location, payments, appointments)
  - appointment scheduling, including unavailability
  - article intake and status updates through storage and delivery
  - warehouses and trucks
  - pricing and storage term products
  - zip zones

  Port the business rules found in the Apex and flows. Document each ported rule and cite the
  source file and line. If a rule is ambiguous, list it under "open questions"; don't guess. Use
  realistic fake seed data only. Payments use the Stripe test adapter or a mock. Add the BRSS
  numbers to the executive dashboard.

## Hard constraints

- NEVER modify, commit to, or push `../brss-salesforce`. NEVER run Salesforce CLI (`sf`/`sfdx`). Read files only.
- NEVER force-push. NEVER rewrite `main`'s history.
- NEVER use real customer data, real credentials, or live API keys. Secrets go in `.env.local`
  (git-ignored) with a committed `.env.example` of names only. Run the secret scan before every commit.
- NEVER deploy, host, register domains, or create accounts on any external service.
- Only build what the brief asks for. No extra features, speculative abstractions, or HHMC and SARE functionality.
- No new non-trivial dependencies beyond those approved (DECISIONS A3).

## Acceptance criteria (final)

- A fresh clone runs locally with one documented setup sequence and seeds all 9 businesses plus test users for every role
- All permission and tenant-isolation tests pass; `docs/PERMISSIONS.md` matches what the tests check
- Logging in as each seed role shows exactly the sidebar, data and actions that role allows
- Archive → restore works; permanent delete is only possible for super_admin and only past retention; every action appears in the activity log
- Test mode clearly separates sandbox data from live data, with a persistent visual indicator
- All 9 modules are registered; adding a 10th by following `MODULE_GUIDE.md` requires no core changes
- The BRSS staff portal covers the listed workflows end to end on seed data, with ported rules documented and source-cited
- Typecheck, lint, unit and end-to-end tests all pass; the secret scan is clean

## How the work is run (set at Checkpoint 1)

Claude works autonomously through Phases 1–4 in a loop: plan the next smallest task from
`PROGRESS.md` → build on the phase branch → verify (typecheck, lint, tests, secret scan) → at the
end of each phase and after any change to auth, permissions, tenancy or deletion, an independent
reviewer subagent checks the diff and every confirmed finding is fixed → from Phase 2 on, a UI
gate (every seed role, every screen, screenshots at 1440px and 375px into
`docs/screenshots/<phase>/`) → commit, push, update `PROGRESS.md` → when every gate passes, merge
the phase branch into `main` with a merge commit and push.

When something would normally need the CTO, choose the safest reversible option, record it in
`DECISIONS.md` marked **NEEDS JAI REVIEW**, and keep going. If the same failure persists after 3
genuine fix attempts, log it as a blocked defect in `PROGRESS.md` and move on.
