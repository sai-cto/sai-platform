import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { ROOT } from './env';

/** Runs every pending migration in db/migrations against one database, as the owner role. */
export async function migrateDatabase(ownerUrl: string): Promise<void> {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: path.join(ROOT, 'db', 'migrations') });
  } finally {
    await sql.end();
  }
}

/** Removes every table so migrations can run from scratch. Local and test databases only. */
export async function dropEverything(ownerUrl: string): Promise<void> {
  const host = new URL(ownerUrl).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`Refusing to reset a database that is not local (${host}).`);
  }
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(
      'drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;',
    );
    await sql.unsafe('grant usage on schema public to sai_app;');
  } finally {
    await sql.end();
  }
}
