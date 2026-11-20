# Refreshing HHMC's data from Movegistics (laptop and pilot site)

One set of Movegistics exports feeds both the local database (`localhost:3000`) and the hosted
pilot (Neon, behind `sai-platform-nu.vercel.app`). Run the same folder into both and their HHMC
dashboards show the same numbers. Every run is safe to repeat: records already imported are
updated, never duplicated, and anything a person changed in SAI is kept.

## Once per laptop

1. **`.env.pilot`** in the repository folder (git-ignored), holding the pilot's
   `DATABASE_OWNER_URL` from Neon › Connect (owner role, `sslmode=require`). Never commit it.
2. **`pg_dump` at least as new as Neon's PostgreSQL** (Mac: `brew install postgresql@17`, then
   follow brew's note to put it on your PATH). The pilot import uses it to back Neon up first.
3. **The site runs the latest `main`.** Deploying runs the migrations on Neon; the pilot import
   refuses while Neon's migrations differ from the code's.

## Every refresh

1. **Export from Movegistics** (view and download only). Use each list's All view, all columns, CSV:
   Contacts, Leads, Work Requests, Estimates, Work Orders, Invoices, Payments. Save them in
   `data/movegistics/<today, YYYY-MM-DD>/` (git-ignored). Optional:
   `refund-amounts.csv` there ("Payment ID","Refunded Amount") for partial refunds;
   `movegistics-companies.csv` (Sales › Companies › Export), kept on each customer (PAR-14); and a
   `settings/` folder with `terms-and-conditions.md` and `email-templates.md` copied from
   Movegistics' settings, which replace HHMC's placeholder templates (PAR-15; a template a manager
   changed in SAI is kept).
2. **Laptop:**
   ```bash
   npm run db:migrate
   ```
   ```bash
   npm run db:backup
   ```
   ```bash
   npm run hhmc:import:real
   ```
   It reads the newest dated folder (`-- --from <date>` for another) and prints the reconciliation.
3. **Pilot:**
   ```bash
   npm run hhmc:import:pilot -- --confirm-host <the Neon host, exactly as Neon shows it>
   ```
   It checks the target is the marked pilot database with this code's migrations, takes a
   `pg_dump` backup to `backups/pilot-<date>.dump`, then imports the same folder as the app role
   (row-level security on, HHMC live only), in batches of 50. Allow tens of minutes the first time;
   run it when nobody is using the site.
4. **Compare.** Both runs print an "All time" line (work requests, invoiced, collected, open
   balance; Movegistics / ours). The laptop's and the pilot's must be the same. Full reports:
   `data/movegistics-reports/RECONCILIATION-latest.md` and `RECONCILIATION-PILOT-latest.md`.
   Then open each site's HHMC dashboard with "All time": the numbers match.

Numbers differ only if someone changed or added HHMC records on one of the two by hand (the import
keeps their changes): that record is listed as "kept" in the run's output.

## Restoring the pilot

Prefer Neon's own restore: Neon console › the project › Branches › the production branch ›
**Restore** to a time just before the import (point-in-time restore; check the plan's history
window), or restore into a new branch first and look at it.

From the backup file instead (into a NEW, empty Neon branch, never over the live one):

```bash
pg_restore --no-owner --dbname "<that branch's owner connection string>" backups/pilot-<date>.dump
```

Then point the site at that branch in Vercel (a project setting: the CTO does this). The file holds
every business's data: keep it on the laptop, never share or commit it.

## Restoring the laptop

```bash
npm run db:restore -- backups/<file>.dump --yes
```

## When it refuses

| Message | What to do |
|---|---|
| `.env.pilot not found` / `DATABASE_OWNER_URL is not in .env.pilot` | Step "Once per laptop" 1 |
| `not marked as the pilot` | The URL is not the pilot's database |
| `migrations (…) are not this code's` | Deploy the latest `main`, wait for Vercel, re-run |
| `no pg_dump … or newer` | Install it (step 2), or make a Neon restore branch and add `--no-backup` |
| `the <list> export is missing` | Seven CSVs in the dated folder, one per list |
| `Movegistics values this importer does not know` | A new status in Movegistics: add it to the maps in `scripts/hhmc-import/movegistics.ts` on purpose |
