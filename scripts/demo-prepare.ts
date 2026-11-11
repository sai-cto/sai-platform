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
 *   - touches only a database that is EMPTY (no tables) or carries its mark (the database
 *     comment 'sai-demo-database', set the first time it prepares an empty database).
 */
import postgres from 'postgres';
import { loadEnv, requireEnv } from './lib/env';
import { migrateDatabase } from './lib/db';

/** The comment on the database that lets this script touch it (see the safety notes above). */
const MARKS = { demo: 'sai-demo-database', pilot: 'sai-pilot-database' } as const;

async function main() {
  loadEnv();
  const demo = process.env.DEMO_MODE === 'true';
  const pilot = process.env.PILOT_MODE === 'true';
  if (demo && pilot) throw new Error('DEMO_MODE and PILOT_MODE cannot both be on.');
  if (!demo && !pilot) throw new Error('This script only runs with DEMO_MODE=true or PILOT_MODE=true.');
  const mode = demo ? 'demo' : 'pilot';
  const DEMO_MARK = MARKS[mode];
  if (process.env.VERCEL && process.env.VERCEL_ENV !== 'production') {
    console.log(`  Not a production deploy (${process.env.VERCEL_ENV}): the database is left alone.`);
    return;
  }
  const ownerUrl = requireEnv('DATABASE_OWNER_URL');
  const reset = process.argv.includes('--reset') || process.env.DEMO_RESET_ON_DEPLOY === 'yes';
  // The pilot holds REAL data: nothing here may ever wipe it.
  if (pilot && reset) throw new Error('The pilot holds real data: a reset is refused. Remove DEMO_RESET_ON_DEPLOY.');
  const { derivedAppPassword, closeDb, getDb } = await import('../src/core/db/client');
  const { parseDemoAccounts } = await import('../src/core/demo/demo');
  const { parsePilotAccounts } = await import('../src/core/demo/pilot');

  const accounts = demo ? parseDemoAccounts(process.env.DEMO_ACCOUNTS) : { accounts: [], problems: [] };
  const pilotAccounts = pilot ? parsePilotAccounts(process.env.PILOT_ACCOUNTS) : { accounts: [], problems: [] };
  for (const problem of [...accounts.problems, ...pilotAccounts.problems]) console.warn(`  ! accounts: ${problem}`);
  if (demo && accounts.accounts.length === 0) throw new Error('DEMO_ACCOUNTS has no valid account. See docs/DEPLOY-DEMO.md.');
  if (demo && (process.env.DEMO_ACCESS_PASSWORD ?? '').length < 12)
    throw new Error('DEMO_ACCESS_PASSWORD must be set (at least 12 characters). See docs/DEPLOY-DEMO.md.');
  if (pilot && pilotAccounts.accounts.length === 0) throw new Error('PILOT_ACCOUNTS has no valid account. See docs/DEPLOY-DEMO.md.');
  if (pilot && !(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET && process.env.MICROSOFT_TENANT_ID))
    console.warn('  ! Microsoft sign-in is not configured yet (MICROSOFT_CLIENT_ID / _SECRET / _TENANT_ID): nobody can sign in until it is.');

  // The app's connection (DATABASE_URL, when given) must be the SAME database as the owner's,
  // and must NOT be the owner role (which would bypass row-level security).
  if (process.env.DATABASE_URL) {
    const a = new URL(process.env.DATABASE_URL);
    const b = new URL(ownerUrl);
    if (a.username === b.username)
      throw new Error('DATABASE_URL uses the owner role: the app must connect as the restricted role sai_app.');
    if (a.hostname.replace('-pooler.', '.') !== b.hostname.replace('-pooler.', '.') || a.port !== b.port || a.pathname !== b.pathname)
      throw new Error('DATABASE_URL and DATABASE_OWNER_URL point at different databases. Refusing to continue.');
  }
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    // Only an EMPTY database, or one this script marked as the demo, may be touched. The mark
    // is a comment on the database itself, so it survives a wipe that is interrupted halfway.
    const [db] = await sql`select shobj_description(oid, 'pg_database') as note from pg_database where datname = current_database()`;
    const other = Object.values(MARKS).find((m) => m !== DEMO_MARK && m === db?.note);
    if (other)
      throw new Error(`This database is set up as the ${other === MARKS.pilot ? 'real-data pilot' : 'fake-data demo'}. Use a new, empty database for the ${mode}.`);
    if (db?.note !== DEMO_MARK) {
      // Any table, view or sequence in any schema except Postgres' own means "not empty".
      const [tables] = await sql`select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'`;
      if (tables.n > 0)
        throw new Error('This database is not empty and is not marked as the demo database. Refusing to touch it. Use a new, empty database for the demo.');
      const name = String((await sql`select current_database() as d`)[0].d);
      await sql.unsafe(`comment on database "${name.replace(/"/g, '""')}" is '${DEMO_MARK}'`);
      console.log(`  Marked this empty database for the ${mode}.`);
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
    if (pilot) {
      // Real data: the businesses only, no fake users; fake demo data in TEST MODE only.
      await seedAll({ demoData: true, fakeUsers: false, demoEnvironments: ['sandbox'] });
      console.log('  Set up the businesses (live data empty; fake data in test mode only).');
    } else {
      await seedAll({ demoData: true });
      console.log('  Seeded the fake businesses and demo data.');
    }
  } else {
    console.log('  Demo data already there (use npm run demo:seed to start again).');
  }
  const { upsertDemoAccounts, upsertPilotAccounts } = await import('../src/seed/demo-accounts');
  if (demo)
    for (const line of await upsertDemoAccounts(accounts.accounts, { switchOffOthers: true })) console.log(`  Demo account ready: ${line}`);
  else for (const line of await upsertPilotAccounts(pilotAccounts.accounts)) console.log(`  Account ready (Microsoft sign-in): ${line}`);
  await closeDb();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
