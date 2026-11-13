# SAI Platform

One proprietary software platform for Student Agencies Inc. (SAI) and its nine student-run businesses.

- **SAI Console** — a single web app where the tech team sees, manages, tests and changes every business's software.
- **Shared core** — login, users, roles, customers, payments, scheduling, notifications, files, the activity log and analytics.
- **Business modules** — one per business, built on the core, with each business's data kept strictly separate.

**Where things stand right now:** see [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Set up (about 10 minutes)

You need [Node.js 22 or newer](https://nodejs.org) and [Docker Desktop](https://www.docker.com/products/docker-desktop/) (running).

```bash
git clone https://github.com/sai-cto/sai-platform.git
cd sai-platform
npm install
npm run setup
npm run dev
```

Then open <http://localhost:3000>.

`npm run setup` does everything else: it creates `.env.local` with local-only passwords, starts PostgreSQL in Docker, creates the database, and fills it with the 9 businesses, fake test users for every role and fake demo data. It is safe to run again.

## Signing in

Locally you sign in with **dev login**: the login page lists fake test users, one or more per role. Click one.

| Role | Sign in as | What you should see |
|---|---|---|
| Super admin | `cto@sai.example` | Everything |
| Tech team | `tech@sai.example` | Everything except permanent delete and platform settings |
| Executive | `ceo@sai.example` | Read-only view of every business |
| Business admin | `brss.admin@sai.example` (one per business: `hhmc.admin@…`, `sare.admin@…` …) | Their own business only |
| HHMC general manager | `hhmc.admin@sai.example` | Hired Hands: open **Hired Hands Moving Company → App** for leads, jobs, schedule, invoices |
| Business staff | `brss.staff@sai.example` | Their own business, limited permissions |
| Staff with nothing granted | `brss.newhire@sai.example` | Almost nothing — shows what "limited" means |
| Two businesses | `multi@sai.example` | Admin of Tutoring, staff of Bigger Beds |

Dev login only exists when `AUTH_DEV_LOGIN=true` and the app is not running in production mode. Microsoft 365 and Google Workspace sign-in are built but switched off until someone fills in their settings in `.env.local` (see `.env.example`).

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app at <http://localhost:3000> |
| `npm run check` | Typecheck, lint, integration tests and secret scan — run before every commit |
| `npm test` | Integration tests (need the database running) |
| `npm run test:e2e` | Browser tests (first time: `npx playwright install chromium`) |
| `npm run db:up` / `npm run db:down` | Start / stop the local database |
| `npm run db:generate` | Create a migration after changing a `schema.ts` file |
| `npm run db:migrate` | Apply migrations to the dev and test databases |
| `npm run db:reset` | Wipe the local dev database and re-seed it |
| `npm run db:backup` | Back up the local database to `backups/` (git-ignored). Do this before anything risky once real data is loaded; `npm run db:reset` does it by itself when the database holds imported Movegistics data |
| `npm run db:restore -- backups/<file>.dump --yes` | Replace the local database with a backup, in one transaction (the current data is backed up first). Stop `npm run dev` first; run `npm run db:migrate` afterwards if the backup is older than the code |
| `npm run docs:permissions` | Regenerate `docs/PERMISSIONS.md` after changing permissions |
| `npm run test:e2e:demo` | Browser tests of the hosted demo, locally (production build in demo mode) |
| `npm run hhmc:import` | Hired Hands only, local only: import Movegistics' exports into the local live data and reconcile (see `docs/hhmc-analysis/PLAN.md`, Phase 5C) |
| `npm run hhmc:import:real` | Hired Hands, local only: put Movegistics' seven list exports in `data/movegistics/` (git-ignored) and run this. Loads them into the local database's HHMC **live** data (the first run replaces the fake demo moves), re-runnable after every fresh export without duplicates, and prints the reconciliation (full report in `data/movegistics-reports/`). Optional: `data/movegistics/refund-amounts.csv` ("Payment ID","Refunded Amount") for partial refunds the export has no amount for |
| `npm run hhmc:import:pilot -- --confirm-host <host>` | Hired Hands: the same exports into the hosted pilot (Neon), after a `pg_dump` backup of it; needs `.env.pilot`. Runbook: [`docs/HHMC-PILOT-REFRESH.md`](docs/HHMC-PILOT-REFRESH.md) |
| `npm run hhmc:perf` | Hired Hands: how long each screen takes to load its data from the local database (median of 5), flagging anything over 500 ms. Fake full-scale data for it: `npx tsx scripts/hhmc-import/generate-fake-exports.ts --out <dir> --scale 2`, then `npm run hhmc:import -- --dir <dir> --clear-live-demo` |
| `npm run hhmc:automations` | Send Hired Hands' due automatic emails (no scheduler yet) |
| `npm run demo:seed` | Hosted demo only: wipe and re-seed the demo database (see `docs/DEPLOY-DEMO.md`) |
| `npm run secret-scan` | Check that no credential is about to be committed |

## Rules for this repository

- **Never commit credentials, API keys or real customer data.** Secrets live in `.env.local` (git-ignored). `.env.example` lists variable *names* only.
- Run `npm run check` before every commit.
- Seed and sandbox data is fake. Keep it that way.
- Work on a branch; `main` only moves by merging a finished, reviewed branch.

## Documentation

| File | Read it when |
|---|---|
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | You want to know what exists and what is next |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | You are about to change code |
| [`docs/MODULE_GUIDE.md`](docs/MODULE_GUIDE.md) | You are building or changing a business module |
| [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md) | You need to know who can do what |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | You wonder why something is the way it is |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | You are taking over the project |
| [`docs/DEPLOY-DEMO.md`](docs/DEPLOY-DEMO.md) | You want to put the HHMC site online (pilot with Microsoft sign-in, or fake-data demo) |
| [`src/modules/hhmc/README.md`](src/modules/hhmc/README.md) | You are working on Hired Hands (rules with sources) |
| [`src/modules/brss/README.md`](src/modules/brss/README.md) | You are working on the BRSS module (the first real one) |
| [`docs/brss-analysis/`](docs/brss-analysis/) | You want to know how the old BRSS Salesforce system behaves |
