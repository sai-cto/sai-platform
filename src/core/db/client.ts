/**
 * The database connection. Imported ONLY inside src/core (an ESLint rule enforces this).
 * Everything else reaches the database through withScope() / withPlatformScope() and the
 * record functions, which apply tenancy, permissions and the activity log.
 */
import crypto from 'node:crypto';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export type Db = PostgresJsDatabase;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

type Holder = { db: Db; sql: postgres.Sql };
// Kept on globalThis so Next.js hot reload does not open a new pool on every edit.
const globalForDb = globalThis as unknown as { __saiDb?: Holder };

export function getDb(): Db {
  if (!globalForDb.__saiDb) {
    const url = appDatabaseUrl();
    if (!url) throw new Error('DATABASE_URL is not set. Run "npm run setup" first.');
    // Serverless hosting runs many small instances: keep each one's pool small there.
    const sql = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX) || 10, onnotice: () => {} });
    globalForDb.__saiDb = { db: drizzle(sql), sql };
  }
  return globalForDb.__saiDb.db;
}

/**
 * The app's connection string. DATABASE_URL when set. On the hosted demo it may be left out:
 * it is then derived from DATABASE_OWNER_URL — same server, the restricted role `sai_app`,
 * and a password derived from the owner URL (`npm run demo:prepare` gives the role that
 * password). The app still connects as sai_app, so row-level security still applies.
 */
export function appDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const owner = process.env.DATABASE_OWNER_URL;
  if ((process.env.DEMO_MODE !== 'true' && process.env.PILOT_MODE !== 'true') || !owner) return undefined;
  // Only the production site uses the demo database: a preview of another branch must not.
  if (process.env.VERCEL && process.env.VERCEL_ENV !== 'production') return undefined;
  return derivedAppUrl(owner);
}

/**
 * sai_app's connection on the owner's server. The password is derived from the owner URL EXACTLY
 * as given (the hosting's DATABASE_OWNER_URL): any other spelling of it gives another password.
 */
export function derivedAppUrl(owner: string): string {
  const url = new URL(owner);
  url.username = 'sai_app';
  url.password = derivedAppPassword(owner);
  // Hosted Postgres "pooler" hosts may not know a role created by SQL: use the direct host.
  url.hostname = url.hostname.replace('-pooler.', '.');
  return url.toString();
}

/** A long password for sai_app that only someone holding the owner URL can work out. */
export function derivedAppPassword(ownerUrl: string): string {
  return `sa${crypto.createHmac('sha256', ownerUrl).update('sai_app-v1').digest('hex').slice(0, 40)}`;
}

export async function closeDb(): Promise<void> {
  const holder = globalForDb.__saiDb;
  globalForDb.__saiDb = undefined;
  if (holder) await holder.sql.end();
}
