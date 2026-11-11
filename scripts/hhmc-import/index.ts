/**
 * Import Hired Hands' history from Movegistics into the LOCAL database's HHMC live data, then
 * reconcile it against Movegistics' own numbers (Phase 5C).
 *
 *   npm run hhmc:import -- --dir ~/Documents/SAI/hhmc-data/raw [--dry-run] [--clear-live-demo]
 *
 *   --dry-run          read and link the files and report what would be imported; writes nothing
 *   --clear-live-demo  first remove the fake demo data from HHMC live (only allowed while live
 *                      holds no imported records) and keep only the settings data
 *
 * Writes ~/Documents/SAI/hhmc-data/RECONCILIATION.md (outside the repository). Refuses to run
 * against any database that is not on this machine, and never touches the sandbox: test mode
 * keeps fake data only. Prints counts only, never names or contact details.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv, requireEnv } from '../lib/env';

const EXPLANATIONS: Record<string, string> = {
  'contacts merged as duplicates (same email or phone)': 'Movegistics held the same person more than once; HHMC keeps one customer per email (then phone).',
  'contacts created from work requests (not in the contacts export)': 'The work request names a person who is not in the contacts export; a customer was made from the work request.',
  'contacts created from invoices (not in the contacts export)': 'As above, from the invoice.',
  'closed-won work requests with no work order found': 'Booked in Movegistics without a work order: imported as booked on the move date.',
  'estimates with no matching work request (not imported)': 'Their work request title and contact match no work request in the export. Not counted in any total above (estimates are not part of the reconciliation totals). NEEDS JAI REVIEW.',
  'older open estimates voided (Movegistics allowed several per work request)': 'HHMC allows one estimate in force per work request; the later one is kept, earlier ones are void with a note saying so.',
  'invoices with no matching work request (a placeholder work request was made)': 'Kept so invoiced and collected totals reconcile; each is marked in its scope of work. Not counted as work requests.',
  'payment requests never paid (not imported: no money moved)': "Movegistics' \"REQUESTED\" rows: a payment link was sent but never paid.",
  'payments not linked to any work request': 'Recorded against the customer; they count in "collected" but not in a work request.',
  'payments whose contact name matches no single contact (imported without a customer)': 'Contact name is shared by several people or by none; recorded without a customer.',
  'partially refunded payments (refund amount not in the export: recorded as not refunded)': 'The export does not say how much was refunded. NEEDS JAI REVIEW: read the refunds from Movegistics and enter them.',
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  loadEnv();
  const url = new URL(requireEnv('DATABASE_URL'));
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error('Refusing: the HHMC import only runs against a database on this machine.');
  const dir = (arg('--dir') ?? path.join(os.homedir(), 'Documents/SAI/hhmc-data/raw')).replace(/^~/, os.homedir());
  const dryRun = process.argv.includes('--dry-run');
  const clear = process.argv.includes('--clear-live-demo');

  const { FILE_NAMES, normalize } = await import('./movegistics');
  const files = Object.fromEntries(Object.entries(FILE_NAMES).map(([k, f]) => [k, fs.readFileSync(path.join(dir, f), 'utf8')])) as import('./movegistics').Files;
  const n = normalize(files);
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
    if (clear) console.log(`Cleared demo data: ${await scoped((s) => clearLiveDemo(s))} rows; settings data re-created.`);
    const t0 = Date.now();
    const { stats } = await loadIntoHhmc(scoped, n);
    for (const [type, st] of Object.entries(stats)) console.log(`  ${type}: ${st.created} created, ${st.updated} updated, ${st.unchanged} unchanged`);
    console.log(`Loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
    const r = reconciliationReport(movegisticsSide(files), await scoped((s) => ourSide(s, ctx.business.timeZone)), n.issues, EXPLANATIONS);
    report = r.markdown;
    differences = r.differences;
  } finally {
    await closeDb();
  }
  const out = path.join(path.dirname(dir), 'RECONCILIATION.md');
  fs.writeFileSync(out, report, { mode: 0o600 });
  console.log(`Reconciliation: ${differences === 0 ? 'everything matches' : `${differences} difference(s)`} → ${out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message.split('\n')[0] : error);
  const cause = (error as { cause?: { message?: string; code?: string } })?.cause;
  if (cause) console.error('Cause:', cause.code ?? '', cause.message ?? cause);
  process.exit(1);
});
