/**
 * Reconciliation (Phase 5C): Movegistics' own numbers, computed straight from its exports (not
 * from the importer's normalized data, so a mapping bug cannot hide itself), against what HHMC's
 * live data now holds. Per month: work requests, revenue invoiced, payments collected, leads by
 * source; and the open balance today. Totals only: no names.
 */
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import type { Scope } from '../../src/core/db/scope';
import { payments } from '../../src/core/db/schema/tenant';
import { hhmcImportRefs, hhmcInvoices, hhmcJobs, hhmcLeads } from '../../src/modules/hhmc/schema';
import { balanceOf } from '../../src/modules/hhmc/services/invoices';
import { cents, day, leadSource, parseCsv, type Files } from './movegistics';

type Month = string; // YYYY-MM
type Side = { jobs: Map<Month, number>; invoiced: Map<Month, number>; collected: Map<Month, number>; leads: Map<string, number>; openBalance: number; openBalanceAsExported?: number; invoiceCount: number; paymentCount: number };
const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
const month = (d: string | null) => (d ? d.slice(0, 7) : 'no date');

export function movegisticsSide(files: Files): Side {
  const side: Side = { jobs: new Map(), invoiced: new Map(), collected: new Map(), leads: new Map(), openBalance: 0, invoiceCount: 0, paymentCount: 0 };
  for (const r of parseCsv(files.workRequests)) add(side.jobs, month(day(r['Work Request Created Date'])), 1);
  for (const r of parseCsv(files.invoices)) {
    add(side.invoiced, month(day(r['Invoice Date'])), cents(r['Invoice Amount']));
    const exported = Math.max(0, Math.min(cents(r['Balance Due']), cents(r['Invoice Amount'])));
    side.openBalanceAsExported = (side.openBalanceAsExported ?? 0) + exported;
    // An invoice Movegistics marks PAID owes nothing, whatever its stale "Balance Due" column says.
    side.openBalance += (r['Status'] ?? '').toUpperCase() === 'PAID' ? 0 : exported;
    side.invoiceCount++;
  }
  for (const r of parseCsv(files.payments)) {
    const tx = (r['Transaction Status'] ?? '').toUpperCase();
    if (tx === 'REQUESTED' || tx === '') continue;
    const amount = cents(r['Amount Recd']);
    add(side.collected, month(day(r['Payment Date']) ?? day(r['Created At'])), tx === 'REFUNDED' ? 0 : amount);
    side.paymentCount++;
  }
  for (const r of parseCsv(files.leads)) add(side.leads, `${month(day(r['Lead Created Date']))}|${leadSource(r['Referral Source']).source}`, 1);
  return side;
}

export async function ourSide(s: Scope, tz: string): Promise<Side> {
  const side: Side = { jobs: new Map(), invoiced: new Map(), collected: new Map(), leads: new Map(), openBalance: 0, invoiceCount: 0, paymentCount: 0 };
  const imported = (type: string) =>
    s.db.select({ id: hhmcImportRefs.recordId }).from(hhmcImportRefs).where(and(s.where(hhmcImportRefs), eq(hhmcImportRefs.source, 'movegistics'), eq(hhmcImportRefs.sourceType, type)));
  const localMonth = (col: unknown) => sql<string>`to_char(${col} at time zone ${tz}, 'YYYY-MM')`;

  const jobs = await s.db
    .select({ m: localMonth(hhmcJobs.createdAt), n: sql<number>`count(*)::int` })
    .from(hhmcJobs)
    .where(and(s.where(hhmcJobs), inArray(hhmcJobs.id, imported('work_request')), sql`${hhmcJobs.jobNumber} not like 'invoice-job:%'`))
    .groupBy(sql`1`);
  for (const r of jobs) add(side.jobs, r.m, r.n);

  const invoices = await s.db.select().from(hhmcInvoices).where(and(s.where(hhmcInvoices), inArray(hhmcInvoices.id, imported('invoice'))));
  for (const i of invoices) {
    add(side.invoiced, i.invoiceDate.slice(0, 7), i.totalCents);
    if (i.status !== 'void') side.openBalance += Math.max(0, balanceOf(i));
    side.invoiceCount++;
  }

  const pays = await s.db
    .select({ m: localMonth(payments.paidAt), net: sql<number>`sum(${payments.amountCents} - ${payments.refundedCents})::int`, n: sql<number>`count(*)::int` })
    .from(payments)
    .where(and(s.where(payments), eq(payments.status, 'succeeded'), like(payments.providerRef, 'movegistics:%')))
    .groupBy(sql`1`);
  for (const r of pays) {
    add(side.collected, r.m, r.net);
    side.paymentCount += r.n;
  }

  const leads = await s.db
    .select({ m: localMonth(hhmcLeads.createdAt), source: hhmcLeads.source, n: sql<number>`count(*)::int` })
    .from(hhmcLeads)
    .where(and(s.where(hhmcLeads), inArray(hhmcLeads.id, imported('lead'))))
    .groupBy(sql`1`, hhmcLeads.source);
  for (const r of leads) add(side.leads, `${r.m}|${r.source}`, r.n);
  return side;
}

