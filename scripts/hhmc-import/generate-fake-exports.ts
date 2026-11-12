/**
 * Writes FAKE Movegistics-shaped exports at full scale, for performance checks of the import and
 * of every HHMC screen without real customer data:
 *
 *   npx tsx scripts/hhmc-import/generate-fake-exports.ts --out <dir> [--scale 2]
 *
 * Same seven files, same columns (taken from tests/fixtures/movegistics), linked the way
 * Movegistics links them (work request title + contact name). Scale 1 ≈ HHMC's real counts in
 * Nov 2026 (2,945 contacts, 613 leads, 1,396 work requests, 1,894 estimates, 883 work orders,
 * 781 invoices, 1,454 payments), spread over five years with the June–August peak. Everyone is
 * made up, at example.com, with 555-01xx phone numbers. Deterministic (fixed seed).
 */
import fs from 'node:fs';
import path from 'node:path';

const FIXTURES = path.resolve(__dirname, '../../tests/fixtures/movegistics');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// Small deterministic PRNG (mulberry32).
let seed = 20261112;
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
const chance = (p: number) => rand() < p;

const FIRST = ['Avery', 'Blake', 'Casey', 'Dana', 'Emery', 'Finley', 'Gray', 'Harper', 'Indy', 'Jules', 'Kai', 'Logan', 'Morgan', 'Noel', 'Oakley', 'Parker', 'Quinn', 'Reese', 'Sage', 'Taylor'];
const LAST = ['Fixture', 'Sample', 'Testerson', 'Mockingbird', 'Example', 'Placeholder', 'Dummy', 'Fakename', 'Specimen', 'Prototype'];
const SOURCES = ['Google search', 'Cornell university', 'Friend referral', 'Used you before', 'Website', 'Instagram', 'Yelp', '', 'Realtor'];
const SERVICE = ['Local', 'Local', 'Local', 'Local', 'Intrastate', 'Interstate', 'Commercial'];

/** A date in the last five years, weighted to the June–August peak. */
function moveDay(): Date {
  const year = 2022 + Math.floor(rand() * 5);
  const month = chance(0.55) ? 5 + Math.floor(rand() * 3) : Math.floor(rand() * 12);
  const d = new Date(Date.UTC(year, month, 1 + Math.floor(rand() * 28), 12));
  return d > new Date('2027-08-31') ? new Date('2026-08-15T12:00:00Z') : d;
}
const us = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
const plus = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
const amount = () => (150 + Math.floor(rand() * 2400) + Math.floor(rand() * 100) / 100).toFixed(2);

function columns(file: string): string[] {
  const header = fs.readFileSync(path.join(FIXTURES, `movegistics-${file}.csv`), 'utf8').split('\n')[0];
  return header.split(',').map((c) => c.replace(/^"|"$/g, ''));
}
function writeCsv(dir: string, file: string, rows: Record<string, string>[]) {
  const cols = columns(file);
  const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [cols.map(quote).join(','), ...rows.map((r) => cols.map((c, i) => quote((cols.indexOf(c) === i ? r[c] : r[`${c}#2`]) ?? '')).join(','))];
  fs.writeFileSync(path.join(dir, `movegistics-${file}.csv`), lines.join('\n') + '\n');
}

