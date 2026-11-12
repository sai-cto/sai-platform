/**
 * npm run db:backup / db:restore (scripts/lib/backup.ts), on a throw-away database next to the
 * test database: a restore brings back exactly what was backed up, in one transaction, with the
 * app role's grants and row-level security; non-local databases are refused.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backupDatabase, holdsImportedData, restoreDatabase } from '../../scripts/lib/backup';
import { migrateDatabase } from '../../scripts/lib/db';

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL!;
const scratchUrl = (() => {
  const u = new URL(ownerUrl);
  u.pathname = '/sai_backup_check';
  return u.toString();
})();
// The tools come from this machine or from the database's Docker container.
const toolsAvailable =
  spawnSync('pg_dump', ['--version']).status === 0 || spawnSync('docker', ['compose', 'exec', '-T', 'db', 'pg_dump', '--version'], { cwd: path.resolve(__dirname, '../..') }).status === 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-backup-'));

async function onScratch<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(scratchUrl, { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

describe.skipIf(!toolsAvailable)('local backup and restore', () => {
  beforeAll(async () => {
    const admin = postgres(ownerUrl, { max: 1, onnotice: () => {} });
    await admin.unsafe('drop database if exists sai_backup_check');
    await admin.unsafe('create database sai_backup_check');
    await admin.end();
    await onScratch((sql) => sql.unsafe('grant usage on schema public to sai_app'));
    await migrateDatabase(scratchUrl);
    await onScratch((sql) => sql`insert into businesses (slug, code, name, description, accent_color, sort_order) values ('backupcheck', 'BKP', 'Backup check', 'Backup test', '#123456', 99)`);
  });

  afterAll(async () => {
    const admin = postgres(ownerUrl, { max: 1, onnotice: () => {} });
    await admin.unsafe('drop database if exists sai_backup_check with (force)');
    await admin.end();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('restores exactly what was backed up, keeping grants, row-level security and the log guard', async () => {
    const file = await backupDatabase(scratchUrl, { file: path.join(dir, 'check.dump') });
    expect(fs.statSync(file).size).toBeGreaterThan(0);
    await onScratch(async (sql) => {
      await sql`update businesses set name = 'Changed after the backup' where slug = 'backupcheck'`;
      await sql`create table made_after_backup (id int)`;
    });
    await restoreDatabase(scratchUrl, file);
    const after = await onScratch(async (sql) => ({
      name: (await sql`select name from businesses where slug = 'backupcheck'`)[0].name,
      extra: (await sql`select to_regclass('public.made_after_backup') as t`)[0].t,
      appCanRead: (await sql`select has_table_privilege('sai_app', 'hhmc_jobs', 'select') as ok`)[0].ok,
      rls: (await sql`select relrowsecurity as on from pg_class where relname = 'hhmc_jobs'`)[0].on,
      migrations: Number((await sql`select count(*) as n from drizzle.__drizzle_migrations`)[0].n),
      logGuard: Number((await sql`select count(*) as n from pg_trigger where not tgisinternal`)[0].n),
    }));
    expect(after).toMatchObject({ name: 'Backup check', extra: null, appCanRead: true, rls: true });
    expect(after.migrations).toBeGreaterThan(10);
    expect(after.logGuard).toBeGreaterThan(0);
  });

  it('db:reset knows when real Movegistics data is there (and backs it up first)', async () => {
    expect(await holdsImportedData(scratchUrl)).toBe(false);
    await onScratch(async (sql) => {
      const [b] = await sql`select id from businesses where slug = 'backupcheck'`;
      await sql`insert into hhmc_import_refs (business_id, environment, source, source_type, source_id, entity_key, record_id, content_hash)
                values (${b.id}, 'live', 'movegistics', 'contact', 'CN1', 'core.customer', gen_random_uuid(), 'x')`;
    });
    expect(await holdsImportedData(scratchUrl)).toBe(true);
  });

  it('a backup that cannot be restored leaves the database exactly as it was', async () => {
    const bad = path.join(dir, 'broken.dump');
    fs.writeFileSync(bad, 'not a backup');
    await expect(restoreDatabase(scratchUrl, bad)).rejects.toThrow();
    const name = await onScratch(async (sql) => (await sql`select name from businesses where slug = 'backupcheck'`)[0].name);
    expect(name).toBe('Backup check');
  });
});

describe('backup safety', () => {
  it('refuses a database that is not on this machine', async () => {
    await expect(backupDatabase('postgres://u:p@db.example.com:5432/sai')).rejects.toThrow(/this machine only/);
    await expect(restoreDatabase('postgres://u:p@db.example.com:5432/sai', __filename)).rejects.toThrow(/this machine only/);
  });
});
