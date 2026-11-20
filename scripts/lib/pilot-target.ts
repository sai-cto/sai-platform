/**
 * The guard for writing to the hosted PILOT site's database (DECISIONS P5E-1), shared by
 * `npm run hhmc:import -- --target pilot` and `npm run hhmc:sync-to-pilot`.
 *
 * Reads ONLY .env.pilot; refuses a database on this machine, an unencrypted connection, a host
 * the person did not type, a database without the pilot mark, migrations that are not this
 * code's, and any app role other than sai_app (row-level security on). On success this process
 * points at the pilot (DATABASE_URL / DATABASE_OWNER_URL / PILOT_MODE are set) and the app URL
 * is returned for callers that open their own connection.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { ROOT } from './env';

export type PilotTarget = {
  /** "host / database", for printing. */
  label: string;
  /** The app role's (sai_app) connection string, certificate verified (verify-full). */
  appUrl: string;
};

/**
 * The pilot's app connection: DATABASE_URL from .env.pilot when given, else the site's own derived
 * sai_app URL. Derived from the owner URL as written in .env.pilot (as the site has it), and only
 * then switched to verify the certificate: deriving from the rewritten URL gives a wrong password.
 */
export async function pilotAppUrl(rawOwnerUrl: string, explicitAppUrl?: string): Promise<string> {
  if (explicitAppUrl) return explicitAppUrl;
  const { derivedAppUrl } = await import('../../src/core/db/client');
  const url = new URL(derivedAppUrl(rawOwnerUrl));
  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}

export const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'];

/**
 * --target pilot: point this process at the hosted pilot database, from .env.pilot only, after
 * checking it is the pilot (the mark its deploy put on it), it is not local, the connection is
 * encrypted, the host is the one the person typed, and its migrations are this code's.
 */
export async function connectPilotDatabase(confirmHost: string | undefined): Promise<PilotTarget> {
  const file = path.join(ROOT, '.env.pilot');
  if (!fs.existsSync(file)) throw new Error('Refusing: .env.pilot not found. Put DATABASE_OWNER_URL (from Neon or Vercel) in it first.');
  const env = dotenv.parse(fs.readFileSync(file));
  if (!env.DATABASE_OWNER_URL) throw new Error('Refusing: DATABASE_OWNER_URL is not in .env.pilot.');
  /** Same checks for every pilot URL; the certificate is always verified (verify-full). */
  const checked = (text: string, name: string) => {
    const u = new URL(text);
    if (LOCAL_HOSTS.includes(u.hostname)) throw new Error(`Refusing: ${name} in .env.pilot points at this machine. Use the normal import for the local database.`);
    if (!['require', 'verify-full', 'verify-ca'].includes(u.searchParams.get('sslmode') ?? '')) throw new Error(`Refusing: ${name} must use sslmode=require (an encrypted connection).`);
    if (u.searchParams.has('host') || u.searchParams.has('hostaddr')) throw new Error(`Refusing: ${name} gives a host in its query; not allowed.`);
    u.searchParams.set('sslmode', 'verify-full');
    return u;
  };
  const owner = checked(env.DATABASE_OWNER_URL, 'DATABASE_OWNER_URL');
  const ownerText = owner.toString();
  const bare = (h: string) => h.replace('-pooler.', '.');
  // Typed by the person, not printed back by this script.
  if (!confirmHost || bare(confirmHost) !== bare(owner.hostname))
    throw new Error('Refusing: --confirm-host must be the pilot database host exactly as shown in Neon (Connect).');
  // The app connection: DATABASE_URL from .env.pilot, or derived the way the site derives it.
  delete process.env.DATABASE_URL;
  process.env.PILOT_MODE = 'true';
  delete process.env.DEMO_MODE;
  process.env.DATABASE_OWNER_URL = ownerText;
  if (env.DATABASE_URL) process.env.DATABASE_URL = checked(env.DATABASE_URL, 'DATABASE_URL').toString();
  // As on the site itself (a `vercel env pull` file can carry these and would hide the app URL).
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  process.env.DATABASE_POOL_MAX = '3';
  const appText = await pilotAppUrl(env.DATABASE_OWNER_URL, process.env.DATABASE_URL);
  process.env.DATABASE_URL = appText;
  const postgres = (await import('postgres')).default;
  const mark = (sql: import('postgres').Sql) =>
    sql`select current_database() as name, shobj_description(oid, 'pg_database') as note from pg_database where datname = current_database()`;
  // The APP connection (the one that writes): it must reach the marked pilot database, as sai_app,
  // a role that is not a superuser and cannot bypass row-level security.
  const app = postgres(appText, { max: 1, onnotice: () => {} });
  let dbName: string;
  try {
    const [db] = await mark(app);
    if (db?.note !== 'sai-pilot-database') throw new Error('Refusing: this database is not marked as the pilot (deploy the site in pilot mode first).');
    dbName = String(db.name);
    const [role] = await app`select current_user as name, rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
    if (role?.name !== 'sai_app' || role.rolsuper || role.rolbypassrls)
      throw new Error('Refusing: the import must write as sai_app with row-level security on. Remove DATABASE_URL from .env.pilot to use the site\'s own app role.');
  } finally {
    await app.end();
  }
  // Read-only with the owner connection: the same database, and its migrations are exactly this code's.
  const sql = postgres(ownerText, { max: 1, onnotice: () => {} });
  try {
    const [db] = await mark(sql);
    if (db?.note !== 'sai-pilot-database' || String(db.name) !== dbName) throw new Error('Refusing: DATABASE_OWNER_URL and the app connection reach different databases.');
    const journal = JSON.parse(fs.readFileSync(path.join(ROOT, 'db/migrations/meta/_journal.json'), 'utf8')) as { entries: { when: number }[] };
    const [applied] = await sql`select count(*)::int as n, max(created_at)::text as last from drizzle.__drizzle_migrations`;
    const last = journal.entries.at(-1)!.when;
    if (applied.n !== journal.entries.length || Number(applied.last) !== last)
      throw new Error(`Refusing: the pilot database's migrations (${applied.n}) are not this code's (${journal.entries.length}). Deploy the latest main to the site first.`);
  } finally {
    await sql.end();
  }
  return { label: `${bare(owner.hostname)} / ${dbName}`, appUrl: appText };
}
