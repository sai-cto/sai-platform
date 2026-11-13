/**
 * Local database backup and restore (pg_dump / pg_restore), for the real HHMC data on a laptop.
 *
 * Local databases only: a URL whose host is not this machine is refused. The PostgreSQL tools
 * come from this machine when they are at least the server's version, otherwise from inside the
 * Docker container that runs the database (`docker compose exec db …`), so nothing has to be
 * installed. A restore replaces the whole database in ONE transaction: if anything fails, the
 * database is left exactly as it was.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { ROOT } from './env';

const LOCAL = ['localhost', '127.0.0.1', '[::1]', '::1'];

type Target = { host: string; port: string; user: string; password: string; database: string };

function targetOf(ownerUrl: string): Target {
  const url = new URL(ownerUrl);
  if (!LOCAL.includes(url.hostname.toLowerCase())) throw new Error(`Refusing: backup and restore are for a database on this machine only (not ${url.hostname}).`);
  if (url.searchParams.has('host') || url.searchParams.has('hostaddr')) throw new Error('Refusing: a host given in the database URL query is not allowed.');
  return { host: url.hostname, port: url.port || '5432', user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.replace(/^\//, '') };
}

async function serverMajor(ownerUrl: string): Promise<number> {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    const [row] = await sql<{ v: string }[]>`select current_setting('server_version_num') as v`;
    return Math.floor(Number(row.v) / 10000);
  } finally {
    await sql.end();
  }
}

function localMajor(tool: string): number | null {
  const r = spawnSync(tool, ['--version'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const m = /(\d+)(?:\.\d+)?/.exec(r.stdout);
  return m ? Number(m[1]) : null;
}

type IO = { input?: Buffer | string; outFile?: string };
/** `connect`: pass the connection (database) arguments; pg_restore writing SQL must not get them. */
type Runner = { kind: 'local' | 'docker'; run: (tool: 'pg_dump' | 'pg_restore' | 'psql', args: string[], io: IO, connect?: boolean) => Buffer };

/** Runs a PostgreSQL tool against the target: this machine's, or the database container's. */
async function runnerFor(ownerUrl: string): Promise<Runner> {
  const t = targetOf(ownerUrl);
  const major = await serverMajor(ownerUrl);
  const tools = ['pg_dump', 'pg_restore', 'psql'] as const;
  const exec = (cmd: string, args: string[], env: NodeJS.ProcessEnv, io: IO) => {
    const r = spawnSync(cmd, args, { env, input: io.input, maxBuffer: 2 ** 31 - 1, cwd: ROOT });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`${args[0] ?? cmd} failed: ${r.stderr.toString().trim().split('\n').slice(-3).join(' ')}`);
    if (io.outFile) fs.writeFileSync(io.outFile, r.stdout, { mode: 0o600 });
    return r.stdout;
  };
  if (tools.every((tool) => (localMajor(tool) ?? 0) >= major)) {
    const env = { ...process.env, PGPASSWORD: t.password };
    const conn = ['-h', t.host, '-p', t.port, '-U', t.user, '-d', t.database];
    return { kind: 'local', run: (tool, args, io, connect = true) => exec(tool, [...(connect ? conn : []), ...args], env, io) };
  }
  // The database container (docker-compose.yml, service "db"): its own tools, over its socket.
  const compose = ['compose', ...(fs.existsSync(path.join(ROOT, '.env.local')) ? ['--env-file', '.env.local'] : []), 'exec', '-T', 'db'];
  const probe = spawnSync('docker', [...compose, 'pg_dump', '--version'], { cwd: ROOT, encoding: 'utf8' });
  if (probe.status !== 0)
    throw new Error(`No usable PostgreSQL tools: install pg_dump/pg_restore/psql version ${major} or newer, or run the database with Docker (npm run db:up).`);
  return { kind: 'docker', run: (tool, args, io, connect = true) => exec('docker', [...compose, tool, ...(connect ? ['-U', t.user, '-d', t.database] : []), ...args], process.env, io) };
}

