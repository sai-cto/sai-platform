/**
 * The laptop → pilot copy engine (scripts/hhmc-sync/engine.ts), between two LOCAL databases:
 * the test database is the "laptop", a scratch database on the same server (migrated, marked as
 * the pilot, with its own business ids and users) is the "website". Both are reached as the app
 * role sai_app, as in the real command. The host/TLS guard is not exercised here.
 */
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareDatabases, SYNC_KEY, syncDatabases } from '../../scripts/hhmc-sync/engine';
import { migrateDatabase } from '../../scripts/lib/db';
import { USERS } from './helpers';

const scratchName = `sai_sync_scratch_${process.pid}`;
const withDb = (url: string, name: string) => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
};
const opts = { max: 1, onnotice: () => {} };

let srcOwner: postgres.Sql; // the "laptop", as the owner (test set-up only)
let source: postgres.Sql; // the "laptop", as sai_app
let dstOwner: postgres.Sql; // the "website", as the owner (test set-up and inspection only)
let target: postgres.Sql; // the "website", as sai_app
let admin: postgres.Sql;
const ids = { srcHhmc: '', dstHhmc: '', dstBrss: '', dstUser: '', srcFile: '', srcImport: '', srcFlag: '' };

/** Runs as sai_app on the website inside HHMC's tenant context, like the app does. */
const asWebsite = <T>(environment: string, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
  target.begin(async (tx) => {
    await tx`select set_config('app.scope', 'business', true), set_config('app.business_id', ${ids.dstHhmc}, true), set_config('app.environment', ${environment}, true)`;
    return fn(tx);
  }) as Promise<T>;

beforeAll(async () => {
  const ownerUrl = process.env.TEST_DATABASE_OWNER_URL as string;
  admin = postgres(ownerUrl, opts);
  await admin.unsafe(`drop database if exists ${scratchName} with (force)`);
  await admin.unsafe(`create database ${scratchName}`);
  await admin.unsafe(`comment on database ${scratchName} is 'sai-pilot-database'`);
  const scratchOwner = withDb(ownerUrl, scratchName);
  await migrateDatabase(scratchOwner);
  dstOwner = postgres(scratchOwner, opts);
  target = postgres(withDb(process.env.TEST_DATABASE_URL as string, scratchName), opts);
  srcOwner = postgres(ownerUrl, opts);
  source = postgres(process.env.TEST_DATABASE_URL as string, opts);

  // The website: its own business ids, one user with the HHMC admin's email (in other case), and
  // data that must never be touched (HHMC test mode, another business).
  const [h] = await dstOwner`insert into businesses (slug, code, name, description, accent_color, sort_order)
    values ('hhmc', 'HHMC', 'Old name', 'old', '#000000', 1) returning id::text`;
  const [b] = await dstOwner`insert into businesses (slug, code, name, description, accent_color, sort_order)
    values ('brss', 'BRSS', 'Other business', 'other', '#111111', 2) returning id::text`;
  ids.dstHhmc = h.id;
  ids.dstBrss = b.id;
  await dstOwner`insert into business_modules (business_id, module_key, settings) values (${h.id}, 'hhmc', '{"old": true}'), (${b.id}, 'brss', '{}')`;
  const [u] = await dstOwner`insert into users (email, name) values (${USERS.hhmcAdmin.toUpperCase()}, 'Website user') returning id::text`;
  ids.dstUser = u.id;
  await dstOwner`insert into customers (business_id, environment, first_name) values
    (${h.id}, 'sandbox', 'Practice'), (${b.id}, 'live', 'Other business customer')`;

  // The laptop: a file (never copied) linked from an import, and an HHMC feature flag.
  const [sh] = await srcOwner`select id::text from businesses where slug = 'hhmc'`;
  ids.srcHhmc = sh.id;
  const [f] = await srcOwner`insert into files (business_id, environment, storage_key, filename, content_type, size_bytes)
    values (${sh.id}, 'live', 'sync-test/key', 'sync-test.csv', 'text/csv', 10) returning id::text`;
  ids.srcFile = f.id;
  const [ij] = await srcOwner`insert into import_jobs (business_id, environment, entity_key, filename, file_id)
    values (${sh.id}, 'live', 'customers', 'sync-test.csv', ${f.id}) returning id::text`;
  ids.srcImport = ij.id;
  const [fl] = await srcOwner`insert into feature_flags (key, business_id, enabled, description)
    values ('sync_test_flag', ${sh.id}, true, 'test') returning id::text`;
  ids.srcFlag = fl.id;
  // A customer on the laptop created by the HHMC admin (mapped by email on the website).
  const [admin1] = await srcOwner`select id::text from users where email = ${USERS.hhmcAdmin}`;
  await srcOwner`insert into customers (business_id, environment, first_name, created_by) values (${sh.id}, 'live', 'Sync test', ${admin1.id})`;
  // And a log entry by them (the log is append-only: this one stays in the test database).
  await srcOwner`insert into activity_log (actor_user_id, actor_name, actor_role, business_id, environment, action, entity_type, summary)
    values (${admin1.id}, 'Admin', 'admin', ${sh.id}, 'live', 'create', 'sync-test', 'Sync test entry')`;
});

afterAll(async () => {
  if (srcOwner) {
    if (ids.srcImport) await srcOwner`delete from import_jobs where id = ${ids.srcImport}`;
    if (ids.srcFile) await srcOwner`delete from files where id = ${ids.srcFile}`;
    if (ids.srcFlag) await srcOwner`delete from feature_flags where id = ${ids.srcFlag}`;
  }
  await Promise.all([source?.end(), target?.end(), srcOwner?.end(), dstOwner?.end()]);
  await admin?.unsafe(`drop database if exists ${scratchName} with (force)`);
  await admin?.end();
});

describe('HHMC laptop → website copy', () => {
  it('refuses a never-copied website that already holds HHMC live data, unless --first-copy and nobody used it', async () => {
    await dstOwner`insert into customers (business_id, environment, first_name) values (${ids.dstHhmc}, 'live', 'Imported earlier')`;
    // An import straight into the website logged as the system (no user): allowed by --first-copy,
    // but the log can never be deleted, so it must also be on the laptop.
    const [entry] = await dstOwner`insert into activity_log (actor_name, actor_role, business_id, environment, action, entity_type, summary)
      values ('Movegistics import', 'super_admin', ${ids.dstHhmc}, 'live', 'create', 'sync-test-import', 'Imported') returning id::text, occurred_at::text`;
    await expect(syncDatabases(source, target)).rejects.toThrow(/no copy has been recorded.*activity_log, customers.*--first-copy/);
    await expect(syncDatabases(source, target, { firstCopy: true })).rejects.toThrow(/activity_log has 1 HHMC live entries that are not on this laptop/);
    const [still] = await dstOwner`select count(*)::int as n from customers where first_name = 'Imported earlier'`;
    expect(still.n).toBe(1);
    await srcOwner`insert into activity_log (id, occurred_at, actor_name, actor_role, business_id, environment, action, entity_type, summary)
      values (${entry.id}, ${entry.occurred_at}::timestamptz, 'Movegistics import', 'super_admin', ${ids.srcHhmc}, 'live', 'create', 'sync-test-import', 'Imported')`;
    const r = await syncDatabases(source, target, { firstCopy: true });
    expect(r.firstCopy).toBe(true);
    const [gone] = await dstOwner`select count(*)::int as n from customers where first_name = 'Imported earlier'`;
    expect(gone.n).toBe(0);
  });

  it('makes every table match, maps users by email, copies settings, never copies files', async () => {
    const c = await compareDatabases(source, target);
    expect(c.allMatch).toBe(true);
    expect(c.rows.find((r) => r.table === 'files')).toBeUndefined();
    expect(c.rows.find((r) => r.table === 'customers')!.website).toBeGreaterThan(0);
    expect(c.rows.find((r) => r.table === 'hhmc_jobs')!.website).toBeGreaterThan(0);
    expect(c.files.local).toBeGreaterThan(0);
    expect(c.files.website).toBe(0);
    expect(c.changedSinceLastCopy).toEqual([]);

    const [cust] = await dstOwner`select created_by::text from customers where business_id = ${ids.dstHhmc} and first_name = 'Sync test'`;
    expect(cust.created_by).toBe(ids.dstUser);
    const users = await dstOwner`select distinct created_by::text as id from customers where business_id = ${ids.dstHhmc} and created_by is not null`;
    expect(users.map((x) => x.id)).toEqual([ids.dstUser]);
    const [log] = await dstOwner`select actor_user_id::text as a from activity_log where entity_type = 'sync-test'`;
    expect(log.a).toBe(ids.dstUser);
    const [imp] = await dstOwner`select file_id from import_jobs where id = ${ids.srcImport}`;
    expect(imp.file_id).toBeNull();

    const [biz] = await dstOwner`select slug, name, id::text from businesses where id = ${ids.dstHhmc}`;
    const [srcBiz] = await srcOwner`select name from businesses where slug = 'hhmc'`;
    expect(biz).toMatchObject({ slug: 'hhmc', name: srcBiz.name, id: ids.dstHhmc });
    const [mod] = await dstOwner`select settings::text as s from business_modules where business_id = ${ids.dstHhmc}`;
    const [srcMod] = await srcOwner`select settings::text as s from business_modules where business_id = ${ids.srcHhmc}`;
    expect(mod.s).toBe(srcMod.s);
    const flags = await dstOwner`select key, enabled from feature_flags where business_id = ${ids.dstHhmc}`;
    expect(flags.map((f) => [f.key, f.enabled])).toEqual([['sync_test_flag', true]]);
    const [stored] = await dstOwner`select value from platform_settings where key = ${SYNC_KEY}`;
    expect(stored.value.fingerprint.tables.customers.rows).toBeGreaterThan(0);
  });

  it('leaves HHMC test mode and other businesses on the website alone', async () => {
    const rows = await dstOwner`select business_id::text as b, environment::text as e, first_name from customers
      where not (business_id = ${ids.dstHhmc} and environment = 'live') order by first_name`;
    expect(rows.map((r) => [r.b, r.e, r.first_name])).toEqual([
      [ids.dstBrss, 'live', 'Other business customer'],
      [ids.dstHhmc, 'sandbox', 'Practice'],
    ]);
    const [brss] = await dstOwner`select name from businesses where id = ${ids.dstBrss}`;
    expect(brss.name).toBe('Other business');
  });

  it('copies again when the website is unchanged, keeping the append-only log', async () => {
    await srcOwner`insert into customers (business_id, environment, first_name) values (${ids.srcHhmc}, 'live', 'Added on the laptop')`;
    const before = await compareDatabases(source, target);
    expect(before.allMatch).toBe(false);
    expect(before.rows.find((r) => r.table === 'customers')!.matches).toBe(false);
    const r = await syncDatabases(source, target);
    expect(r.firstCopy).toBe(false);
    expect(r.logAlreadyThere).toBeGreaterThan(0);
    expect(r.comparison.allMatch).toBe(true);
    expect((await compareDatabases(source, target)).allMatch).toBe(true);
  });

  it('--check reads only: nothing on the website changes', async () => {
    await srcOwner`insert into customers (business_id, environment, first_name) values (${ids.srcHhmc}, 'live', 'Not copied by check')`;
    const snapshot = async () => {
      const [s] = await dstOwner`select value::text as v, updated_at::text as t from platform_settings where key = ${SYNC_KEY}`;
      const [n] = await dstOwner`select count(*)::int as n from customers`;
      return { ...s, n: n.n };
    };
    const a = await snapshot();
    const c = await compareDatabases(source, target);
    expect(c.allMatch).toBe(false);
    expect(c.changedSinceLastCopy).toEqual([]);
    expect(await snapshot()).toEqual(a);
  });

  it('refuses, and changes nothing, once someone has changed the website', async () => {
    // A manager edits a customer on the website (the app logs it under their user id).
    await asWebsite('live', async (tx) => {
      await tx`update customers set notes = 'Changed on the website' where first_name = 'Sync test'`;
      await tx`insert into activity_log (actor_user_id, actor_name, actor_role, business_id, environment, action, entity_type, summary)
        values (${ids.dstUser}, 'Manager', 'admin', ${ids.dstHhmc}, 'live', 'update', 'customer', 'Edited')`;
    });
    await expect(syncDatabases(source, target)).rejects.toThrow(/changed since the last copy.*activity_log, customers.*Nothing was changed/);
    const [still] = await dstOwner`select notes from customers where business_id = ${ids.dstHhmc} and first_name = 'Sync test'`;
    expect(still.notes).toBe('Changed on the website');
    const c = await compareDatabases(source, target);
    expect(c.changedSinceLastCopy).toEqual(['activity_log', 'customers']);

    // Without the record of the last copy, --first-copy still refuses: people signed in used it.
    await dstOwner`delete from platform_settings where key = ${SYNC_KEY}`;
    await expect(syncDatabases(source, target, { firstCopy: true })).rejects.toThrow(/made by people signed in/);
  });
});
