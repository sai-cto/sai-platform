/**
 * Import Hired Hands' history from Movegistics into the LOCAL database's HHMC live data, then
 * reconcile it against Movegistics' own numbers (Phase 5C).
 *
 *   npm run hhmc:import -- --dir ~/Documents/SAI/hhmc-data/raw [--dry-run] [--clear-live-demo]
 *
 *   --dry-run          read and link the files and report what would be imported; writes nothing
 *   --clear-live-demo  first remove the fake demo data from HHMC live (only allowed while live
 *                      holds no imported records) and keep only the settings data
 *   --real             the CTO's everyday path (npm run hhmc:import:real): reads the exports from
 *                      data/movegistics/ in this repository (git-ignored), loads them into the
 *                      LOCAL dev database's HHMC live mode, clears the fake demo data on the very
 *                      first run, and writes the reconciliation to data/movegistics-reports/
 *                      (git-ignored). Re-running after a fresh export updates, never duplicates.
 *   data/movegistics/refund-amounts.csv (optional, any mode): "Payment ID","Refunded Amount" for
 *                      partial refunds the Payments export gives no amount for.
 *   --target pilot --confirm-host <host>
 *                      load into the hosted PILOT site's database instead (DECISIONS P5E-1):
 *                      reads ONLY .env.pilot (DATABASE_OWNER_URL, optional DATABASE_URL), refuses
 *                      unless that database is marked as the pilot by its deploy, is up to date
 *                      with this code's migrations and <host> matches it exactly. The app role
 *                      (row-level security on) does the writing; the owner URL is only read to
 *                      check the mark. Writes RECONCILIATION-PILOT.md next to the exports.
 *
 * Writes ~/Documents/SAI/hhmc-data/RECONCILIATION.md (outside the repository). Refuses to run
 * against any database that is not on this machine, and never touches the sandbox: test mode
 * keeps fake data only. Prints counts only, never names or contact details.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv, requireEnv } from '../lib/env';
import { connectPilotDatabase, LOCAL_HOSTS } from '../lib/pilot-target';

const EXPLANATIONS: Record<string, string> = {
  'contacts merged as duplicates (same email or phone)': 'Movegistics held the same person more than once; HHMC keeps one customer per email (then phone).',
  'contacts created from work requests (not in the contacts export)': 'The work request names a person who is not in the contacts export; a customer was made from the work request.',
  'contacts created from invoices (not in the contacts export)': 'As above, from the invoice.',
  'closed-won work requests with no work order found': 'Booked in Movegistics without a work order: imported as booked on the move date.',
  "estimates linked to their contact's work request (the work request title did not match)": 'Movegistics links an estimate to its work request by title only; when the title changed, the contact\'s own work request (latest made on or before the estimate) is used.',
  'estimates with no work request for their contact (a placeholder work request was made)': 'Kept on a placeholder work request (open while the estimate is in force, otherwise lost); not counted as work requests. Listed by id below.',
  'leads with a status the importer does not know (kept as New; the original is on the lead)': 'The original status is shown on the lead under "From Movegistics".',
  'partially refunded payments with the amount from refund-amounts.csv': 'Hand-entered from Movegistics\' payment pages; both sides of the reconciliation use the same amount.',
  "PAID invoices covered by their work request's deposit (credited to the invoice)": 'Movegistics leaves deposits "Unapplied" yet marks the invoice PAID; the deposit is shown on the invoice as deposit received.',
  'PAID invoices still not covered by any payment in the export (listed by id below)': 'Movegistics says PAID but its payments export holds no money for them: look each up in Movegistics.',
  'older open estimates voided (Movegistics allowed several per work request)': 'HHMC allows one estimate in force per work request; the later one is kept, earlier ones are void with a note saying so.',
  'invoices with no matching work request (a placeholder work request was made)': 'Kept so invoiced and collected totals reconcile; each is marked in its scope of work. Not counted as work requests.',
  'payment requests never paid (not imported: no money moved)': "Movegistics' REQUESTED rows (a pay link sent, never paid) and any FAILED, DECLINED, VOIDED or CANCELLED rows.",
  'payments not linked to any work request': 'Recorded against the customer; they count in "collected" but not in a work request.',
  'payments whose contact name matches no single contact (imported without a customer)': 'Contact name is shared by several people or by none; recorded without a customer.',
  'partially refunded payments (refund amount not in the export: recorded as not refunded)': 'The export does not say how much was refunded: those months are marked "unverified" below. Add each (ids listed below) to data/movegistics/refund-amounts.csv and re-run.',
  'PAID invoices whose exported "Balance Due" was not zero (treated as fully paid)': 'Movegistics leaves "Balance Due" at the full amount on these PAID invoices; see "Open balance" above, including how many are not covered by payments.',
  'records linked by work request title alone (contact name differs)': 'The title matched exactly one work request but the contact name on the estimate / invoice / work order differs (e.g. renamed contact). Linked; worth a spot check.',
  'duplicate estimate ids in the export (second copy skipped)': 'The same id twice in one export.',
  'payments naming an invoice that is not in the invoices export': 'Linked to the customer (and a deposit to their work request) instead; counted in "collected".',
  'duplicate invoice ids in the export (second copy skipped)': 'The same id twice in one export.',
  'duplicate payment ids in the export (second copy skipped)': 'The same id twice in one export.',
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const REPO = path.resolve(__dirname, '..', '..');
/** Movegistics names its downloads by list and date: accept our fixed names, or exactly one CSV per list. */
const LABELS: Record<string, string> = { contacts: 'contact', leads: 'lead', workRequests: 'work request', estimates: 'estimate', workOrders: 'work order', invoices: 'invoice', payments: 'payment' };
const PATTERNS: Record<string, RegExp> = {
  contacts: /contact/i, leads: /lead/i, workRequests: /work[\s_-]*request/i, estimates: /estimate/i,
  workOrders: /work[\s_-]*order/i, invoices: /invoice/i, payments: /payment/i,
};
function findExport(dir: string, key: string, fixed: string): string {
  if (fs.existsSync(path.join(dir, fixed))) return path.join(dir, fixed);
  const all = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.csv$/i.test(f) && f !== 'refund-amounts.csv') : [];
  const hits = all.filter((f) => PATTERNS[key].test(f));
  if (hits.length === 1) return path.join(dir, hits[0]);
  throw new Error(
    hits.length
      ? `Refusing: more than one ${key} export in ${dir} (${hits.join(', ')}). Keep one, or name it ${fixed}.`
      : `Refusing: the ${key} export is missing from ${dir}. Expected ${fixed} (or exactly one CSV whose name says "${LABELS[key]}"). All seven are needed: ${Object.values(FILE_NAMES_LIST).join(', ')}.`,
  );
}
let FILE_NAMES_LIST: Record<string, string> = {};

