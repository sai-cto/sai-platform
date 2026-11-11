# Decisions

Every decision that shaped the platform, each with a short why. Newest phases at the bottom.

Items marked **NEEDS JAI REVIEW** were decided by Claude while working autonomously, choosing the
safest reversible option. They are collected in the first table so they are easy to find.

## Awaiting the CTO's review

| # | Decision | Chosen because | How to change it |
|---|---|---|---|
| R-1 | A business admin can add a person who has no account yet; the account is created on the spot (name + email). | Otherwise every new hire needs the tech team. The account can do nothing outside that business. | `addMember()` in `src/core/people/memberships.ts` |
| R-2 | New staff start with `customers.read` and `scheduling.read` plus their module's defaults. | Staff with nothing granted cannot do any work; these two are read-only. | `DEFAULT_STAFF_GRANTS` in the same file |
| R-3 | Sessions last 12 hours, then you sign in again. | A working day. Shorter annoys; longer leaves shared computers signed in. | `SESSION_HOURS` in `src/core/auth/session.ts` |
| R-4 | Changing someone's platform role, or deactivating them, signs them out everywhere at once. | A demoted person should not keep their old access until their session expires. | `setPlatformRole()` / `setUserActive()` |
| R-5 | A record that other records still refer to cannot be permanently deleted until those are deleted first (no cascading purge). | Permanent delete is irreversible; refusing is safer than silently deleting dependants. | `purgeRecord()` in `src/core/records/records.ts` |
| R-6 | Microsoft / Google sign-in never creates an account. It only signs in someone who already has one, matched by a provider-verified email. | Prevents anyone with a company email getting in before they are given a role. | `loginWithIdentity()` in `src/core/auth/login.ts` |
| R-7 | Tech can deactivate ordinary accounts, but only a super admin can deactivate (or reactivate) an account holding a platform role. | Follows "only super admin grants platform roles": switching the account off is removing the role in effect. | `setUserActive()` |
| R-11 | Microsoft sign-in accepts any account in SAI's directory, guests included (details: G1-16 below). | See G1-16. | See G1-16 |
| R-9 | Row-level security covers tenant tables only; platform tables rely on the core's checks and a lint rule (details: G1-10 below). | See G1-10. | See G1-10 |
| R-10 | Sessions have no idle timeout and expired session rows are not cleaned up (details: G1-11 below). | Needs a scheduled job, which needs hosting. | See G1-11 |
| R-12 | Accent colours of six businesses were changed from the brand colours so they can be told apart (table under P2-1). | The brief asked for this; the exact colours are a judgement call. | `src/seed/businesses.ts`, then `npm run db:seed` |
| R-14 | During an import, real data sits in the business's sandbox until it is reset (P2-14). | A11 and A12 pull in different directions. | Decide whether imports need a separate staging area |
| R-13 | Customer and field portals would use the console's login and roles (P2-9). | No such portal exists yet. | Decide with the identity provider |
| R-8 | Next.js "Cache Components" is switched off; every page renders per request. | Every console page depends on who is signed in. Per-request rendering is the simplest model for students. Next.js says the feature becomes mandatory in the next major version: see HANDOFF. | `next.config.ts` |

| R-15 | **BRSS: twelve business questions (B1–B12) and seven related choices (B13–B19)** were answered without a BRSS manager, each with the most conservative reasonable option. B11 differs from the default stated at Checkpoint 1. | The CTO asked for this. | Table "BRSS business questions" near the end of this file; each is a small change in `src/modules/brss/` |
| R-16 | Switching a business's staff portal off stops its buttons and forms as well as hiding its screens (P3-8). | Found at the Phase 3 review gate. | `requireStaffPortalContext()` in `src/server/session.ts` |
| R-17 | Every form in the console now keeps what was typed when the server refuses it (P4-6). | Found at the Phase 4 UI gate. | `src/ui/action-form.tsx` |
| R-19 | **Customer links** (P5-1): a small core addition, approved by the CTO on 11 Nov 2026 — signed, expiring, single-purpose links for customers without an account. | The smallest way to let a customer sign and pay without deciding the sign-in provider. | `src/core/links/links.ts` |
| R-20 | **HHMC: the choices in P5-5 … P5-14 and the ref §11 answers (H1–H14)** were made without an HHMC manager, each the safest reversible option. | No manager was available during the build. | Each row names where to change it |
| R-21 | **HHMC go-live choices (P5-15 … P5-26) and the updated H4** were made autonomously, each the safest reversible option (never overcharge, never send a real message, never lose data). | The CTO asked for the loop to run without stopping for questions. | Each row names where to change it |
| R-22 | **Phase 4 was merged into `main` before its own review gate had finished** (PROGRESS said "running"). | The CTO asked for Phase 4 and 5 on `main`; Phase 4 had passed its checks, e2e and UI gate, and HHMC's three review rounds covered the shared code it touches. | Run a review of `src/modules/brss` if wanted |
| R-23 | **Pilot mode** (P5-31 … P5-37): the hosted site runs with real HHMC data, Microsoft sign-in only, no customer email and no live card payments, on free plans. | The CTO chose "real data, staged" on 11 Nov 2026; hosting plans to be decided later. | `PILOT_MODE`, `src/core/demo/pilot.ts` |
| R-24 | **Phase 5C (HHMC on real data):** P5C-1, P5C-4, P5C-6, P5C-8 … P5C-12, P5C-14 are NEEDS JAI REVIEW — local-only real import (not sandbox-first), totals-only history (no line items), unmatched estimates, no-contact email days, Cornellian on packing, 150-mile cut-off, no maps key, packing-labor rate and trucks, branding placeholders. | The managers' written input and the CTO's Phase 5C prompt; conservative where they were silent. | See "Phase 5C" at the end of this file. |
| R-18 | Two small additions to the shared core for BRSS: `takeLock()` and `nextRecordNumber()` (P4-4). | A module cannot reach the database transaction itself, by design. | `src/core/db/lock.ts`, `src/core/records/numbering.ts` |

## Locked by the brief (not Claude's to change)

- One platform, one module per business, one login.
- Five roles: `super_admin`, `tech`, `executive`, `business_admin`, `business_staff`.
- Three portal types per module: staff, customer, field. Only staff portals are built now.
- Delete means archive. Permanent delete: super admin only, past a configurable retention window (default 30 days).
- Everything is logged to an append-only activity log.
- Sign-in sits behind a provider-agnostic layer with a dev-only login; Microsoft and Google adapters exist but are not configured.
- Runs locally with one command. No hosting, no paid services, no real data or credentials.
- Businesses are seeded as data and never hardcoded in components.

