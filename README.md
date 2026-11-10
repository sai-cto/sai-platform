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
| `npm run docs:permissions` | Regenerate `docs/PERMISSIONS.md` after changing permissions |
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
| [`docs/brss-analysis/`](docs/brss-analysis/) | You are working on the BRSS module |
