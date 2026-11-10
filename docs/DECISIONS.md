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
| R-13 | Customer and field portals would use the console's login and roles (P2-9). | No such portal exists yet. | Decide with the identity provider |
| R-8 | Next.js "Cache Components" is switched off; every page renders per request. | Every console page depends on who is signed in. Per-request rendering is the simplest model for students. Next.js says the feature becomes mandatory in the next major version: see HANDOFF. | `next.config.ts` |

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
| P3-5 | A test fails if any file in `src/core`, `src/app` or `src/ui` names a business (slug, short code or name). | "Never hardcode businesses" becomes checkable, and so does "a tenth module needs no core change". |
| P3-6 | BRSS is registered as a scaffold in this phase with the Phase 4 scope listed; Phase 4 replaces it with the real module. | So Phase 3 can be reviewed on its own. |

## BRSS business questions (B1–B12)

The CTO asked Claude to choose the most conservative reasonable answer to each and flag it.
They are recorded with the BRSS module in Phase 4; until then see section 8B of the Phase 0
plan in git history (`git show 5e76467:docs/PLAN.md`).