## Approved at Checkpoint 1 (10 Nov 2026)

| # | Decision | Why |
|---|---|---|
| A1 | Push phase branches (`phase-N-…`) at each step; merge into `main` with a merge commit when a phase passes its gates. | Work must survive the temporary cloud session. Phase names were chosen over the session's auto-generated branch name. |
| A2 | The repository is private. | So BRSS business rules and citations into the private Salesforce repo can be documented. |
| A3 | Dependencies beyond the default stack: Radix UI + lucide icons (shadcn style), `cmdk`, `recharts`, `arctic`, `stripe` (test mode, no keys). Nothing else non-trivial may be added. | Each replaces security- or accessibility-sensitive code we would otherwise write by hand. |
| A4 | Row-level security in Postgres as a third enforcement layer. | The team turns over yearly; a forgotten filter must fail closed. |
| A5 | A person has a platform role OR business memberships, never both. | Avoids an executive (read-only) who can also edit one business. |
| A6 | `tech` can read and write live and sandbox data in every business; cannot purge; cannot change platform settings. | "Builds and tests in every module." |
| A7 | Tech creates users and assigns business roles. Only super admin grants the three platform roles. A business admin manages admins and staff of their own business; the last admin cannot be removed. | Matches "manages their own staff's access" without locking a business out. |
| A8 | Executives see the executive dashboard and every business's Overview, Data and Activity log, read-only, with no export. | "Read-only, cross-business overview and analytics." |
| A9 | Business admins can view module settings; only tech and super admin change them. Business admins can export their own data; every export is logged. | "Tech … manages module settings." |
| A10 | A permanent delete leaves a tombstone in the log (type, id, label, who, when), not the record's contents. Earlier entries about the record are kept. | Otherwise "permanently deleted" data would live on in the log. |
| A11 | Sandbox data is always generated fake data, never a copy of live. Tech, super admin and that business's admin may reset it. | No customer data in a place meant for experiments. |
| A12 | Importing into live is for tech and super admin only, and only after the same file and mapping succeeded in the sandbox. | "Import into sandbox first." |

## Stack

| Choice | Why |
|---|---|
| TypeScript (strict), Next.js 16 App Router, React 19 | The brief's default. Server components and server actions: no separate API project. |
| PostgreSQL 17 in Docker Compose | The brief's default; every student gets the same database with one command. |
| Drizzle ORM 0.45 + drizzle-kit, `postgres` driver | Tables are plain TypeScript inside each module's folder; `tenantTable()` shares the standard columns and security policies, which Prisma's schema language cannot do. The stable 0.45 line is used, not the 1.0 release candidate. |
| Tailwind CSS 4 | The brief's default. |
| Vitest against a real Postgres test database | Tenant-isolation tests are only meaningful against the real database. |
| Playwright | The brief's default; also used for screenshots. |
| Zod | One schema validates a form, a server action and an import row. |
| npm | Ships with Node. |
| No auth framework | Sessions are ~80 lines we own (`src/core/auth/session.ts`), so sign-ins go straight into our activity log and changing identity provider touches one folder. |
| System fonts | No font download from a third party at build time. |

## Phase 1 — shared core

| # | Decision | Why |
|---|---|---|
| P1-1 | Business slugs are the lowercase short codes (`hhmc`, `sare`, `brss`, `corn`, `cfr`, `tut`, `cbb`, `brm`, `cp`), and a module's key equals its business's slug. | One identifier per business in URLs, folders and data. |
| P1-2 | `.env.example` holds names only; `npm run setup` generates `.env.local` with random local database passwords. | The brief requires names only; nothing resembling a password is committed. |
| P1-3 | Two database roles: `sai_owner` runs migrations, `sai_app` runs the app and cannot bypass row-level security. | Row-level security does not apply to a table's owner. |
| P1-4 | The live/sandbox mode is part of the URL (`/console/brss/sandbox/…`), not a cookie. | Two browser tabs can never disagree about which data is on screen. |
| P1-5 | A business the user cannot open returns "not found", never "forbidden". | Does not reveal which businesses exist. |
| P1-6 | The query handle given to modules is read-only by type; writes exist only as the five record functions. | Makes "every mutation is logged" a property of the structure. |
| P1-7 | A failed card attempt is stored as a `failed` payment row. | Leaves a trace for staff; nothing is marked paid. |
| P1-8 | The payment provider is called first, then the payment row is written in the caller's transaction, with an idempotency key. | Replaces the Salesforce "save, then charge in a second request" flow (known-issues KI-3). |
| P1-9 | Cross-business analytics read live data only. | Sandbox experiments must never appear on the executive dashboard. |
| P1-10 | `seedRecords()` (bulk insert without per-row log entries) works only in the sandbox or for the seed script's system actor. | A reset would otherwise write hundreds of log rows; the lock keeps it from ever writing live data for a real person. |
| P1-11 | Every tenant table must be registered as an entity; a test fails otherwise. | Guarantees the isolation and audit tests cover every table, including future modules'. |
| P1-12 | The Phase 0 plan file was removed once its content moved into ARCHITECTURE, DECISIONS and PERMISSIONS. | One source of truth. It remains in git history (`docs/PLAN.md`). |

## Phase 1 review gate (independent reviewer, 10 Nov 2026)

The reviewer found no cross-business access reachable by a user, and 3 high / 11 medium issues
in the data layer. All were fixed; each fix has a test in `tests/integration/hardening.test.ts`
or `tenant-isolation.test.ts`.

