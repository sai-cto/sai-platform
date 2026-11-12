/**
 * Copy Hired Hands' (HHMC) LIVE data and settings from this laptop's database to the hosted
 * PILOT site's database, replacing what is there, then check every table matches.
 *
 *   npm run hhmc:sync-to-pilot -- --confirm-host <host> [--check] [--first-copy]
 *
 *   --confirm-host <host>  the pilot database host exactly as shown in Neon (Connect); typed by you
 *   --check                only compare the laptop and the website (read-only, writes nothing)
 *   --first-copy           allow the first copy onto a website that already holds HHMC live data,
 *                          as long as nobody signed in to the website has made a change there
 *
 * It refuses if anyone has changed the website's HHMC data or settings since the last copy:
 * once managers use the website, the website is the master copy and this command stops.
 *
 * Source: DATABASE_URL in .env.local only, and only a database on this machine. Target: the
 * pilot guard (scripts/lib/pilot-target.ts: .env.pilot only, the pilot mark, this code's
 * migrations, the typed host, an encrypted connection, the app role sai_app). Both sides are
 * read and written as sai_app with row-level security in force. Only HHMC's live data: test
 * mode and other businesses are never touched. Files, users, memberships and sign-in records
 * are not copied. Prints counts only, never names, emails or contact details.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import postgres from 'postgres';
import { isLocalDatabaseUrl } from '../../src/core/demo/pilot';
import { ROOT } from '../lib/env';
import { connectPilotDatabase } from '../lib/pilot-target';
import { compareDatabases, formatComparison, NOT_COPIED, SyncRefused, syncDatabases, type Comparison } from './engine';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** The laptop's app connection, from .env.local only (never from the shell's environment). */
function localSourceUrl(): string {
  const file = path.join(ROOT, '.env.local');
  if (!fs.existsSync(file)) throw new SyncRefused('.env.local not found. Run "npm run setup" first.');
  const url = dotenv.parse(fs.readFileSync(file)).DATABASE_URL;
  if (!url || !isLocalDatabaseUrl(url)) throw new SyncRefused('DATABASE_URL in .env.local must be a database on this machine.');
  const u = new URL(url);
  if (u.searchParams.has('host') || u.searchParams.has('hostaddr')) throw new SyncRefused('a host given in the database URL query is not allowed.');
  if (/^\/sai_test/.test(u.pathname)) throw new SyncRefused('the source must be the laptop database, not the test database.');
  return url;
}

function printComparison(c: Comparison) {
  console.log(formatComparison(c));
  if (c.lastCopyAt === null) console.log('No copy has been recorded on the website yet.');
  else if (c.changedSinceLastCopy?.length)
    console.log(`The website changed since the last copy (${c.lastCopyAt}) in: ${c.changedSinceLastCopy.join(', ')}. It is now the master copy.`);
  else console.log(`The website is unchanged since the last copy (${c.lastCopyAt}).`);
  console.log(c.allMatch ? 'Result: the website MATCHES the laptop.' : 'Result: the website does NOT match the laptop.');
}

/** Set once the copy has been committed, so a later failure is not reported as a rollback. */
let committed = false;

async function main() {
  const check = process.argv.includes('--check');
  const firstCopy = process.argv.includes('--first-copy');
  if (check && firstCopy) throw new SyncRefused('--check and --first-copy cannot be used together.');
  const sourceUrl = localSourceUrl();
  const pilot = await connectPilotDatabase(arg('--confirm-host'));
  console.log(`Laptop: ${new URL(sourceUrl).pathname.slice(1)} on this machine. Website: the PILOT database (${pilot.label}).`);
  const source = postgres(sourceUrl, { max: 1, onnotice: () => {} });
  const target = postgres(pilot.appUrl, { max: 1, onnotice: () => {} });
  try {
    const [tls] = await target`select ssl from pg_stat_ssl where pid = pg_backend_pid()`;
    if (!tls?.ssl) throw new SyncRefused('the connection to the pilot database is not encrypted.');
    if (check) {
      const c = await compareDatabases(source, target);
      printComparison(c);
      if (!c.allMatch) process.exitCode = 1;
      return;
    }
    // The laptop's database must never be a copy of the pilot (e.g. a tunnel to it on localhost).
    const [mark] = await source`select obj_description(oid, 'pg_database') as comment from pg_database where datname = current_database()`;
    if (String(mark?.comment ?? '').includes('sai-pilot-database')) throw new SyncRefused('the laptop database carries the pilot mark: it is (a copy of) the website itself.');
    const r = await syncDatabases(source, target, { firstCopy });
    committed = true;
    console.log(r.firstCopy ? 'First copy: the website had HHMC data nobody had changed by hand; it was replaced.' : 'Copied.');
    console.log(`Rows written: ${Object.values(r.copied).reduce((a, b) => a + b, 0)} (activity log entries already there and kept: ${r.logAlreadyThere}).`);
    console.log(`User references: ${r.userRefs.mapped} matched to a website user by email, ${r.userRefs.unmapped} with no such user (left empty).`);
    for (const [t, why] of Object.entries(NOT_COPIED)) console.log(`Not copied: ${t} (${why}); ${r.comparison.files.local} on the laptop, ${r.fileRefsCleared} links to them left empty.`);
    console.log('Not copied: users, memberships, sessions, sign-in records (people sign in to the website with Microsoft).');
    // A fresh, read-only comparison after the commit.
    printComparison(await compareDatabases(source, target));
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((error) => {
  // Only our own messages are printed in full; a database error could quote a real value.
  const message = error instanceof Error ? error.message : '';
  const ours = message.startsWith('Refusing') || message.startsWith('Copy check failed');
  const code = (error as { code?: string })?.code;
  const after = committed
    ? 'The copy WAS committed; only the final comparison failed. Run again with --check.'
    : 'Rolled back: the website is unchanged.';
  console.error(ours ? message : `Copy failed: ${error instanceof Error ? error.name : 'error'}${code ? ` (database code ${code})` : ''}. ${after}`);
  process.exit(1);
});
