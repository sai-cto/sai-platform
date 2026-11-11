# Progress

_Last updated: Phase 5C (11 Nov 2026): HHMC rebuilt around the managers' written requirements, and HHMC's real Movegistics history imported into the CTO's **local** database, reconciled to the cent. Nothing real is online._

## In plain English

**What exists now:** the SAI Console. You sign in as a fake test user of any role and get a
sidebar with the businesses that role may open. Each business has tabs: Overview (key numbers,
revenue chart, recent activity), App (where the business's own staff portal will appear),
People and access, Data (browse, search, export, archive, restore, permanent delete), Activity
log, Settings and Test mode. The tech team and CTO also get a Platform section (all users and
roles, module registry, feature flags, the global activity log, CSV imports, system health,
platform settings), and executives get a read-only dashboard across all nine businesses.

Behind it is the shared core from Phase 1: business separation, permissions, the activity log,
archive/restore/permanent-delete rules, customers, payments (fake provider), scheduling,
notifications, files and analytics.

**How to see it:** follow the README (`npm install`, `npm run setup`, `npm run dev`), open
<http://localhost:3000> and click a user on the login page. Screenshots of every role, at
desktop and phone width, are in `docs/screenshots/phase-2/`.

All nine businesses are registered as modules. Until a business's own staff portal is built,
its App tab shows a tidy "not built yet" page with its planned scope; everything else in the
console already works for it.

**The first real business app is BRSS's staff portal** (Big Red Shipping & Storage → App):
an orders dashboard, an order page (customer, articles with status and warehouse location,
charges, payments, appointments), article intake, the schedule with unavailability, warehouses
and trucks, the price list with storage terms, and zip zones. It follows the rules found in the
old Salesforce system; each rule is listed with its Salesforce source in
`src/modules/brss/RULES.md`. Screenshots: `docs/screenshots/phase-4/`.

**Hired Hands (HHMC) now has its own app** (Phase 5): leads, one Job page per move (quote with
live totals, estimates, booking, job days, invoices, payments, notes and calls), one schedule
with day/week/month views, invoices, and settings. Customers review, sign and pay the deposit
from an emailed link without an account, and pay their invoice the same way. Automatic emails
(follow-ups, receipts, reminders) are rules in a table; with no scheduler yet, the tech team
sends due ones with a button. Rules and sources: `src/modules/hhmc/README.md`.

**What is not real yet:** BRSS's prices, zones and rates are invented, no card company or email
service is connected, and twelve questions about how BRSS works were answered conservatively
without a BRSS manager (`src/modules/brss/README.md`, "Decisions waiting for the CTO").

## Current phase and task

- **Phase 1 — shared core.** ✅ Done. Passed the independent review gate after four rounds (see below) and merged to `main`.
- **Phase 2 — SAI Console.** ✅ Done. UI gate done (110 screenshots); passed the independent review gate after three rounds (see below) and merged to `main`.
- **Phase 3 — module scaffolds.** ✅ Done. UI gate done (38 screenshots); passed the independent review gate after two rounds (see below) and merged to `main`.
- **Phase 4 — BRSS proof module.** ✅ Merged to `main` (its own review gate had not finished; see DECISIONS R-22).
- **Phase 5 — HHMC module and test site.** ✅ Merged to `main`. Next: the CTO deploys the test site, then a live smoke test.

## Acceptance criteria (final)

| | Criterion |
|---|---|
| ✅ | A fresh clone runs locally with one documented setup sequence and seeds all 9 businesses plus test users for every role |
| ✅ | All permission and tenant-isolation tests pass; `docs/PERMISSIONS.md` matches what the tests check |
| ✅ | Logging in as each seed role shows exactly the sidebar, data and actions that role allows _(`tests/e2e/console.spec.ts`, `tests/e2e/isolation.spec.ts`, screenshots per role)_ |
| ✅ | Archive → restore works; permanent delete only for super_admin and only past retention; every action appears in the activity log _(data layer and end-to-end through the screens)_ |
| ✅ | Test mode clearly separates sandbox data from live data, with a persistent visual indicator _(striped banner + yellow frame on every sandbox page; `/sandbox/` in the address)_ |
| ✅ | All 9 modules are registered; adding a 10th by following `MODULE_GUIDE.md` requires no core changes _(registering the nine changed no code in `src/core` or `src/app`; the Phase 3 reviewer added a made-up tenth module by following the guide, with no core changes and every check green)_ |
| ✅ | The BRSS staff portal covers the listed workflows end to end on seed data, with ported rules documented and source-cited _(`tests/e2e/brss.spec.ts` walks an order from creation to closing in a browser; `src/modules/brss/RULES.md` cites 84 rules; review gate still running)_ |
| ✅ | Typecheck, lint, unit and end-to-end tests all pass; the secret scan is clean _(as of the last verification below)_ |

## Phase checklist

| Phase | Status |
|---|---|
| 0 — Plan | ✅ merged to `main` (Checkpoint 1 approved 10 Nov 2026) |
| 1 — Shared core | ✅ merged to `main` |
| 2 — SAI Console | ✅ merged to `main` |
| 3 — Module scaffolds | ✅ merged to `main` |
| 4 — BRSS proof module | ✅ merged to `main` |
| 5 — HHMC module + test site | ✅ merged to `main`; test site waiting to be deployed |

## Last verification

See the bottom of this file ("Verification log"). Updated after every phase step.

## Open defects

None known.

## Blocked

Nothing.

## Decisions awaiting the CTO's review

Listed in `docs/DECISIONS.md`, first table ("Awaiting the CTO's review").

## How to resume (for a fresh session)

1. Read this file, then `docs/BRIEF.md`, `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`.
2. `git fetch origin && git checkout <current phase branch>` (see "Current phase and task").
3. `npm install && npm run setup` (starts Postgres in Docker; in a cloud container start `dockerd` first).
4. `npm run check` and `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e` must be green before changing anything.
5. Continue the loop from the CTO's instructions: plan → build → verify → review gate → UI gate → record → merge.

Guardrails that always apply: never push `--force`; never rewrite `main`; never touch
`../brss-salesforce` or run `sf`/`sfdx`; no real data, credentials or live keys; no new
non-trivial dependencies beyond those in DECISIONS A3; at most 2 subagents at once.

## Verification log

### Phase 1 — shared core (10 Nov 2026)

```
npm run check
  tsc --noEmit            clean
  eslint                  clean
  vitest run              Test Files 8 passed (8) · Tests 303 passed (303)
  secret scan             clean (122 files)
npm run test:e2e          11 passed
```

Review gate (independent reviewer subagent, no access to the author's reasoning):

| Round | Result | What happened next |
|---|---|---|
| 1 | 0 critical · 3 high · 11 medium · 12 minor | All high and medium fixed, 31 tests added |
| 2 | 1 partial + 4 new (1 high, 3 medium) | All fixed, 49 tests added |
| 3 | 2 medium (one a regression from round 2's fix) | Both fixed, 38 tests added |
| 4 | **Nothing above minor.** Gate passed. | Minor items fixed as well (3 tests added) |

No round found a way for a user to reach another business's data. The findings were holes in
the data layer that a future screen or module could have hit; each fix has a test that fails
if the fix is removed. Decisions that came out of the gate: `DECISIONS.md`, G1-1 … G1-19.

### Phase 2 — SAI Console (10 Nov 2026)

```
npm run check
  tsc --noEmit            clean
  eslint                  clean
  vitest run              Test Files 9 passed (9) · Tests 317 passed (317)
  secret scan             clean
npm run test:e2e          35 passed (auth 11 · console 12 · isolation 12)
```

UI gate: signed in as each of the seven kinds of seed user and opened every screen at 1440px and
375px; 110 screenshots in `docs/screenshots/phase-2/`, named `<role>-<nn>-<screen>-<width>.jpg`.
Found and fixed while looking: the Next.js dev badge covering the user menu; five near-identical
red monograms (colours adjusted, DECISIONS P2-1); a search form that stacked on desktop; the
business name being cut off on a phone; the Overview scrolling sideways on a phone once there was
recent activity; badges wrapping inside table cells; and a chart bug that dropped today's bar.

Review gate (independent reviewer subagent, no access to the author's reasoning):

| Round | Result | What happened next |
|---|---|---|
| 1 | 0 critical · 0 high · 3 medium · 15 minor | All medium fixed (a file could be imported into live twice by two simultaneous clicks; uploads over 1 MB failed; staff granted the activity log could read entries about payments and people). Minor items fixed too. |
| 2 | 1 medium · 6 minor | Fixed: re-checking a file with a different column mapping at the same moment as its sandbox import could let a mapping that never ran in the sandbox be imported into live. Minor items fixed (activity count for staff, date filter on clock-change days, export limit notice, wording). |
| 3 | **Nothing above minor.** Gate passed. | One more minor item fixed (a mistyped year in the date filter caused an error page). |

No round found a way for a user to see another business's data. Left as known minor items:
route pages in a module's portal must be plain server components (documented in
`MODULE_GUIDE.md` with Phase 3); a file larger than 11 MB shows the framework's own error rather
than our message; the new import-race test relies on timing (it can fail falsely on a very slow
machine, never pass falsely).

Final numbers for Phase 2:

```
npm run check
  tsc --noEmit            clean
  eslint                  clean
  vitest run              Test Files 9 passed (9) · Tests 322 passed (322)
  secret scan             clean (299 files)
npm run test:e2e          37 passed
```

### Phase 3 — module scaffolds (10 Nov 2026)

```
npm run check
  tsc --noEmit            clean
  eslint                  clean
  vitest run              Test Files 11 passed (11) · Tests 350 passed (350)
  secret scan             clean
npm run test:e2e          41 passed
registering the nine modules changed no code under src/core or src/app (comment wording only);
letting modules have server actions needed one move: the request glue went from src/app/_lib
to src/server (44 files under src/app changed their import line, nothing else)
```

UI gate: 38 screenshots in `docs/screenshots/phase-3/` (each business's App tab as super admin;
the same page as a business admin in live and test mode, as staff, and as staff with nothing
granted; the executive gets "not found" for the App tab; module registry; system health).

Review gate (independent reviewer subagent, no access to the author's reasoning). The reviewer
tested the acceptance criterion directly: it invented a tenth business and followed
`MODULE_GUIDE.md` word for word in a scratch copy.

| Round | Result | What happened next |
|---|---|---|
| 1 | 0 critical · 0 high · 2 medium · 12 minor | The guide worked with no change to the core, but four automatic tests failed for a tenth module (a test helper reused one seeded row; tests hardcoded the number 9). Both fixed, plus the minor items: switching a portal off now also stops its actions; the core may not import the request glue; table names must start with the module key; every table outside the platform must be a tenant table; guide corrections. |
| 2 | **Nothing above minor.** Gate passed. | Tenth-module exercise repeated: no edits to the core, the console or any existing test; typecheck, lint, 357 tests and the secret scan all green. Five new minor notes fixed (a wrong cross-reference, a test for the new action check, clearer guide wording, dynamic imports covered by the lint rule). |

Left as a known minor item: the "no business is named in the core" test is a text search; a
future business whose short code is also an ordinary word in the code (for example `CSV`) would
trip it and need the test adjusted.

### Phase 4 — BRSS proof module (10 Nov 2026)

```
npm run check
  tsc --noEmit            clean
  eslint                  clean
  vitest run              Test Files 12 passed (12) · Tests 422 passed (422)
  secret scan             clean
npm run test:e2e          47 passed (auth 11 · brss 6 · console 12 · isolation 12 · modules 6)
```

UI gate: signed in as BRSS admin, BRSS staff, a new hire with nothing granted, the executive,
the super admin, the tech user and another business's admin, and opened every BRSS screen at
1440px and 375px: 86 screenshots in `docs/screenshots/phase-4/`. Found and fixed while looking
and while driving the screens from the browser tests:

- a refused form lost everything that had been typed into it (fixed for every form in the console);
- the "Clear" link on a filter bar left the old values in the fields;
- a section that opened itself (for example "Take in an article" on an empty order) snapped shut
  after the first save, hiding the "Added" message;
- price fields on the Pricing page were squeezed to a sliver;
- charges were listed in a random order; long charge names wrapped badly on a phone;
- too many black buttons on the schedule; duplicate fake crew names.

One thing to know when running the app locally: starting a second `npm run dev` (or the browser
tests) before an earlier dev server has fully stopped can make pages reload in a loop. Stop the
old one first (`pkill -f next-server`).

### Phase 5 — HHMC module (11 Nov 2026)

Built on `phase-4-brss` (not yet merged into `main`; the CTO chose to base this branch on it)
and pushed to `claude/practical-brahmagupta-1o62aq`. **Stops before merge**: merge
`phase-4-brss` first, then this branch.

```
npm run check
  tsc --noEmit            clean
  eslint                  clean
  vitest run              Test Files 14 passed (14) · Tests 467 passed (467)
                          (hhmc-pricing 8: ref §4.2 examples A, B, C to the cent; hhmc 37: full lifecycle,
                           drip cancellation, v2 voids v1, permission refusals, sandbox/live, customer links,
                           review regressions)
  secret scan             clean
npm run test:e2e          50 passed (auth 11 · brss 6 · console 12 · hhmc 3 · isolation 12 · modules 6)
npm run docs:permissions  regenerated (13 HHMC permissions)
```

UI gate: 70 screenshots in `docs/screenshots/phase-5/` (35 screens × 1440px and 375px): HHMC admin
(dashboard, leads, lead, new lead, jobs, new job, the Job page at four stages, schedule month /
week / day, invoices, past due, an open and a paid invoice, settings, Overview tab, test mode),
HHMC staff (no Book button, read-only settings), tech (Run due emails, module registry),
executive and another business's admin ("not found"), and the customer pages (estimate summary,
full estimate, sign, confirmation, invoice pay, tampered link "not found"). Every page answered as
expected and none scrolls sideways at 375px. Found and fixed while looking: header cells with
screen-reader-only text made five pages scroll sideways on a phone; the month calendar cut off
"M / T"; the quote stayed editable after signing; seeded deposits did not appear under Payments.

Review gate (independent reviewer subagent, no access to the author's reasoning):

| Round | Result | What happened next |
|---|---|---|
| 1 | 0 critical · 1 high · 5 medium · 8 minor | All fixed but one (Data-tab archive bypassing module rules: a core design question, mitigated in the module, recorded below). High: two deposit payments at the same moment could both charge (the estimate was read before the lock). 10 regression tests. |
| 2 | 0 critical · 0 high · 2 medium · 6 minor | All fixed: Lost/Cancel now share the estimate lock with signing and deposits; Net 30/60 invoices get their past-due reminder after the due date; card-fee display follows the charge; 5 regression tests incl. a static check that customer-link actions call only link services. |
| 3 | **Nothing above minor** (2 minor). Gate passed. | Both fixed: a retry keeps its payment key unless the card was refused or the payment succeeded; the past-due deferral has its own test. |

Also found while verifying: the e2e dev server reached Next's memory threshold with HHMC's pages
and restarted mid-run (logins then failed); `playwright.config.ts` gives it more heap.

Known, left for the CTO: the console's Data tab can archive any record its permission allows,
which bypasses module rules (for example archiving a signed estimate). HHMC counts archived signed
estimates and invoices so it cannot be tricked into replacing or double-billing, but a general
fix (an "archivable" flag on entities) is a core change.

### Phase 5, part 2 — HHMC prototype on `main`, hosted test site (11 Nov 2026)

The CTO cleared: merge to `main`, close the Data-tab archive hole, and prepare a hosted test
site for HHMC's managers.

- **Phase 4 merged into `main`** (`48c2b38`, merge commit), then this branch synced with it.
- **H4 (the 4%)**: the card fee is charged on card payments only; new quotes default to no
  service tax and card fee on (manager settings). Examples A/B/C still hold to the cent.
- **Archive hole closed** (core): `archiveGuard`, `restoreGuard`, `afterArchiveOrRestore` on
  entities, enforced in the record functions; HHMC, BRSS and core rules
  (`tests/integration/archive-guard.test.ts`).
- **Hosted test site** (demo mode, Vercel + Neon): access password, demo accounts from env vars,
  TEST SITE banner, fake payments and email, no dev login (`docs/DEPLOY-DEMO.md`,
  `npm run test:e2e:demo`). Manager guide and message: `docs/hhmc-analysis/`.
- **Scheduler**: daily cron behind a manager setting that is off by default.

```
npm run check             tsc, eslint clean · Test Files 16 passed · Tests 481 passed · secret scan clean
npm run test:e2e          50 passed
npm run test:e2e:demo     3 passed (production build in demo mode: gate, accounts, no dev login,
                          a full move with the customer signing and paying through links)
```

UI gate: `docs/screenshots/phase-5b/` (38 screenshots, 1440px and 375px): the changed Job,
invoice and customer screens (cash total + "paid by card"), the console Settings tab with the new
settings, and the demo site (access password, wrong password, demo sign-in, GM dashboard, jobs,
a customer link page with the banner). Nothing scrolls sideways; the banner is on every demo page.

Review gate (fresh independent reviewer):

| Round | Result | What happened next |
|---|---|---|
| 1 | 0 critical · 1 high · 4 medium · 7 minor | All fixed (DECISIONS P5-27 … P5-29). High: archiving a draft invoice's line from the Data tab left its total stale (a customer could be overcharged). |
| 2 | 0 critical · 0 high · 2 medium · 6 minor | All fixed (P5-29, P5-30). Medium: removing a demo account would have failed the next deploy (the app role may not delete sessions: revoked instead); the "empty database" check only looked for one table (now: no tables anywhere, or the database's own demo mark). |
| 3 | **Nothing above minor** (5 minor). Gate passed. | All five fixed (stricter emptiness check, quoting, the owner role refused as the app's connection, test and doc wording). |

`demo:prepare` was also run by hand against a scratch database: refused while it held an
unrelated table (which survived, even with reset on), refused mismatched URLs, marked and seeded
an empty database, and a reset wiped and re-seeded it.

### Phase 5C — HHMC on real data, the managers' requirements (11 Nov 2026)

What changed for the managers: estimate builder (Cornellian rate, own truck, local vs long
distance, materials, packing, location notes, manual mileage until a maps key exists); sidebar
in their words (Leads, Estimates, Work Requests, Contacts, Calendar, Invoices); repeat-customer
button on contacts; date-range dashboard with every number clickable; month calendar colour-coded
with a legend; settings one page per area with "when X → send Y" emails; branding on customer
documents; HHMC's real 32 line items and rates.

Real data (local only): Movegistics' seven list exports (2,945 contacts, 613 leads, 1,396 work
requests, 1,894 estimates, 883 work orders, 781 invoices, 1,454 payments) imported with
`npm run hhmc:import`. Reconciliation (`~/Documents/SAI/hhmc-data/RECONCILIATION.md`, outside the
repo): work requests per month, invoiced $928,655.23, collected $798,504.10, open balance
$206,557.95 — all equal to Movegistics to the cent (with Movegistics' stale "Balance Due" on 281
PAID invoices explained, P5C-5). Must-haves proven end to end on a real repeat customer in a
throw-away database copy (P5C-17).

```
npm run check            typecheck, lint clean · 21 files, 522 tests passed · secret + personal-data scan clean
npm run test:e2e         50 passed (before the importer commits; re-run below)
review gate              round 1 (Part 3 screens): 1 high, 5 medium, 8 minor → all fixed (fdf0ae0)
```

## Phase 5, part 3: the real-data pilot with Microsoft sign-in (11 Nov 2026)

The CTO asked for Microsoft-only sign-in and real HHMC data, and chose "real data, staged" and
"decide hosting later". Pilot mode (`PILOT_MODE=true`, DECISIONS P5-31 … P5-38): Microsoft
sign-in only, live data never wiped, practice data only in Test mode, no customer email, no
card payments in Live, a PILOT bar for staff. `docs/DEPLOY-DEMO.md` is now the pilot guide
(Neon + Vercel + Microsoft Entra, 12 steps); the go-live list is in HANDOFF.

Verified: `npm run check` (487 tests, 6 new in `tests/integration/pilot.test.ts`), `npm run
test:e2e` (50), `npm run test:e2e:demo` (3). `demo:prepare` in pilot mode was run by hand on a
scratch database: marked and seeded an empty one (0 live jobs, 17 test-mode jobs, no fake
users), refused a reset, and the demo refused the pilot's database. The Microsoft start route
redirects to `login.microsoftonline.com/<tenant>/…` with the right redirect URI. Microsoft
sign-in itself has not been tried against a real directory yet.

UI gate: `docs/screenshots/phase-5b/pilot-0*` (sign-in, job, invoice, customer page at 1440 and
375): the bar is on staff pages and not on the customer's; Live offers check and cash only.

Review gate (fresh independent reviewer):

| Round | Result | What happened next |
|---|---|---|
| 1 | 0 high · 3 medium · 7 minor | Fixed (P5-32, P5-38): staff got every permission on real data; each deploy overwrote roles; a pilot address in a local `.env` could be seeded with fake users or signed into with the dev login. Minors fixed except "notifications stored as sent" and BRSS card option in Live (refused by the core anyway). |
| 2 | **Nothing above minor**. Gate passed. | Fixed: test env restore, upper-case `LOCALHOST`, staff wording, decision order. Not changed: a redirect loop only possible when self-hosted behind a proxy that hides the public host. |

An e2e run once failed 17 tests because a pilot preview server shared the `.next` folder; after
clearing it the suite passed 50/50.