| # | Decision | Why |
|---|---|---|
| G1-1 | Links between tenant tables are composite foreign keys (`sameTenant()`): business + environment + id. They never cascade. | A plain foreign key let a row point at another business's or the other environment's row, and a cascading one let a sandbox reset or a purge delete rows that were never archived. |
| G1-2 | A function with an effect outside the database checks permission before that effect. Scope-taking read helpers check their own permission. | An executive could make the payment provider issue a refund and only then be refused. |
| G1-3 | One payment per idempotency key is guaranteed by a unique index, and simultaneous requests wait for each other. Refunds lock the payment row. | Three simultaneous requests charged three times; three simultaneous refunds refunded three times. |
| G1-4 | "A business keeps one usable admin" counts only admins whose account is active, locks while counting, and is enforced on account deactivation too. | Deactivating the only admin's account, or two admins removing each other at once, left a business with none. |
| G1-5 | People, module-settings and portal changes are always logged under **live**, whichever mode the person was in. | They are not per-environment; filed under the sandbox they vanished from the live log. |
| G1-6 | A refund goes through the provider that took the payment, or is refused. | Otherwise a Stripe payment could be "refunded" by the mock with no money returned. |
| G1-7 | Purging a file, or resetting a sandbox, deletes the stored bytes as well as the rows. | "Permanently deleted" must include the file itself. |
| G1-8 | Microsoft sign-in requires SAI's own directory id (a GUID) and checks every token came from it. Google sign-in requires `GOOGLE_WORKSPACE_DOMAIN` and only accepts that Workspace's verified accounts. Linking a provider to an account is logged. | An unverified or outside account must never match the CTO's email. |
| G1-9 | The app's database role lost DELETE on users, businesses, memberships, sessions, settings and identities. | Nothing in the app deletes those; remove what is not needed. |
| G1-10 | **NEEDS JAI REVIEW.** Row-level security stays on tenant tables only. Platform tables are protected by the core's own checks plus a lint rule that stops routes and modules importing them. Code running inside the server could still change its own scope; row-level security is a safeguard against mistakes, not against hostile code. | Putting row-level security on users/memberships/sessions would force every sign-in and permission lookup through a scope and add a lot of moving parts. The reviewer rated this medium and not reachable by a user. Say so if you want the stricter version. |
| G1-11 | **NEEDS JAI REVIEW.** Known small gaps accepted for now: no idle timeout on sessions (they end after 12 hours); expired session rows are not cleaned up. | Neither affects correctness or separation; both need a scheduled job. Listed in HANDOFF. |
| G1-12 | Second review. Things outside the database follow the transaction: file bytes are deleted only after a purge commits, and removed if a save is rolled back (`afterCommit` / `onRollback` in `src/core/db/scope.ts`). A file row's storage key is only honoured inside that business's own folder. | A purge that was rolled back had already deleted the bytes; a forged file row could point at another business's bytes. |
| G1-13 | Second review. A payment's customer link is checked before the card is charged. Archived refunds still count as refunded. | The link was only checked by the database after the charge; archiving a refund made the money refundable again. |
| G1-14 | Second review. Changes to who has access take a lock first and decide afterwards (per business, per user). Only *usable* admins (active membership and active account) count towards "a business keeps one admin". | Closed the remaining races; a deactivated admin could not be removed. |
| G1-15 | The generic record functions (`createRecord` …) enforce separation, permissions and logging, but not business rules. Business rules live in services (`takePayment`, `refundPayment`, …). Screens must call the service, not the generic function, for records that have rules. | A refund created with `createRecord` skips the "not more than was paid" rule. No screen does this; the Data tab only archives and restores. |
| G1-17 | Third review. Each payment keeps a running total of what has been refunded; the refund limit uses that total. | Archiving, or permanently deleting, a refund row must never make the money refundable again. |
| G1-18 | Third review. Writing needs only the write permission: booking and moving an appointment need `scheduling.write`; taking and refunding a payment need `payments.write`. The read permission is for viewing lists. | The two are separate grants; a business admin can give "can take payments" without "can browse all payments". |
| G1-19 | Third review. A stored file's key can never be changed, two rows can never share one, and a single payment is capped at $1,000,000. Everything the database could refuse about a payment is checked before the card is charged. | Closes the remaining ways to point a file row at other bytes, and the last inputs that were only rejected after charging. |
| G1-16 | **NEEDS JAI REVIEW.** Microsoft sign-in trusts any account of SAI's own directory, including guests invited into it; it does not additionally check the email's domain. | Guest accounts are controlled by whoever administers the directory. Add a domain check when the directory is chosen, if guests are used. |

## Phase 2 — SAI Console

| # | Decision | Why |
|---|---|---|
| P2-1 | **Accent colours were adjusted** (table below). **NEEDS JAI REVIEW.** | Five brand colours were near-identical reds and two were black, so the sidebar monograms could not be told apart. Each final colour stays in its brand's family where possible. Neighbouring businesses in the sidebar were checked for separation, including under simulated colour-blindness. The monogram always shows the short code as text, so colour is never the only cue. |
| P2-2 | One light theme. System fonts. | A dark theme doubles the visual testing for no requirement. System fonts need no download. |
| P2-3 | Charts use one blue for data, never a business's brand colour; businesses are compared with labelled bars and small trend lines, not a nine-colour legend; every chart sits beside a table with the same numbers. | Brand colours are for identity. Nine series colours cannot be told apart reliably. |
| P2-4 | The Overview only shows a number if the person may read the records behind it (staff without payment access see no revenue). | "Limited to what their business admin grants" applies to summaries too. |
| P2-5 | The executive dashboard's "Orders" column shows "—" for a business whose module has not defined its unit of work. | A zero would read as "no orders" rather than "not tracked yet". |
| P2-6 | Imports: at most 2,000 rows per file; all rows or none; every imported row is created and logged like any other record; a file goes into live once. | Keeps an import reviewable and makes a repeat impossible. |
| P2-7 | Module settings are edited through a form generated from the fields the module declares; the module's schema validates them. | No settings screen has to be hand-built per module. |
| P2-8 | The command palette and "g then letter" shortcuts read the current business's tabs from the page itself. | They can then never offer a tab the person is not allowed to open. |
| P2-9 | Customer and field portal hosts use the console's login and roles for now. **NEEDS JAI REVIEW** when the first customer portal is planned. | How customers sign in depends on the undecided identity provider. No module defines such a portal yet, so the routes answer "not found". |
| P2-10 | Screenshots in `docs/screenshots/` are JPEGs. | A hundred full-page PNGs would add roughly 15 MB to the repository. |

