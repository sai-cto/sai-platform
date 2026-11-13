/**
 * Checks every HHMC dashboard number against straight SQL ("All time"; open and past due as of
 * today), in HHMC live. Reads only. Prints totals, never names.
 *
 *   npm run hhmc:numbers                                            the laptop's database
 *   npm run hhmc:numbers -- --target pilot --confirm-host <host>    the pilot's (reads .env.pilot)
 *
 * Exit code 1 when any number differs.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import postgres from 'postgres';
import { loadEnv, requireEnv, ROOT } from './lib/env';
import { connectPilotDatabase, LOCAL_HOSTS } from './lib/pilot-target';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  loadEnv();
  const pilot = arg('--target') === 'pilot';
  let ownerUrl: string;
  if (pilot) {
    await connectPilotDatabase(arg('--confirm-host'));
    ownerUrl = dotenv.parse(fs.readFileSync(path.join(ROOT, '.env.pilot'))).DATABASE_OWNER_URL;
  } else {
    ownerUrl = requireEnv('DATABASE_OWNER_URL');
    if (!LOCAL_HOSTS.includes(new URL(ownerUrl).hostname)) throw new Error('Refusing: without --target pilot this reads the local database only.');
  }
  const { systemContext } = await import('../src/core/tenancy/system');
  const { withScope } = await import('../src/core/db/scope');
  const { closeDb } = await import('../src/core/db/client');
  const { localDate } = await import('../src/modules/hhmc/rules');
  const { sqlNumbers, dashboardNumbers, compareNumbers } = await import('./lib/hhmc-numbers');
  const ctx = await systemContext('hhmc', 'live');
  const now = new Date();
  const today = localDate(now, ctx.business.timeZone);
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    const direct = await sqlNumbers(sql, ctx.business.id, 'live', today);
    const shown = await withScope(ctx, 'hhmc.jobs.read', (s) => dashboardNumbers(s, now));
    const rows = compareNumbers(shown, direct);
    const money = (n: string) => n.endsWith('Cents');
    const fmt = (name: string, v: number | null) =>
      v === null ? '—' : money(name) ? `$${(v / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : v.toLocaleString('en-US');
    const bad = rows.filter((r) => r.dashboard !== r.sql);
    console.log(`HHMC live (${pilot ? 'pilot' : 'laptop'}), all time; open and past due as of ${today}`);
    for (const r of rows) console.log(`${r.dashboard === r.sql ? 'OK  ' : 'DIFF'} ${r.name.padEnd(16)} dashboard ${fmt(r.name, r.dashboard).padStart(16)}   SQL ${fmt(r.name, r.sql).padStart(16)}`);
    console.log(bad.length ? `\n${bad.length} number(s) differ.` : '\nEvery dashboard number equals the SQL.');
    process.exitCode = bad.length ? 1 : 0;
  } finally {
    await sql.end();
    await closeDb();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