function main() {
  const out = arg('--out');
  if (!out) throw new Error('Give --out <dir>.');
  const scale = Number(arg('--scale') ?? '1');
  fs.mkdirSync(out, { recursive: true });
  const n = (base: number) => Math.round(base * scale);

  const contacts: Record<string, string>[] = [];
  const people: { name: string; email: string; phone: string }[] = [];
  for (let i = 0; i < n(2945); i++) {
    const first = pick(FIRST);
    const last = `${pick(LAST)}${i}`;
    const email = `${first}.${last}@example.com`.toLowerCase();
    const phone = `+1 607-555-01${String(i % 100).padStart(2, '0')}`;
    people.push({ name: `${first} ${last}`, email, phone });
    const created = plus(moveDay(), -30);
    contacts.push({
      'Contact ID': `CN${700000 + i}`, 'First Name': first, 'Last Name': last, 'Email Address': email, 'Contact Number - Mobile': chance(0.8) ? phone : '',
      'Contact Owner': 'Hired  Hands', 'Contact Source': pick(SOURCES), 'Contact Created Date': us(created), 'Contact Modified Date': us(created), City: 'Ithaca', State: 'NY',
    });
  }

  const leads: Record<string, string>[] = [];
  for (let i = 0; i < n(613); i++) {
    const created = plus(moveDay(), -20);
    leads.push({
      'Lead ID': `LD${700000 + i}`, 'First Name': pick(FIRST), 'Last Name': `Lead${i}`, 'Email Address': `lead${i}@example.com`, 'Referral Source': pick(SOURCES),
      'Move Date': String(plus(created, 20).getTime()), 'Move Type': chance(0.9) ? 'Residential' : 'Commercial', 'Lead Owner': 'General Manager',
      'Lead Status': chance(0.8) ? 'New' : 'Disqualified', 'Lead Disqualified Reason': 'Too far', 'Lead Created Date': us(created), 'Lead Modified Date': us(created),
    });
  }

  const workRequests: Record<string, string>[] = [];
  const workOrders: Record<string, string>[] = [];
  const estimates: Record<string, string>[] = [];
  const invoices: Record<string, string>[] = [];
  const payments: Record<string, string>[] = [];
  let estimateNo = 0;
  let paymentNo = 0;
  for (let i = 0; i < n(1396); i++) {
    // Repeat customers: about one in five work requests is for someone who moved before.
    const person = people[chance(0.2) ? Math.floor(rand() * Math.min(people.length, 200)) : Math.floor(rand() * people.length)];
    const move = moveDay();
    const created = plus(move, -25 - Math.floor(rand() * 30));
    const title = `${person.name} - Work Request${chance(0.1) ? ` ${i}` : ''}`;
    const service = pick(SERVICE);
    const total = amount();
    const stage = chance(0.55) ? 'Closed Won' : chance(0.5) ? 'Closed Lost' : chance(0.5) ? 'Estimate Provided' : 'Lead Qualified';
    workRequests.push({
      'Work Request Owner': 'Hired  Hands', 'Work Request ID': `WR${700000 + i}`, 'Work Request Title': title, 'Contact Name': person.name, 'Work Request Source': pick(SOURCES),
      Tentative: 'no', 'Move Date': us(move), 'Move Type': 'Residential', Pipeline: 'Sales', 'Pipeline Stage': stage, 'Closed Lost Reason': stage === 'Closed Lost' ? 'Price' : '',
      'Transportation Labor Amount': total, 'Work Request Amount': total, 'Service Type': service, 'Work Request Created Date': us(created),
      'Origin Address Line 1': `${i} Fake St`, 'Origin City': 'Ithaca', 'Origin State': 'NY', 'Destination Address Line 1': `${i} Sample Ave`, 'Destination City': 'Ithaca', 'Destination State': 'NY',
      'Phone Number': person.phone, 'Email Address': person.email, 'Number Of Bedrooms': pick(['Studio', '1', '2', '3']),
    });
    // One or two estimates (a revised one now and then).
    const versions = stage === 'Lead Qualified' ? 0 : chance(0.3) ? 2 : 1;
    for (let v = 0; v < versions; v++) {
      const last = v === versions - 1;
      estimates.push({
        'Estimate ID': `ES${700000 + estimateNo++}`, Estimate: `${service} Estimate for ${person.name}`, 'Estimate Amount': total,
        Status: last ? (stage === 'Closed Won' ? 'Signed' : pick(['Sent', 'Viewed'])) : 'Viewed', 'Estimate Owner': 'Hired', Contacts: person.name,
        'Created Date': us(plus(created, 2 + v)), 'Modified Date': us(plus(created, 2 + v)), 'Expiration Date': us(plus(created, 32 + v)), 'Work Request Title': title, 'Service Type': service,
      });
    }
    if (stage !== 'Closed Won') continue;
    const days = chance(0.1) ? 2 : 1;
    workOrders.push({
      'WO ID': `WO${700000 + i}`, 'Start Date': us(move), 'End Date': us(plus(move, days - 1)), 'WO Title': `${person.name} - Work Order`, Pipeline: 'Operations', 'Pipeline Stage': chance(0.03) ? 'Cancelled Out' : 'Booked',
      'Service Type': service, 'Created At': us(plus(created, 5)), 'Contact Name': person.name, 'Work Request': title, 'Owner Name': 'Hired  Hands', Crew: 'Two movers', 'Assigned vehicle': "16' truck",
    });
    // Deposit, then (for past moves) the invoice and its payment.
    const deposit = (Number(total) * 0.2).toFixed(2);
    payments.push({ 'Payment Date': us(plus(created, 4)), 'Payment ID': `PM${700000 + paymentNo++}`, 'Amount Recd': deposit, 'Payment Mode': 'Card', Deposit: 'Yes', 'Contact Name': person.name, 'Transaction Status': 'Successful', 'Last 4 Digits Of Card': '4242', 'Card Type': 'Visa', 'Created At': us(plus(created, 4)) });
    if (move > new Date('2026-11-01')) continue;
    const invoiceId = `IN${700000 + i}`;
    const paid = chance(0.85);
    const rest = (Number(total) - Number(deposit)).toFixed(2);
    invoices.push({
      'Invoice ID': invoiceId, 'Invoice Date': us(plus(move, 1)), 'Invoice Amount': total, 'Balance Due': paid ? (chance(0.3) ? total : '0') : rest, Status: paid ? 'PAID' : 'SENT',
      'Due Date': us(plus(move, 1)), 'Contact Name': person.name, 'Contact Email': person.email, 'Contact Phone': person.phone, 'Created Date': us(plus(move, 1)), 'Work Request Title': title, 'Invoice Owner': 'Hired  Hands',
    });
    if (paid) payments.push({ 'Payment Date': us(plus(move, 2)), 'Payment ID': `PM${700000 + paymentNo++}`, 'Amount Recd': rest, 'Payment Mode': pick(['Card', 'Check', 'Cash']), Deposit: 'No', 'Contact Name': person.name, 'Invoice No.': invoiceId, 'Transaction Status': 'Successful', 'Created At': us(plus(move, 2)) });
  }

  writeCsv(out, 'contacts', contacts);
  writeCsv(out, 'leads', leads);
  writeCsv(out, 'work-requests', workRequests);
  writeCsv(out, 'estimates', estimates);
  writeCsv(out, 'work-orders', workOrders);
  writeCsv(out, 'invoices', invoices);
  writeCsv(out, 'payments', payments);
  console.log(`Fake exports in ${out}: ${contacts.length} contacts, ${leads.length} leads, ${workRequests.length} work requests, ${estimates.length} estimates, ${workOrders.length} work orders, ${invoices.length} invoices, ${payments.length} payments.`);
}

main();