| P2-11 | Review gate. A staff member granted the activity log sees only entries about kinds of records they may read. Entries about people, permissions and settings are for admins. Admins, the tech team and executives see the whole log. | Otherwise the log was a side door to payments and people data the same person could not open directly. |
| P2-12 | Review gate. "A file goes into live once" is guaranteed by the database (a unique index) and simultaneous clicks wait for each other; the same for the sandbox step. | Three simultaneous clicks imported the file three times. |
| P2-13 | Review gate. Uploads through a form may be up to 10 MB (the framework's default cap was 1 MB). Unreadable or malformed CSV files are refused with a plain message. | The form promised 10 MB. |
| P2-14 | **NEEDS JAI REVIEW.** An imported file is real data, and it goes into the sandbox first (A12), where anyone with test-mode access to that business and permission to read those records can see it, until the sandbox is reset. A11 says the sandbox holds only fake data. | Both decisions were approved; together they mean the sandbox briefly holds real data during an import. Options: accept it (reset the sandbox after checking an import), or give imports their own staging area. |

### Accent colours (P2-1)

| Business | Brand colour (brief) | Final accent | Change |
|---|---|---|---|
| Hired Hands Moving Company | `#1F4E9C` blue | `#1F4E9C` | none |
| Student Agencies Real Estate | `#5A5A5A` slate gray | `#6B6B6B` | slightly lighter, to separate it from the two near-blacks |
| Big Red Shipping & Storage | `#E2231A` red | `#E2231A` | none (it keeps the pure red) |
| The Cornellian | `#1A1A1A` near-black | `#1A1A1A` | none |
| Cornell Freshman Register | `#C8102E` red | `#C2185B` | shifted toward raspberry |
| Student Agencies Tutoring | `#8B1E2D` maroon | `#6B1238` | deeper wine |
| Cornell Bigger Beds | `#9B1C1C` dark red | `#D9580D` | shifted to burnt orange |
| Big Red Mailroom | `#B3322A` brick red | `#7A5230` | shifted to brick brown |
| Campus Promotions | `#111111` black | `#3A3F6B` | dark indigo, to separate it from The Cornellian |

## Phase 3 — module scaffolds

| # | Decision | Why |
|---|---|---|
| P3-1 | A scaffold is one call, `scaffoldModule({ key, name, description, plannedScope })`, in the module's `manifest.ts`, plus a README. All nine share one "not built yet" page (`src/modules/_shared/`). | Nine copies of the same placeholder would be nine things to keep in step. |
| P3-2 | The shared scaffold helper and page live under `src/modules/_shared/`, not in the core. | Registering the nine modules then changed nothing in `src/core/` or `src/app/`, which is the claim the module guide makes. |
| P3-3 | HHMC and Real Estate list their planned scope as "Pending requirements" and contain nothing else (a test checks their folders hold only a manifest and a README). | The brief forbids building their features; their requirements are still being gathered. |
| P3-4 | `src/modules/_template/` is a small working module to copy from. It is type-checked and linted but not registered, and the migration generator skips folders starting with `_`. | A template that is compiled cannot drift from the contract; one that is migrated would create a junk table. |
| P3-5 | A test fails if any file in `src/core`, `src/app`, `src/server` or `src/ui` names a business (its slug or short code as a text value, its code as a word, or its full name). It is a text search, so it cannot catch every spelling. | "Never hardcode businesses" becomes checkable, and so does "a tenth module needs no core change". |
| P3-6 | BRSS is registered as a scaffold in this phase with the Phase 4 scope listed; Phase 4 replaces it with the real module. | So Phase 3 can be reviewed on its own. |
| P3-7 | The glue between web requests and the core (`session`, `actions`, `portal-host`) moved from `src/app/_lib` to `src/server`. The core may not import it (lint rule). | Modules are not allowed to import routes, but their server actions need the session; a neutral folder gives them that without opening `src/app`. |
| P3-8 | A module's server actions get their context from `requireStaffPortalContext()`, which also checks that the person may open the staff portal and that the portal is switched on. | Found at the Phase 3 review gate: with the plain context, switching a portal off would have hidden its screens but left its actions callable. |
| P3-9 | Tests that count businesses read the count from the seed list, not the number 9; the registry also checks that a module's table names start with its key; a test checks that every table outside the platform schema is a tenant table. | Found at the Phase 3 review gate by adding a made-up tenth module: the guide worked without core changes, but four tests failed on a hardcoded 9 or on the seed-row helper. |
| P3-10 | The moving company's module description says only what the brief says ("Student moving company"). | The review found wording that could not be traced to the brief. |

## Phase 4 — BRSS proof module

| # | Decision | Why |
|---|---|---|
| P4-1 | Every BRSS business rule is a plain function in `src/modules/brss/rules.ts`, named with the rule id from `docs/brss-analysis/`. Services load rows, call a rule, save. `RULES.md` in the module maps each rule to its Salesforce file and line. | One place to read, test and change a rule; the citation requirement of the brief is met by a table that is generated from the analysis files. |
| P4-2 | BRSS has eight permissions of its own and reuses the shared ones for customers, payments, scheduling and notifications. Anything that changes an order needs `brss.orders.write`; warehouse work needs only `brss.articles.write`. | Two jobs at BRSS (processing orders, handling boxes) map to two permissions; a second set of BRSS-only copies of the shared permissions would have had to be granted in pairs. |
| P4-3 | Automatic charges (storage, shipping, insurance) are stored on the order as soon as an article is taken in, and re-priced whenever something changes, until a payment covers them. A paid charge is never touched again. | Staff see what is owed before payment; history never changes under them. |
| P4-4 | Two small additions to the shared core, used by BRSS and available to every module: `takeLock()` (`src/core/db/lock.ts`: "one at a time" for a named thing) and `nextRecordNumber()` (`src/core/records/numbering.ts`: running numbers like O-000123). | A module cannot reach the database transaction itself (by design), and both needs are general: two people paying one order at once; two records getting the same number. |
| P4-5 | `seedRecords()` accepts an optional `createdAt`, so fake data can be back-dated. | Dashboards and date filters need demo data spread over time. |
| P4-6 | `<ActionForm>` now keeps what the person typed when the server refuses the form, and clears it only after a success. | Found at the Phase 4 UI gate: React empties a form after every action, so a refused form lost everything typed into it. This affects every form in the console (for the better). |
| P4-7 | The portal's section tabs highlight the home section on pages that belong to no other section (an order's page lights up "Orders"). | Found at the Phase 4 UI gate. |
| P4-8 | An unavailability is stored as one or more plain time ranges in the core's `unavailability` table (all day = one range; some time windows = one range per day per run of neighbouring windows), plus optional building rows in a BRSS table. BRSS does its own building-aware check and tells the core's booking function not to repeat it. | Keeps the shared scheduling table free of BRSS ideas (buildings, fixed windows) while still using it. |
| P4-9 | Truck crews are names, not user accounts. | See B11 below. |
| P4-10 | All BRSS seed prices, zones and rates are invented. Region and building names are the public ones from the old system's picklists. | The real price data lives inside the Salesforce org, which this project never reads. |

## BRSS business questions (B1–B12) — NEEDS JAI REVIEW

The CTO asked Claude to choose the most conservative reasonable answer to each and flag it.
Every row below is **NEEDS JAI REVIEW**, ideally together with a BRSS manager. The same table,
with the smaller choices that follow from it, is in `src/modules/brss/README.md`.

