# Progress

_Last updated: Phase 1, review gate pending._

## In plain English

**What exists now:** the foundation of the platform, with no real screens yet. You can sign in
as a fake test user of any role and see which businesses that role may open. Behind that, the
"shared core" is built and tested: business separation, roles and permissions, the activity
log, archive/restore/permanent-delete rules, customers, payments (fake provider), scheduling,
notifications, file storage, analytics helpers and test mode.

**How to see it:** follow the README (`npm install`, `npm run setup`, `npm run dev`), open
<http://localhost:3000> and click a user on the login page.

**What is not there yet:** the console itself (sidebar, tabs, Platform section, executive
dashboard) is Phase 2. The nine business modules are Phase 3. The BRSS staff portal is Phase 4.

## Current phase and task

- **Phase 1 — shared core.** Built. Waiting on: independent review gate → fix findings → merge to `main`.
- Next: **Phase 2 — SAI Console**, on branch `phase-2-console`.

## Acceptance criteria (final)

| | Criterion |
|---|---|
| ✅ | A fresh clone runs locally with one documented setup sequence and seeds all 9 businesses plus test users for every role |
| ✅ | All permission and tenant-isolation tests pass; `docs/PERMISSIONS.md` matches what the tests check _(route-level isolation tests grow with the console in Phase 2)_ |
| ❌ | Logging in as each seed role shows exactly the sidebar, data and actions that role allows _(business list ✅; sidebar, data and actions are Phase 2)_ |
| ❌ | Archive → restore works; permanent delete only for super_admin and only past retention; every action appears in the activity log _(rules ✅ and tested; the screens are Phase 2)_ |
| ❌ | Test mode clearly separates sandbox data from live data, with a persistent visual indicator _(data separation ✅; indicator is Phase 2)_ |
| ❌ | All 9 modules are registered; adding a 10th by following `MODULE_GUIDE.md` requires no core changes _(Phase 3)_ |
| ❌ | The BRSS staff portal covers the listed workflows end to end on seed data, with ported rules documented and source-cited _(Phase 4)_ |
| ✅ | Typecheck, lint, unit and end-to-end tests all pass; the secret scan is clean _(as of the last verification below)_ |

## Phase checklist

| Phase | Status |
|---|---|
| 0 — Plan | ✅ merged to `main` (Checkpoint 1 approved 10 Nov 2026) |
| 1 — Shared core | 🔨 built, review gate pending |
| 2 — SAI Console | ⏳ |
| 3 — Module scaffolds | ⏳ |
| 4 — BRSS proof module | ⏳ |

## Last verification

See the bottom of this file ("Verification log"). Updated after every phase step.

## Open defects

None known.

## Blocked

Nothing.

## Decisions awaiting the CTO's review

Listed in `docs/DECISIONS.md`, first table (R-1 … R-8).

## How to resume (for a fresh session)

1. Read this file, then `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`.
2. `git fetch origin && git checkout <current phase branch>` (see "Current phase and task").
3. `npm install && npm run setup` (starts Postgres in Docker; in a cloud container start `dockerd` first).
4. `npm run check` and `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e` must be green before changing anything.
5. Continue the loop from the CTO's instructions: plan → build → verify → review gate → UI gate → record → merge.

Guardrails that always apply: never push `--force`; never rewrite `main`; never touch
`../brss-salesforce` or run `sf`/`sfdx`; no real data, credentials or live keys; no new
non-trivial dependencies beyond those in DECISIONS A3; at most 2 subagents at once.

## Verification log
