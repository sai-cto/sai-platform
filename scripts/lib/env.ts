import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

export const ROOT = path.resolve(__dirname, '..', '..');
export const ENV_FILE = path.join(ROOT, '.env.local');

/** Loads .env.local into process.env (scripts and tests; Next.js loads it itself). */
export function loadEnv(): void {
  if (fs.existsSync(ENV_FILE)) dotenv.config({ path: ENV_FILE, quiet: true });
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run "npm run setup" first.`);
  return value;
}
