/**
 * One-command local setup:  npm run setup
 *   1. creates .env.local with local-only values (if it does not exist)
 *   2. starts PostgreSQL in Docker
 *   3. creates the restricted app role and the test database
 *   4. runs migrations on the dev and test databases
 *   5. seeds the dev database with the 9 businesses, test users and fake data
 * Safe to run again: every step checks before it acts.
 */
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { ENV_FILE, ROOT, loadEnv, requireEnv } from './lib/env';
import { migrateDatabase } from './lib/db';

function step(message: string) {
  console.log(`\n▸ ${message}`);
}

function createEnvFile() {
  if (fs.existsSync(ENV_FILE)) {
    console.log('  .env.local already exists, leaving it alone.');
    return;
  }
  const port = '5433';
  const ownerPassword = crypto.randomBytes(18).toString('hex');
  const appPassword = crypto.randomBytes(18).toString('hex');
  const url = (user: string, password: string, db: string) =>
    `postgres://${user}:${password}@127.0.0.1:${port}/${db}`;
  const values: Record<string, string> = {
    POSTGRES_PORT: port,
    POSTGRES_OWNER_PASSWORD: ownerPassword,
    POSTGRES_APP_PASSWORD: appPassword,
    DATABASE_URL: url('sai_app', appPassword, 'sai'),
    DATABASE_OWNER_URL: url('sai_owner', ownerPassword, 'sai'),
    TEST_DATABASE_URL: url('sai_app', appPassword, 'sai_test'),
    TEST_DATABASE_OWNER_URL: url('sai_owner', ownerPassword, 'sai_test'),
    APP_URL: 'http://localhost:3000',
    AUTH_DEV_LOGIN: 'true',
    FILE_STORAGE_DIR: './storage',
    PAYMENT_PROVIDER: 'mock',
  };
  const template = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const filled = template
    .split('\n')
    .map((line) => {
      const match = /^([A-Z0-9_]+)=$/.exec(line);
      return match && values[match[1]] !== undefined ? `${match[1]}=${values[match[1]]}` : line;
    })
    .join('\n');
  fs.writeFileSync(ENV_FILE, filled, { mode: 0o600 });
  console.log('  Created .env.local with generated local passwords.');
}

async function createRoleAndTestDatabase() {
  const sql = postgres(requireEnv('DATABASE_OWNER_URL'), { max: 1, onnotice: () => {} });
  try {
    const appPassword = requireEnv('POSTGRES_APP_PASSWORD');
    if (!/^[0-9a-zA-Z]+$/.test(appPassword))
      throw new Error('POSTGRES_APP_PASSWORD must be alphanumeric.');
    const [role] = await sql`select 1 from pg_roles where rolname = 'sai_app'`;
    // The app role cannot bypass row-level security and owns no tables.
    await sql.unsafe(
      `${role ? 'alter' : 'create'} role sai_app with login nosuperuser nobypassrls nocreatedb nocreaterole password '${appPassword}'`,
    );
    const [testDb] = await sql`select 1 from pg_database where datname = 'sai_test'`;
    if (!testDb) await sql.unsafe('create database sai_test');
  } finally {
    await sql.end();
  }
}

async function main() {
  step('Environment file');
  createEnvFile();
  loadEnv();

  step('Starting PostgreSQL (Docker)');
  execSync('docker compose --env-file .env.local up -d --wait', { cwd: ROOT, stdio: 'inherit' });

  step('Database role and test database');
  await createRoleAndTestDatabase();

  step('Migrations');
  await migrateDatabase(requireEnv('DATABASE_OWNER_URL'));
  await migrateDatabase(requireEnv('TEST_DATABASE_OWNER_URL'));
  console.log('  Dev and test databases are up to date.');

  step('Seed data');
  execSync('npx tsx scripts/seed.ts', { cwd: ROOT, stdio: 'inherit' });

  console.log(
    '\n✔ Setup complete. Start the app with:  npm run dev   then open http://localhost:3000',
  );
}

main().catch((error) => {
  console.error('\n✖ Setup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