| # | Question | What was built (most conservative reasonable answer) |
|---|---|---|
| B1 | No custom staff screen exists in Salesforce to model. | A new design from the data model, the rules and the list views staff use today. |
| B2 | Location is stored three ways in the old system. Which is real? | On the article: warehouse, section, row, pallet. Warehouses seeded: Mecklenburg, Lansing, Overflow, SAI Basement. |
| B3 | Should the article status order be enforced? | No. The screen suggests the next status; any change is allowed and logged, as today. |
| B4 | Who sets Activated, Closed, Confirmed, Truck en route, Completed, and when? | All are manual actions by staff. Closing an order marks its articles Delivered (kept from the old system). |
| B5 | What starts the storage clock: the first payment or the completed pickup? | The first payment. The pickup rule is not ported. |
| B6 | "Storage Delivery By" a year late: a bug? | Treated as a bug; plain month addition. |
| B7 | Billable weight divisor: 139 or 166? | 139 everywhere (what customers are charged on today); a module setting. |
| B8 | Is there really no capacity limit per time window or truck? | No limit; managers block time with unavailability. |
| B9 | Is West Campus meant to be Off-Campus? When is "Counter" used? | Each building has its own category as editable data (seeded as the old system behaves: only North Campus is On-Campus); "Counter" is a tick box on the order. |
| B10 | Intake happens on the crew's phones today. Where should it live? | In the staff portal's order page, usable at 375px. No separate field portal. |
| B11 | Are truck crew members individual users? | **Different from the default stated at Checkpoint 1** (which was "yes, users"): crews are recorded by name, as in Salesforce, where they are contacts and not logins. It is the smaller commitment and is easy to extend: a link to a user account can be added when crews sign in. |
| B12 | Should the system calculate the fees that exist only as website text? | No. They are products on the price list that staff add to an order by hand. |

Further BRSS choices that also need review (each explained in the module README):

| # | Choice | NEEDS JAI REVIEW because |
|---|---|---|
| B13 | A discount above the cap is refused with a message, not silently reduced as in Salesforce. | Changes what staff see at payment time. |
| B14 | Payment is refused while any charge "could not be priced", unless the person ticks a box to go ahead without it. | The old system charged nothing for such lines without saying so. |
| B15 | A refund is recorded on the payment only; the order's charges stay marked paid. | What a refund should undo is undefined in the old system. |
| B16 | Cancelling an order leaves appointments that were already completed as they were. | The old system set every appointment to Cancelled. |
| B17 | A region with buildings needs a building; a region without needs a street address; the room number is optional. | The old form's rules here were broken (they tested a region name that does not exist). |
| B18 | Zip ranges may not overlap. | The old system allowed overlaps and picked one arbitrarily. |
| B19 | Not built: storage extension, the "Supplies Delivery" automatic line, pre-arrival handling, the Ithaca College date window, reminder emails. | Each is either a customer-website flow, depends on unanswered questions, or needs a scheduler. Listed in the module README under "Not ported". |

## Phase 5 — HHMC module (11 Nov 2026)

| # | Decision | Why |
|---|---|---|
| P5-0 | The CTO agreed HHMC's requirements: `docs/hhmc-analysis/movegistics-reference.md`, with its §10 recommendations as requirements, plus the Phase 5 build prompt. HHMC left the "pending requirements" test; Real Estate stays in it. `BRIEF.md` updated. | CTO instruction. |
| P5-0b | Phase 5 was built on top of `phase-4-brss` (not yet merged into `main`), because both phases add migrations and parallel journals conflict. Work is on the session branch `claude/practical-brahmagupta-1o62aq`. **Merge `phase-4-brss` first, then this branch.** | CTO's choice when asked. |
| P5-1 | **Customer links** (`src/core/links`): token = base64url(payload) + HMAC-SHA256 with `LINK_SIGNING_SECRET` (generated by `npm run setup` into `.env.local`). The payload holds business, live/test, purpose, record id and expiry, so a test link cannot reach live data. A module declares `linkPurposes` with exactly the permissions each may hold (only its own permissions plus a short core list; `validateRegistry()` checks). The link context's actor is "Customer (link)" with role `customer_link`; everything it does is in the activity log. Served at `/l/<token>` through the module's `portals.customer`. No table: a link is revoked by its record's state (void estimate, paid invoice) or by changing the secret. | Approved by the CTO (option "stateless HMAC links"). Smallest change that works without deciding customer sign-in. |
| P5-2 | Seed turns the customer portal on for a module that defines one. Console users still get "not found" at `/portal/hhmc`: the customer pages need a link. | The links are useless with the portal off. |
| P5-3 | Contact = core customer; trucks = core resources; booked job days = core appointments (one per truck per day, chosen automatically from free trucks; none free = booked without a truck and shown); sold-out = core business-wide unavailability; emails = core notifications; documents = core files; payments = `takePayment`. 14 module tables for the rest. | Prompt: use the core, do not rebuild it. |
| P5-4 | The automation queue's permissions follow the job (`hhmc.jobs.read/write`), not `notifications.*`: whoever triggers an event queues its emails. *Sending* still needs `notifications.write`; a person without it leaves zero-delay emails for the next run. | Otherwise a staff member taking a payment without notification rights could not even queue the receipt. |
| P5-5 | The estimate document is a self-contained **HTML** file stored through `files` (on send and on signing). No PDF. | No PDF library is approved (A3). Adding one is a dependency decision for the CTO. |
| P5-6 | The 4% is two separate settings, Service Tax % and Card Convenience Fee % (both 4%), each switched on per quote/invoice. When both are on, the fee is charged on subtotal + tax. The deposit's card fee applies only when the deposit is paid by card; cash and check deposits pay the plain 20%. | Prompt; ref §11 Q4 open (see H4). |
| P5-7 | Creating the invoice moves the job Booked → Completed; paying it in full moves it to Closed. | The prompt's lifecycle goes book → invoice → pay → Closed; Movegistics never kept "Completed" up to date (ref §2.1), so it is set by the one thing staff always do after a move. |
| P5-8 | Estimates are created already "Sent" (the snapshot is taken at send). "Draft" exists in the status list but is never produced. | Prompt: "immutable, versioned snapshots taken when sent". A draft step would add a click without adding anything. |
| P5-9 | A signed estimate cannot be voided or replaced, and the quote locks once one is signed. To change a signed price, cancel the job and start again. | Safest: what the customer signed never changes under them. |
| P5-10 | "Run due emails" is for the tech team and super admin only (checked on the role); `npm run hhmc:automations` runs it as the system actor for live and test mode. | Prompt: "tech-only". The permission matrix itself is not changed. |
| P5-11 | Booking needs a signed estimate but not a paid deposit (the confirm dialog warns when it is unpaid). | ref §2.1 step 9 shows staff booking after signing; refusing would block cash deposits taken on the day. |
| P5-12 | Opt-in governs the marketing emails (drip, "How did your move go?"); receipts, "You're booked" and the past-due reminder always go. Turning opt-in off cancels what is queued. | Transactional email should not depend on a marketing switch. |
| P5-13 | Owner and coordinators are names, defaulting to the person creating the record. | Business staff may not list the business's people; ref §10 notes one shared login did nearly all the work. |
| P5-14 | Lead source is a fixed list of 8 plus a free-text detail; the ~100 Movegistics values are not imported. | ref §10; prompt. |