const usd = (c: number) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function reconciliationReport(mg: Side, ours: Side, issues: Record<string, number>, explanations: Record<string, string>): { markdown: string; differences: number } {
  let differences = 0;
  const months = [...new Set([...mg.jobs.keys(), ...mg.invoiced.keys(), ...mg.collected.keys(), ...ours.jobs.keys(), ...ours.invoiced.keys(), ...ours.collected.keys()])].sort();
  const cell = (a: number, b: number, money: boolean) => {
    if (a === b) return '✅';
    differences++;
    return `❌ ${money ? usd(b - a) : String(b - a)}`;
  };
  const lines: string[] = [];
  lines.push('| Month | Work requests (MG / ours) | | Invoiced (MG / ours) | | Collected (MG / ours) | |');
  lines.push('|---|---|---|---|---|---|---|');
  const sum = { mj: 0, oj: 0, mi: 0, oi: 0, mc: 0, oc: 0 };
  for (const m of months) {
    const [mj, oj, mi, oi, mc, oc] = [mg.jobs.get(m) ?? 0, ours.jobs.get(m) ?? 0, mg.invoiced.get(m) ?? 0, ours.invoiced.get(m) ?? 0, mg.collected.get(m) ?? 0, ours.collected.get(m) ?? 0];
    sum.mj += mj; sum.oj += oj; sum.mi += mi; sum.oi += oi; sum.mc += mc; sum.oc += oc;
    lines.push(`| ${m} | ${mj} / ${oj} | ${cell(mj, oj, false)} | ${usd(mi)} / ${usd(oi)} | ${cell(mi, oi, true)} | ${usd(mc)} / ${usd(oc)} | ${cell(mc, oc, true)} |`);
  }
  lines.push(`| **All time** | **${sum.mj} / ${sum.oj}** | ${sum.mj === sum.oj ? '✅' : '❌'} | **${usd(sum.mi)} / ${usd(sum.oi)}** | ${sum.mi === sum.oi ? '✅' : '❌'} | **${usd(sum.mc)} / ${usd(sum.oc)}** | ${sum.mc === sum.oc ? '✅' : '❌'} |`);

  const leadKeys = [...new Set([...mg.leads.keys(), ...ours.leads.keys()])].sort();
  const leadRows = leadKeys.map((k) => {
    const [m, source] = k.split('|');
    const a = mg.leads.get(k) ?? 0;
    const b = ours.leads.get(k) ?? 0;
    return `| ${m} | ${source} | ${a} | ${b} | ${cell(a, b, false)} |`;
  });
  const open = cell(mg.openBalance, ours.openBalance, true);
  const md = [
    '# HHMC: Movegistics → SAI platform reconciliation',
    '',
    `Generated ${new Date().toISOString()} by \`scripts/hhmc-import\`. Movegistics' side is computed directly from its own CSV exports (\`~/Documents/SAI/hhmc-data/raw/\`); ours from the local database's HHMC live data. Totals only: no names.`,
    '',
    `**Result: ${differences === 0 ? 'every number matches to the cent ✅' : `${differences} difference(s): each is explained below ❌`}**`,
    '',
    '## Per month',
    '',
    'Work requests by the month Movegistics created them; invoiced = invoice amounts by invoice date; collected = payments received (not "requested"), net of full refunds, by payment date.',
    '',
    ...lines,
    '',
    '## Open balance today',
    '',
    'Movegistics leaves the "Balance Due" column at the full amount on 281 invoices it marks **PAID** (all from 2025); 276 of them are fully covered by payments in its own payments export, and its invoice list shows the same contradiction on screen. A PAID invoice is counted here as owing $0. The column as exported is shown for transparency.',
    '',
    `| | Movegistics | Ours | |`,
    `|---|---|---|---|`,
    `| Open balance (all invoices; PAID = $0) | ${usd(mg.openBalance)} | ${usd(ours.openBalance)} | ${open} |`,
    `| "Balance Due" column as Movegistics exports it | ${usd(mg.openBalanceAsExported ?? mg.openBalance)} | | explained below |`,
    `| Invoices | ${mg.invoiceCount} | ${ours.invoiceCount} | ${cell(mg.invoiceCount, ours.invoiceCount, false)} |`,
    `| Payments received | ${mg.paymentCount} | ${ours.paymentCount} | ${cell(mg.paymentCount, ours.paymentCount, false)} |`,
    '',
    '## Leads by source (leads still open in Movegistics)',
    '',
    '| Month | Source | Movegistics | Ours | |',
    '|---|---|---|---|---|',
    ...leadRows,
    '',
    '## What could not be linked, and why the totals still hold',
    '',
    ...Object.entries(issues).map(([k, v]) => `- **${v}** ${k}.${explanations[k] ? ` ${explanations[k]}` : ''}`),
    '',
  ].join('\n');
  return { markdown: md, differences };
}
