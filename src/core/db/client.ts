/**
 * The database connection. Imported ONLY inside src/core (an ESLint rule enforces this).
 * Everything else reaches the database through withScope() / withPlatformScope() and the
 * record functions, which apply tenancy, permissions and the activity log.
 */
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export type Db = PostgresJsDatabase;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

type Holder = { db: Db; sql: postgres.Sql };
// Kept on globalThis so Next.js hot reload does not open a new pool on every edit.
const globalForDb = globalThis as unknown as { __saiDb?: Holder };

export function getDb(): Db {
  if (!globalForDb.__saiDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set. Run "npm run setup" first.');
    const sql = postgres(url, { max: 10, onnotice: () => {} });
    globalForDb.__saiDb = { db: drizzle(sql), sql };
  }
  return globalForDb.__saiDb.db;
}

export async function closeDb(): Promise<void> {
  const holder = globalForDb.__saiDb;
  globalForDb.__saiDb = undefined;
  if (holder) await holder.sql.end();
}
