# Progress

_Last updated: Phase 2 (console) passed its review gate and is merged to `main`._

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

**What is not there yet:** the nine business modules are not registered (Phase 3), so every
App tab says "No app yet". The BRSS staff portal is Phase 4.

## Current phase and task

- **Phase 1 — shared core.** ✅ Done. Passed the independent review gate after four rounds (see below) and merged to `main`.
- **Phase 2 — SAI Console.** ✅ Done. UI gate done (110 screenshots); passed the independent review gate after three rounds (see below) and merged to `main`.
- **Phase 3 — module scaffolds**, on branch `phase-3-scaffolds`: built and verified; independent review gate running.
- Next: **Phase 4 — BRSS proof module**, on branch `phase-4-brss` (in progress).

## Acceptance criteria (final)

| | Criterion |
|---|---|
| ✅ | A fresh clone runs locally with one documented setup sequence and seeds all 9 businesses plus test users for every role |
| ✅ | All permission and tenant-isolation tests pass; `docs/PERMISSIONS.md` matches what the tests check |
| ✅ | Logging in as each seed role shows exactly the sidebar, data and actions that role allows _(`tests/e2e/console.spec.ts`, `tests/e2e/isolation.spec.ts`, screenshots per role)_ |
| ✅ | Archive → restore works; permanent delete only for super_admin and only past retention; every action appears in the activity log _(data layer and end-to-end through the screens)_ |
| ✅ | Test mode clearly separates sandbox data from live data, with a persistent visual indicator _(striped banner + yellow frame on every sandbox page; `/sandbox/` in the address)_ |
| ✅ | All 9 modules are registered; adding a 10th by following `MODULE_GUIDE.md` requires no core changes _(registering the nine changed no file in `src/core` or `src/app`; a test fails if either names a business)_ |
| ❌ | The BRSS staff portal covers the listed workflows end to end on seed data, with ported rules documented and source-cited _(Phase 4)_ |
| ✅ | Typecheck, lint, unit and end-to-end tests all pass; the secret scan is clean _(as of the last verification below)_ |

## Phase checklist

| Phase | Status |
|---|---|
| 0 — Plan | ✅ merged to `main` (Checkpoint 1 approved 10 Nov 2026) |
| 1 — Shared core | ✅ merged to `main` |
| 2 — SAI Console | ✅ merged to `main` |
| 3 — Module scaffolds | 🔨 built, review gate running |
| 4 — BRSS proof module | ⏳ |

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
  vitest run              Test Files 10 passed (10) · Tests 340 passed (340)
  secret scan             clean (378 files)
npm run test:e2e          41 passed
git diff phase-2-console..phase-3-scaffolds --stat -- src/core src/app
                          only comment wording in two core files (example names made generic)
```

UI gate: 38 screenshots in `docs/screenshots/phase-3/` (each business's App tab as super admin;
the same page as a business admin in live and test mode, as staff, and as staff with nothing
granted; the executive gets "not found" for the App tab; module registry; system health).
