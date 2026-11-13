# Backups and restore

Two databases matter: the **pilot** (Neon, behind sai-platform-nu.vercel.app) and the **laptop**
copy (local Postgres in Docker). Both hold real HHMC customer data once Movegistics is imported:
backup files never go in git (`backups/` is ignored), chat, email or shared drives.

## Pilot (Neon)

### What protects it

1. **Neon point-in-time restore (history).** Neon keeps the write history of every branch for the
   project's history retention window (set per plan: Neon console › the project › Settings ›
   Storage / History retention). Within that window any moment can be restored. Check the window
   before the demo and keep it at 7 days or more if the plan allows.
2. **A `pg_dump` before every import.** `npm run hhmc:import:pilot` writes
   `backups/pilot-<date>.dump` on the laptop before it changes anything (`--no-backup` skips it;
   only use that right after making a Neon restore branch).
3. **Additive migrations only.** Schema changes add tables and columns; nothing is dropped or
   truncated, so an older backup restores into the current code with `npm run db:migrate`.

### Restore, preferred: Neon's own

1. Neon console › the project › **Branches** › the production branch.
2. **Restore** › pick a time just before the problem (e.g. just before an import).
   Safer first step: restore *into a new branch*, open it with the SQL editor or a local
   `psql`, and check it.
3. Neon keeps the replaced state as a backup branch, so the restore itself can be undone.
4. The site's connection string does not change when the production branch is restored in place.
   Pointing the site at a different branch is a Vercel environment-variable change: the CTO does it.

### Restore from a dump file

Into a NEW, empty Neon branch, never over the live one:

```bash
pg_restore --no-owner --dbname "<that branch's owner connection string>" backups/pilot-<date>.dump
```

The dump holds every business's data. Then follow step 4 above.

### Test the restore

Once before the demo, and then monthly: restore the production branch into a new branch as of an
hour ago, count rows in a few tables (`select count(*) from hhmc_jobs;`), compare with the
dashboard, then delete the branch.

## Laptop

```bash
npm run db:backup
```

Writes `backups/sai-<date>.dump`.

```bash
npm run db:restore -- backups/<file>.dump --yes
```

Backs up the current database first (`backups/sai-before-restore-<date>.dump`), then replaces it in
one transaction (all or nothing). Stop `npm run dev` first; run `npm run db:migrate` afterwards if
the backup is older than the code. These two commands refuse any database that is not on this
machine.

## Who

The CTO holds the Neon and Vercel accounts and runs restores. The tech team can run the laptop
commands and `hhmc:import:pilot`. See [HHMC-PILOT-REFRESH.md](HHMC-PILOT-REFRESH.md) for the import
routine.