### The open questions of ref §11 (H1–H14) — NEEDS JAI REVIEW

| # | Question (ref §11) | How it was handled |
|---|---|---|
| H1 | Where do crew scheduling, rosters and payroll happen? | Out of scope. Job days carry crew size and trucks only; capacity is a setting (movers per day). |
| H2 | Crew App: do actual hours flow into invoices automatically? | Staff type actual hours per job day on the Job page; the invoice uses them, rounded up to 15 minutes. |
| H3 | Booking trigger: manual or automatic? | Manual (prompt). Signed + deposit shows "Ready to book". |
| H4 | The 4%: tax or card fee? Cash/check/ACH? | **Updated (P5-15):** two separate settings. New quotes default to **no service tax** and **the card fee on**, and the card fee is charged **only on card payments** (deposit, invoice balance, staff card payments). Cash and check never pay it. Totals show the cash/check amount, with "paid by card" next to it. Examples A/B/C still match to the cent. Managers can change both defaults in Settings. **A manager must confirm what HHMC actually charges.** |
| H5 | Deposit page and invoice pay link; is a saved card charged later? | Built as customer link pages; no saved cards (each payment is its own card entry). |
| H6 | BOL content; used by crews? | Not built (out of scope). |
| H7 | QuickBooks: what should sync? | Not built (out of scope). |
| H8 | RingCentral integration? | Not built. "RingCentral call" is a manual call outcome, as today. |
| H9 | Required fields | Lead: a name and an email or phone. Job: customer, service type, job type, crew, trucks. Everything else optional. |
| H10 | Which estimate sections must be signed? | Valuation is initialed and a final signature is typed, as observed (ref §7.3). |
| H11 | Rate table contents | Rates from the line items and real estimates (ref §4.1); no rate tables by weekday. |
| H12 | Mailchimp, Open API, lead feeds, web forms | Not built. Leads are entered by staff; the UTM/GCLID/FBCLID fields are ready for a web form later. |
| H13 | Surveys and structured inventory | Not built; scope of work is free text (ref §5). |
| H14 | Top-bar shortcuts | Not rebuilt. |

## Phase 5, part 2: HHMC prototype on `main` and the hosted test site (11 Nov 2026) — NEEDS JAI REVIEW

