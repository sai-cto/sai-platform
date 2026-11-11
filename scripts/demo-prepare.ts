/**
 * Prepares the hosted demo database. Runs on every deploy (Vercel build: `npm run demo:build`)
 * and by hand to reset the demo (`npm run demo:seed`, which passes --reset).
 *
 *   1. makes sure the restricted app role `sai_app` exists (password derived from the owner
 *      URL, unless DATABASE_URL is given explicitly);
 *   2. with --reset (or DEMO_RESET_ON_DEPLOY=yes): wipes the demo database;
 *   3. applies migrations;
 *   4. seeds the fake businesses and data if the database is empty;
 *   5. creates or updates the demo accounts from DEMO_ACCOUNTS (passwords stay in the env).
 *
 * Safety, because it can change roles and wipe data:
 *   - refuses unless DEMO_MODE=true;
 *   - on Vercel, does nothing except for PRODUCTION builds (preview builds of other branches
 *     never touch the demo database);
 *   - touches only a database that is empty or carries the demo marker
 *     (platform_settings 'demo_database'), which it sets when it first seeds one.
 */
import postgres from 'postgres';
import { loadEnv, requireEnv } from './lib/env';
import { migrateDatabase } from './lib/db';

async function main() {
  loadEnv();
  if (process.env.DEMO_MODE !== 'true') throw new Error('demo:prepare only runs with DEMO_MODE=true.');
  if (process.env.VERCEL && process.env.VERCEL_ENV !== 'production') {
    console.log(`  Not a production deploy (${process.env.VERCEL_ENV}): the demo database is left alone.`);
    return;
  }
  const ownerUrl = requireEnv('DATABASE_OWNER_URL');
  const reset = process.argv.includes('--reset') || process.env.DEMO_RESET_ON_DEPLOY === 'yes';
  const { derivedAppPassword, closeDb, getDb } = await import('../src/core/db/client');
  const { parseDemoAccounts } = await import('../src/core/demo/demo');

  const accounts = parseDemoAccounts(process.env.DEMO_ACCOUNTS);
  for (const problem of accounts.problems) console.warn(`  ! DEMO_ACCOUNTS: ${problem}`);
  if (accounts.accounts.length === 0) throw new Error('DEMO_ACCOUNTS has no valid account. See docs/DEPLOY-DEMO.md.');
  if ((process.env.DEMO_ACCESS_PASSWORD ?? '').length < 12)
    throw new Error('DEMO_ACCESS_PASSWORD must be set (at least 12 characters). See docs/DEPLOY-DEMO.md.');

  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    // Only an empty database, or one this script set up, may be touched.
    const [table] = await sql`select to_regclass('public.platform_settings') as t`;
    if (table.t) {
      const [marker] = await sql`select 1 from platform_settings where key = 'demo_database'`;
      if (!marker)
        throw new Error('This database is not empty and is not marked as the demo database. Refusing to touch it. Use a new, empty database for the demo.');
    }
    const [role] = await sql`select 1 from pg_roles where rolname = 'sai_app'`;
    if (!process.env.DATABASE_URL) {
      const password = derivedAppPassword(ownerUrl);
      // The app role cannot bypass row-level security and owns no tables.
      await sql.unsafe(`${role ? 'alter' : 'create'} role sai_app with login nobypassrls nocreatedb nocreaterole password '${password}'`);
      console.log(`  ${role ? 'Updated' : 'Created'} the app role sai_app.`);
    } else if (!role) {
      throw new Error('DATABASE_URL is set but the role sai_app does not exist. Remove DATABASE_URL to let this script create it.');
    }
    if (reset) {
      await sql.unsafe('drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;');
      console.log('  Wiped the demo database.');
    }
    await sql.unsafe('grant usage on schema public to sai_app;');
  } finally {
    await sql.end();
  }

  await migrateDatabase(ownerUrl);
  console.log('  Migrations applied.');

  const { businesses } = await import('../src/core/db/schema');
  const seeded = await getDb().$count(businesses);
  if (seeded === 0) {
    const { seedAll } = await import('../src/seed/run');
    await seedAll({ demoData: true });
    console.log('  Seeded the fake businesses and demo data.');
  } else {
    console.log('  Demo data already there (use npm run demo:seed to start again).');
  }
  // Mark this database as the demo one (lets later deploys and resets touch it).
  const marker = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    await marker`insert into platform_settings (key, value) values ('demo_database', 'true'::jsonb) on conflict (key) do nothing`;
  } finally {
    await marker.end();
  }
  const { upsertDemoAccounts } = await import('../src/seed/demo-accounts');
  for (const line of await upsertDemoAccounts(accounts.accounts, { switchOffOthers: true })) console.log(`  Demo account ready: ${line}`);
  await closeDb();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