export function backupDir(): string {
  const dir = path.join(ROOT, 'backups');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/** Writes a full backup (pg_dump custom format) and returns its path. */
export async function backupDatabase(ownerUrl: string, options: { file?: string; label?: string } = {}): Promise<string> {
  const t = targetOf(ownerUrl);
  const runner = await runnerFor(ownerUrl);
  const file = options.file ?? path.join(backupDir(), `${t.database}-${options.label ? `${options.label}-` : ''}${stamp()}.dump`);
  runner.run('pg_dump', ['--format=custom', '--no-owner'], { outFile: file });
  if (fs.statSync(file).size === 0) throw new Error('The backup came out empty.');
  return file;
}

/**
 * Replaces the database with a backup, in one transaction: the schemas are dropped and the
 * backup's contents re-created; any error rolls everything back. The restricted app role keeps
 * its grants (they are part of the backup).
 */
export async function restoreDatabase(ownerUrl: string, file: string): Promise<void> {
  targetOf(ownerUrl);
  if (!fs.existsSync(file)) throw new Error(`No such backup: ${file}`);
  const runner = await runnerFor(ownerUrl);
  // The backup as SQL (pg_restore reads it from stdin, so the container needs no file).
  const script = runner.run('pg_restore', ['--no-owner', '--file=-'], { input: fs.readFileSync(file) }, false).toString('utf8');
  // pg_dump sets search_path to empty for the session; our schema reset goes first.
  const sql = [
    'drop schema if exists drizzle cascade;',
    'drop schema if exists public cascade;',
    'create schema public;',
    // The backup carries its own "create schema public" only when public was not the default one.
    script.replace(/^CREATE SCHEMA public;$/m, '-- (public schema re-created above)'),
  ].join('\n');
  runner.run('psql', ['--single-transaction', '--set=ON_ERROR_STOP=1', '--quiet', '--no-psqlrc', '--file=-'], { input: sql });
}

/** True when the database holds imported Movegistics records (real data that a reset would wipe). */
export async function holdsImportedData(ownerUrl: string): Promise<boolean> {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    const [table] = await sql`select to_regclass('public.hhmc_import_refs') as t`;
    if (!table?.t) return false;
    const [row] = await sql`select exists(select 1 from hhmc_import_refs where source = 'movegistics' and source_id not like 'DEMO-%') as real`;
    return Boolean(row.real);
  } finally {
    await sql.end();
  }
}

/**
 * A full backup of the HOSTED pilot database (Neon), before the pilot import writes to it. Reads
 * only. Uses this machine's pg_dump when it is at least the server's version, else the local database
 * container's (`npm run db:up`); failing both, install one (Mac: `brew install postgresql@17`).
 * The password goes through the
 * environment, never the command line. Written to backups/pilot-<date>.dump (git-ignored).
 */
export async function backupPilotDatabase(ownerUrl: string): Promise<string> {
  const url = new URL(ownerUrl);
  if (LOCAL.includes(url.hostname.toLowerCase())) throw new Error('Refusing: that is a local database; use npm run db:backup.');
  const major = await serverMajor(ownerUrl);
  const file = path.join(backupDir(), `pilot-${stamp()}.dump`);
  const env = {
    ...process.env,
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get('sslmode') ?? 'require',
  };
  const conn = ['-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-d', url.pathname.replace(/^\//, ''), '--format=custom', '--no-owner'];
  let r: ReturnType<typeof spawnSync>;
  if ((localMajor('pg_dump') ?? 0) >= major) {
    r = spawnSync('pg_dump', [...conn, `--file=${file}`], { env, cwd: ROOT, maxBuffer: 2 ** 31 - 1 });
  } else {
    // No new-enough pg_dump on this machine: the local database container's (docker-compose.yml,
    // service "db") reaches Neon over the network. The password and SSL mode go in by NAME (-e),
    // so they are read from this process's environment and never appear on a command line.
    const compose = ['compose', ...(fs.existsSync(path.join(ROOT, '.env.local')) ? ['--env-file', '.env.local'] : []), 'exec', '-T', '-e', 'PGPASSWORD', '-e', 'PGSSLMODE', 'db'];
    const probe = spawnSync('docker', [...compose, 'pg_dump', '--version'], { cwd: ROOT, env, encoding: 'utf8' });
    const inContainer = probe.status === 0 ? Number(/(\d+)/.exec(probe.stdout)?.[1] ?? 0) : 0;
    if (inContainer < major)
      throw new Error(
        `Refusing: no pg_dump ${major} or newer on this machine or in the database container. Install it (Mac: brew install postgresql@${major}), or make a Neon restore branch by hand and re-run with --no-backup.`,
      );
    r = spawnSync('docker', [...compose, 'pg_dump', ...conn], { env, cwd: ROOT, maxBuffer: 2 ** 31 - 1 });
    if (r.status === 0) fs.writeFileSync(file, r.stdout as Buffer, { mode: 0o600 });
  }
  if (r.status !== 0) throw new Error(`pg_dump of the pilot failed: ${String(r.stderr ?? '').trim().split('\n').slice(-2).join(' ')}`);
  fs.chmodSync(file, 0o600);
  if (fs.statSync(file).size === 0) throw new Error('The pilot backup came out empty.');
  return file;
}