| # | Decision | Why / how to change it |
|---|---|---|
| P5-15 | **H4 as instructed:** service tax OFF and card fee ON by default (`serviceTaxOnByDefault`, `cardFeeOnByDefault` module settings). The fee is added only when money is taken by card (`cardChargeCents`). Invoices credit the deposit at its base amount, and the balance is in cash/check money. | The CTO's instruction. Never overcharges a cash or check customer, and never shows revenue that includes a fee that may not be collected. `services/pricing.ts`, `services/invoices.ts`. |
| P5-16 | **Hosting: Vercel (app) + Neon (Postgres), free plans.** Vercel runs Next.js with no configuration, deploys on every push, and has a free daily scheduler. Neon is free Postgres that allows the restricted `sai_app` role and row-level security, so the tenancy layers work unchanged. | The simplest free pair that fits the stack. No new dependency: only `vercel.json` (config). |
| P5-17 | **Demo mode** (`DEMO_MODE=true`, `src/core/demo`): a shared access password in front of everything (`src/proxy.ts`), including customer links; demo accounts with email + password from `DEMO_ACCOUNTS`; a "TEST SITE" banner; mock payments and log-only email forced; dev login off whatever `AUTH_DEV_LOGIN` says. | The CTO's non-negotiables. Passwords are never stored in the database or the repository, only in the hosting's encrypted environment variables. |
| P5-18 | The demo's app connection is **derived from `DATABASE_OWNER_URL`**: same server, role `sai_app`, and a password derived from the owner URL (HMAC). `npm run demo:prepare` gives the role that password on every deploy. So the owner URL is present at runtime on the demo. | One fewer secret for a first-time deployer, and the app still connects as the RLS-bound role. Set `DATABASE_URL` explicitly to stop deriving it. |
| P5-19 | On Vercel, stored files go to `/tmp` and do not last (estimate documents in the Data tab). | Fine for a test site. A real deployment needs a file-storage adapter (HANDOFF). |
| P5-20 | **Scheduler:** `vercel.json` calls `/api/cron/scheduled` daily (the free plan's limit), protected by `CRON_SECRET`. A module declares `scheduledTasks`; HHMC's due-emails task runs only where the manager setting "Send due automatic emails on a schedule" is on (**off by default**). "Run due emails" and `npm run hhmc:automations` stay. | The CTO asked for a free cron behind a setting that is off. Daily is coarse for the +2 h drip; a paid plan or another scheduler can call the same URL hourly. |
| P5-21 | **Data-tab archive hole closed** (pre-approved core change): `EntityDef.archiveGuard`, checked inside `archiveRecord()`, so every path obeys it. HHMC refuses to archive signed or live estimates, sent or paid invoices, jobs in progress, locked quote lines, booked job days, and lines of a sent invoice. BRSS refuses orders in progress, paid charges, and articles with paid charges. | A rule in one place that no path can skip. Core entities (payments, customers) are not guarded yet, so archiving a payment row is still possible for those with `payments.write`: a candidate for the same treatment. |
| P5-22 | Demo accounts: `gm` = HHMC business admin; `staff` = HHMC staff with **every grantable permission** (they can run the whole move); `tech` = the platform tech role. | Managers are testing the whole lifecycle, so a staff account missing "book" would only confuse. |
| P5-23 | "Copy payment link" on a sent invoice (like the estimate's "Copy link"). | On the demo no email is sent, so staff need the link to play the customer. Useful for real use too (send it by text). |
| P5-24 | The Book button is replaced by "Add a job day (the move date) before booking" when a job has no days. | Found by the demo e2e test: Book failed inside its dialog. |
| P5-25 | Templates and terms are labelled "PLACEHOLDER – manager to replace". The customer's estimate has "Print or save as PDF" (the browser's print), with no PDF library. | The CTO's instructions. |
| P5-26 | `npm run demo:seed` wipes and re-seeds the **demo** database (it refuses to run without `DEMO_MODE=true`). On Vercel the same happens on a deploy with `DEMO_RESET_ON_DEPLOY=yes`. | You can't run commands on Vercel. The variable is the no-terminal way. |
| P5-27 | Review round 1 of this part: **restore guards** too (`restoreGuard`); invoice lines **re-price their draft invoice** after any archive or restore (`afterArchiveOrRestore`), and a draft is re-priced before it is sent; only a **void** invoice can be archived; core **appointments and payments that belong to a module record** cannot be archived on their own (refund a payment instead). | No path, the Data tab included, can make a stored total disagree with its lines, or hide money or a booking. |
| P5-28 | A card fee on a **payment actually charged** is rounded **down** (`cardFeeOnPayment`); the "paid by card" figure shown rounds half-up once. | Several card payments (deposit, then parts of the balance) can then never add up to more than what was shown. ref §4.2's examples are exact either way. |
| P5-29 | Demo safety: the access action has its own server-action file (the /access page carries nothing else), demo login also checks the access cookie, the `next` redirect stays on this site, there is a short pause after a wrong password (no lockout), `demo:prepare` does nothing on non-production Vercel builds, refuses when `DATABASE_URL` and `DATABASE_OWNER_URL` name different databases, and only touches a database with **no tables** or one carrying its mark (the database comment `sai-demo-database`, which survives an interrupted wipe). Previews of other branches get no database connection at all. Accounts removed from `DEMO_ACCOUNTS` are switched off and their sessions revoked on the next deploy. | Found by the review gate. No lockout: a lockout on a shared demo would let anyone lock the managers out. |
| P5-30 | Review round 2 of this part: the "paid by card" totals use the same round-down as a real card charge, so the figure shown is exactly what paying by card costs; a void invoice's lines may be archived (so it can be purged in the end); core appointments that belong to a module record cannot be restored on their own either. | Found by the review gate. |

No new dependencies were added.

## Phase 5, part 3: the real-data pilot with Microsoft sign-in (11 Nov 2026) — NEEDS JAI REVIEW

The CTO asked for Microsoft-only sign-in and real company data, and chose "real data, staged"
(not live until email and a card processor are connected) and "decide hosting later".

| # | Decision | Why / how to change it |
|---|---|---|
| P5-31 | **Pilot mode** (`PILOT_MODE=true`, `src/core/demo/pilot.ts`): sign-in only through Microsoft (dev login off whatever `AUTH_DEV_LOGIN` says, no passwords, no shared site password); a blue "PILOT – not live yet" bar; search engines told not to index. `DEMO_MODE` and `PILOT_MODE` together are refused. | The CTO's instruction. Microsoft keeps the directory: someone switched off in Microsoft 365 can no longer sign in. Sign-in still only works for an existing account (R-6); guests of SAI's directory are accepted as before (R-11). |
| P5-32 | **Pilot accounts** come from `PILOT_ACCOUNTS` (`email\|Full name\|cto/tech/gm/staff`, no passwords): `cto` = super admin, `tech` = tech, `gm` = HHMC business admin, `staff` = HHMC staff with the same starting access as someone added in People and access (no booking, invoicing, export or catalog changes until the GM switches them on). The list only **creates** accounts: an existing account is never changed by it, and removing a line switches no one off (do that in People and access or in Microsoft 365). | Real data: least access by default, and every later change goes through the console, where it is checked and logged. `upsertPilotAccounts()` in `src/seed/demo-accounts.ts`. |
| P5-33 | **Real data is never wiped.** `demo:prepare` marks the database `sai-pilot-database`, refuses `DEMO_RESET_ON_DEPLOY` in pilot mode, refuses a database marked for the demo (and the demo refuses the pilot's), and only starts on a database with no tables. The live side starts empty; only **Test mode** gets the fake practice moves, and no fake users are created. | Mixing fake and real moves in Live would corrupt the revenue figures. `scripts/demo-prepare.ts`, `seedAll({ fakeUsers, demoEnvironments })`. |
| P5-34 | **No email reaches anyone** in pilot mode: the log-only channel is forced (messages still appear in Data → Notifications). Staff send customers the link with "Copy link". | No email service is chosen yet, and test messages must never reach real customers. `src/core/notifications/notifications.ts`. |
| P5-35 | **Card payments are refused in Live** in pilot mode (core `takePayment()`), the card option is hidden on the job and invoice pages, and the customer page says "We'll arrange payment with you directly". Cash and check work. Test mode keeps the test card. | No card processor is connected (the Stripe adapter refuses live keys). A refusal in the core means no page can get round it. |
| P5-36 | The site's own address comes from `APP_URL`, else Vercel's production address (`siteUrl()`), for links and the Microsoft redirect. | One fewer setting for a first-time deployer, and the Microsoft redirect must match the registered one exactly. |
| P5-37 | **Free plans for the pilot**: Vercel Hobby is for non-commercial use, and Neon's free plan has limited backups. Both must be upgraded before the site replaces Movegistics (HANDOFF, "Before replacing Movegistics"). | The CTO asked to decide hosting later. |
| P5-38 | Review round 1 of this part: the dev login and `npm run db:seed` refuse a database that is not on this machine (`isLocalDatabaseUrl()`), so a pilot address pulled into a local `.env` can't be seeded with fake users or signed into as anyone; Google sign-in is off in pilot mode; a sign-in started on another address of the site is sent to the site's own address first (the state cookie must be on the host Microsoft returns to). | Found by the review gate. The PILOT bar is hidden on customer link pages. Stored notifications read "sent" though only logged: noted, not changed (minor). |

No new dependencies were added.


## Phase 5C: HHMC on real data and the managers' requirements (11 Nov 2026)

Source: the managers' written input (Nov 2026) and the CTO's Phase 5C prompt. Where the managers
conflict with the Phase 5 build, the managers win; the conservative choice is taken and marked.

| # | Decision | Why / how to change it |
|---|---|---|
| P5C-1 | **NEEDS JAI REVIEW.** Real Movegistics data is imported **into the local database's HHMC live data only**, never the sandbox and never a hosted database (`scripts/hhmc-import` refuses a non-local `DATABASE_URL`). This departs from A12 ("import into the sandbox first") on the CTO's instruction: the sandbox keeps fake data only. Each run is checked by a reconciliation instead of a sandbox step. | CTO's prompt. Going online: `PRODUCTION-READINESS.md`. |
| P5C-2 | The importer writes through `createRecord`/`updateRecord` (tenancy, permissions, activity log), as the system actor named "Movegistics import", in batches of 250 (one transaction for ~10,000 rows runs out of lock memory). `hhmc_import_refs` (Movegistics id → local id + content hash) makes re-runs update instead of duplicate. Movegistics' dates are kept (`created_at` set after creation). | A partial run is safe to re-run. |
| P5C-3 | Imported payments are recorded as **already received** (`provider = 'manual'`, `providerRef = movegistics:<id>`): nothing is charged; nothing is emailed or queued for imported records (automation opt-in off on imported work requests). "REQUESTED" rows (a pay link sent, never paid) are not money and are not imported. | |
| P5C-4 | **NEEDS JAI REVIEW.** Movegistics' exports have **totals only**: imported estimates and invoices carry one line ("line items were not in the export"); work-request quotes carry one line per section total. Line items need the Movegistics Open API (`MOVEGISTICS_API_KEY`) or reading each detail page. | Totals reconcile; drill-down into line items does not exist for history. |
| P5C-5 | Movegistics marks 281 invoices **PAID** while its "Balance Due" column still shows the full amount (all 2025; 276 fully covered by payments in its own payments export; its invoice list shows the same). A PAID invoice is imported as owing $0. The reconciliation shows both figures. | Otherwise $264k of paid work would show as owed. |
| P5C-6 | HHMC allows **one estimate in force per work request**; Movegistics allowed several. On import the latest signed (else latest open) is kept; older open ones become Void with a note saying why. 74 estimates name no matching work request and are not imported (**NEEDS JAI REVIEW**). | |
| P5C-7 | Contacts are deduplicated by email, then phone. A lead becomes a customer only when converted (as in Movegistics). Lead and work-request sources (free text in Movegistics) are mapped to the fixed list; the original text is kept as the source detail. | |
| P5C-8 | **NEEDS JAI REVIEW.** The "no contact" follow-up runs **same day, day 3, day 7** ("three emails over the following week"; Movegistics today: now / +24 h / +2 days). | Change in Settings › Automatic emails. |
| P5C-9 | **Cornellian = a movers' hourly rate $20 lower** (setting), applied by the estimate builder; the old "Cornellian 5%" discount is archived (migration 0009). Packing labor is not discounted (**NEEDS JAI REVIEW**). | A lower rate stays right when hours change and still allows a quote-wide discount. |
| P5C-10 | **NEEDS JAI REVIEW.** Long distance = **over 150 miles** (setting). Per-mile and day rates are line items (HHMC's own: 16' $1.09/mi + $55/day … 26' $1.19/mi + $75/day; local 16' $195/day). One set of truck fees per truck. | Managers: "over roughly 150 miles", "about 10 cents lower than U-Haul". |
| P5C-11 | **NEEDS JAI REVIEW.** No Google Maps key: mileage and drive time are typed in, and the builder says so. The adapter (`services/maps.ts`) uses the Distance Matrix API once `GOOGLE_MAPS_API_KEY` is set, only when staff press "Look up mileage", outside any database transaction. | A paid Google key is a cost decision. |
| P5C-12 | The catalog is **HHMC's real Movegistics line items** (32, business prices only). "Packing Labor" ($195/hr) has no Movegistics item (**NEEDS JAI REVIEW**). The invented "Storage (per month)" and "Junk Removal" prices were removed. Trucks are still the three placeholders (Movegistics vehicles not exported, **NEEDS JAI REVIEW**). | |
| P5C-13 | Sidebar in the managers' words: Dashboard, Leads, **Estimates** (new list), **Work Requests** (was Jobs), **Contacts** (new), **Calendar** (was Schedule), Invoices, Settings. URLs unchanged. | "Rename our screens to match their terms; no new duplicate screens." |
| P5C-14 | Branding (colour, header line, footer, company details) is a module setting changed in the console Settings tab (tech team), shown on customer estimate/invoice pages and the stored estimate document; the colour must be `#rrggbb`. Placeholder values until the managers give theirs (**NEEDS JAI REVIEW**). | |
| P5C-15 | Dashboard "Payments collected" counts every payment HHMC received (also deposits linked only to a work request, or to no record). Draft invoices count as invoiced and open (the agent's definition, kept). | So the dashboard equals Movegistics' total to the cent. |
| P5C-16 | The secret scan now also fails on likely personal data: emails outside reserved test domains (URLs' `user@host` ignored), phone numbers outside 555-0100…0199 (incl. +1 E.164; bare 10-digit numbers in .csv/.json/.tsv), tracked office documents/spreadsheets, and anything under `hhmc-data/` or import output folders. | Real data must never be committed. |
| P5C-17 | The managers' must-haves were proven end to end on a real repeat customer **only in a throw-away copy of the local database** (`scripts/hhmc-import/must-haves.ts` refuses any database whose name does not end in `_copy`), emails to a silent recorder, card on the mock provider. | Never charge or email a real person. |
| P5C-18 | Review round 2 (importer): unknown Movegistics status values **stop the import** and are listed (never guessed); declined / failed / voided payments are not money; void invoices owe $0; the reconciliation reads the CSVs with its own parsing, checks each PAID invoice against its payments (7, $3,986.25, not covered: **NEEDS JAI REVIEW**) and marks months with a partial refund "unverified"; re-runs never overwrite a record staff changed in SAI, link (never duplicate) a customer already present by email/phone, take the next free estimate version and keep the imported invoice line equal to its total; title-only linking only when unambiguous (counted); epoch dates in Ithaca time; `must-haves.ts` refuses pilot/demo mode and forces the mock card; `clear-demo` also refuses rows made by a person or customers with real-looking emails; the local "not sent" email prints nothing from the message (`EMAIL_CONSOLE_FULL=true` for everything); the scan also catches emails inside URLs, 11-digit numbers, archives and images outside `docs/screenshots` / `public`. | Independent review gate. |
| P5C-19 | Review round 3: a customer is matched by phone only when the emails do not disagree (two people on one household or business line stay two customers; one such earlier link was corrected); a record is kept as it is in SAI when a person changed it, anything changed it after the last import (customer links write with no user id) or it was archived; archived customers are matched too; the import and must-haves scripts print only their own messages (never an app or database error that could quote a real value); unknown values are masked when they look like personal data; a database URL with a `host=` query is refused; the reconciliation writes its headline last and flags uncovered PAID invoices and partial refunds as ⚠️ unverified; the scan also refuses files it cannot read as text (UTF-16, binary), decodes `%40`, and catches numbers written with no separator after the area code. Tests cover shared phones, staff edits kept, version collisions and invoice lines following totals. | Independent review gate. |

No new dependencies (papaparse was already installed).