async function main() {
  loadEnv();
  const real = process.argv.includes('--real');
  if (real && arg('--target')) throw new Error('Refusing: --real loads the local database only.');
  if (real && arg('--dir')) throw new Error('Refusing: --real always reads data/movegistics/ (use --dir without --real for another folder).');
  const pilot = arg('--target') === 'pilot';
  if (arg('--target') && !pilot) throw new Error('Refusing: the only --target is "pilot".');
  let pilotHost: string | null = null;
  if (pilot) {
    if (process.argv.includes('--clear-live-demo')) throw new Error('Refusing: --clear-live-demo is for the local database only (the pilot\'s live data starts empty).');
    pilotHost = (await connectPilotDatabase(arg('--confirm-host'))).label;
    process.env.HHMC_IMPORT_BATCH ??= '50';
    console.log(`Target: the PILOT site's database (${pilotHost}).`);
  } else {
    const url = new URL(requireEnv('DATABASE_URL'));
    if (!LOCAL_HOSTS.includes(url.hostname)) throw new Error('Refusing: the HHMC import only runs against a database on this machine (or --target pilot).');
    if (url.searchParams.has('host') || url.searchParams.has('hostaddr')) throw new Error('Refusing: a host given in the database URL query is not allowed.');
    const dbName = url.pathname.replace(/^\//, '');
    if (dbName === 'sai_test' || dbName.endsWith('_copy')) throw new Error('Refusing: not the test database or a throw-away copy.');
  }
  const dir = real ? path.join(REPO, 'data', 'movegistics') : (arg('--dir') ?? path.join(os.homedir(), 'Documents/SAI/hhmc-data/raw')).replace(/^~/, os.homedir());
  const dryRun = process.argv.includes('--dry-run');
  let clear = process.argv.includes('--clear-live-demo');

  const { FILE_NAMES, normalize, parseRefundOverrides } = await import('./movegistics');
  FILE_NAMES_LIST = FILE_NAMES;
  const paths = Object.fromEntries(Object.entries(FILE_NAMES).map(([k, f]) => [k, findExport(dir, k, f)]));
  const files = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, fs.readFileSync(p, 'utf8')])) as import('./movegistics').Files;
  const refundFile = path.join(dir, 'refund-amounts.csv');
  const refunds = fs.existsSync(refundFile) ? parseRefundOverrides(fs.readFileSync(refundFile, 'utf8')) : new Map<string, number>();
  if (refunds.size) console.log(`Read ${refunds.size} hand-entered refund amount(s) from refund-amounts.csv.`);
  const n = normalize(files, { refunds });
  console.log(`Read: ${n.contacts.length} contacts, ${n.leads.length} leads, ${n.jobs.length} work requests, ${n.estimates.length} estimates, ${n.invoices.length} invoices, ${n.payments.length} payments.`);

  const { systemContext } = await import('../../src/core/tenancy/system');
  const { withScope } = await import('../../src/core/db/scope');
  const { closeDb } = await import('../../src/core/db/client');
  const { loadIntoHhmc } = await import('./load');
  const { clearLiveDemo } = await import('./clear-demo');
  const { movegisticsSide, ourSide, reconciliationReport } = await import('./reconcile');

  const base = await systemContext('hhmc', 'live');
  const ctx = { ...base, actor: { ...base.actor, name: 'Movegistics import' } };
  const scoped = <T>(fn: (s: import('../../src/core/db/scope').Scope) => Promise<T>) => withScope(ctx, 'hhmc.import.run', fn);
  let report = '';
  let differences = 0;
  try {
    if (dryRun) {
      // No database writes at all: what would be imported, and Movegistics' own totals.
      console.log('Dry run: nothing written. Linking issues:');
      for (const [k, v] of Object.entries(n.issues)) console.log(`  ${v} ${k}`);
      return;
    }
    if (pilot) {
      const { customers } = await import('../../src/core/db/schema');
      const { hhmcImportRefs } = await import('../../src/modules/hhmc/schema');
      const before = await scoped(async (s) => ({ customers: await s.db.$count(customers, s.where(customers)), imported: await s.db.$count(hhmcImportRefs, s.where(hhmcImportRefs)) }));
      console.log(`Pilot HHMC live before: ${before.customers} customers, ${before.imported} imported records.`);
    }
    if (real && !clear) {
      // First real import into this database: the fake demo moves go, the settings data stays.
      const { hhmcImportRefs } = await import('../../src/modules/hhmc/schema');
      const { and, eq, notLike } = await import('drizzle-orm');
      const imported = await scoped((s) => s.db.$count(hhmcImportRefs, and(s.where(hhmcImportRefs, 'include'), eq(hhmcImportRefs.source, 'movegistics'), notLike(hhmcImportRefs.sourceId, 'DEMO-%'))));
      clear = imported === 0;
    }
    if (clear) console.log(`Cleared demo data: ${await scoped((s) => clearLiveDemo(s))} rows; settings data re-created.`);
    const t0 = Date.now();
    const { stats } = await loadIntoHhmc(scoped, n);
    for (const [type, st] of Object.entries(stats))
      console.log(`  ${type}: ${st.created} created, ${st.updated} updated, ${st.unchanged} unchanged, ${st.kept} kept (changed in SAI), ${st.linked} linked to an existing record`);
    console.log(`Loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
    const r = reconciliationReport(movegisticsSide(files, refunds), await scoped((s) => ourSide(s, ctx.business.timeZone)), n.issues, EXPLANATIONS, n.followups);
    report = r.markdown;
    differences = r.differences;
    console.log(`\n${r.summary}\n`);
  } finally {
    await closeDb();
  }
  // Next to the raw exports' folder (the parent of --dir), never inside the repository, except in
  // --real mode: data/movegistics-reports/, git-ignored like the exports themselves.
  let out: string;
  if (real) {
    const reports = path.join(REPO, 'data', 'movegistics-reports');
    fs.mkdirSync(reports, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    out = path.join(reports, `RECONCILIATION-${stamp}.md`);
    fs.writeFileSync(path.join(reports, 'RECONCILIATION-latest.md'), report, { mode: 0o600 });
  } else {
    out = path.join(fs.realpathSync(path.dirname(dir)), pilot ? 'RECONCILIATION-PILOT.md' : 'RECONCILIATION.md');
    if (out.startsWith(fs.realpathSync(REPO) + path.sep)) throw new Error('Refusing to write the reconciliation inside the repository.');
  }
  fs.writeFileSync(out, report, { mode: 0o600 });
  console.log(`Reconciliation: ${differences === 0 ? 'everything matches' : `${differences} difference(s)`} → ${out}`);
}

main().catch((error) => {
  // Only our own messages are printed in full; anything else could quote a real value.
  const message = error instanceof Error ? error.message : '';
  const ours = message.startsWith('Refusing') || (error instanceof Error && error.name === 'UnknownValues') || message.startsWith('Movegistics values');
  const code = (error as { cause?: { code?: string } })?.cause?.code;
  // 42703 / 42P01: a column or table this code needs is missing: the database is behind the code.
  const behind = code === '42703' || code === '42P01' ? ' The local database is older than this code: run "npm run db:migrate", then import again.' : '';
  console.error(ours ? message : `Import failed: ${error instanceof Error ? error.name : 'error'}${code ? ` (database code ${code})` : ''}.${behind} Nothing printed from the data; re-run to retry.`);
  process.exit(1);
});
