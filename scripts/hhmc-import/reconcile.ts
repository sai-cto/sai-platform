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
import Papa from 'papaparse';
import { leadSource, type Files, type Followups } from './movegistics';

// ---- Movegistics' side is read with its OWN minimal parsing (not the importer's helpers), so a
// bug in the mapping's amount, date or CSV handling cannot show up identically on both sides.
// Only the lead-source category (a label, not money) is shared, and the per-month lead total is
// also compared without it.
type CsvRow = Record<string, string>;
const rowsOf = (text: string): CsvRow[] => Papa.parse<CsvRow>(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy' }).data;
const val = (r: CsvRow, k: string) => (r[k] ?? '').trim();
/** Dollars → cents by rounding the floating value (a different method from the importer's digit parser). */
const money = (v: string) => (v.replace(/[$,\s]/g, '') ? Math.round(Number(v.replace(/[$,\s]/g, '')) * 100) : 0);
const NY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' });
/** "MM/DD/YYYY…" → "YYYY-MM"; epoch milliseconds → the month in Ithaca. */
function monthOf(v: string): string {
  const us = /^(\d{1,2})\/\d{1,2}\/(\d{4})/.exec(v.trim());
  if (us) return `${us[2]}-${us[1].padStart(2, '0')}`;
  if (/^\d{12,14}$/.test(v.trim())) return NY.format(new Date(Number(v.trim()))).slice(0, 7);
  const iso = /^(\d{4})-(\d{2})-\d{2}/.exec(v.trim());
  return iso ? `${iso[1]}-${iso[2]}` : 'no date';
}

type Month = string; // YYYY-MM
type Side = { jobs: Map<Month, number>; invoiced: Map<Month, number>; collected: Map<Month, number>; leads: Map<string, number>; leadsPerMonth: Map<Month, number>; openBalance: number; openBalanceAsExported?: number; openBalanceAsShown?: number; invoiceCount: number; paymentCount: number; unverifiedMonths?: Set<Month>; paidNotCovered?: { count: number; cents: number }; paidWithBalance?: number };
const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

/** `refunds`: hand-entered partial refund amounts (refund-amounts.csv), the same input the import uses. */
export function movegisticsSide(files: Files, refunds: Map<string, number> = new Map()): Side {
  const side: Side = { jobs: new Map(), invoiced: new Map(), collected: new Map(), leads: new Map(), leadsPerMonth: new Map(), openBalance: 0, openBalanceAsExported: 0, openBalanceAsShown: 0, invoiceCount: 0, paymentCount: 0, unverifiedMonths: new Set(), paidNotCovered: { count: 0, cents: 0 }, paidWithBalance: 0 };
  for (const r of rowsOf(files.workRequests)) add(side.jobs, monthOf(val(r, 'Work Request Created Date')), 1);
  const received = new Map<string, number>(); // invoice id → money received against it
  for (const r of rowsOf(files.payments)) {
    const tx = val(r, 'Transaction Status').toUpperCase();
    if (!['SUCCESSFUL', 'RECORDED', 'REFUNDED', 'PARTIAL_REFUNDED'].includes(tx)) continue;
    const amount = money(val(r, 'Amount Recd'));
    const m = monthOf(val(r, 'Payment Date') || val(r, 'Created At'));
    const refunded = tx === 'PARTIAL_REFUNDED' && refunds.has(val(r, 'Payment ID')) && refunds.get(val(r, 'Payment ID'))! <= amount ? refunds.get(val(r, 'Payment ID'))! : 0;
    add(side.collected, m, tx === 'REFUNDED' ? 0 : amount - refunded);
    if (tx === 'PARTIAL_REFUNDED' && !refunded) side.unverifiedMonths!.add(m);
    if (val(r, 'Invoice No.') && tx !== 'REFUNDED') received.set(val(r, 'Invoice No.'), (received.get(val(r, 'Invoice No.')) ?? 0) + amount - refunded);
    side.paymentCount++;
  }
  for (const r of rowsOf(files.invoices)) {
    const status = val(r, 'Status').toUpperCase();
    const amount = money(val(r, 'Invoice Amount'));
    add(side.invoiced, monthOf(val(r, 'Invoice Date')), amount);
    const exported = Math.max(0, Math.min(money(val(r, 'Balance Due')), amount));
    side.openBalanceAsExported! += exported;
    // An invoice Movegistics marks PAID (or void) owes nothing, whatever its stale "Balance Due" says.
    const closed = status === 'PAID' || status.startsWith('VOID') || status.startsWith('CANCEL');
    side.openBalanceAsShown! += closed ? 0 : exported;
    // An open one owes at most what the payments recorded against it leave (Movegistics often
    // leaves Balance Due untouched after the money came in).
    const left = Math.max(0, amount - (received.get(val(r, 'Invoice ID')) ?? 0));
    side.openBalance += closed || left <= 1 ? 0 : Math.min(exported, left);
    if (status === 'PAID' && exported > 0) side.paidWithBalance!++;
    if (status === 'PAID' && (received.get(val(r, 'Invoice ID')) ?? 0) < amount - 1) {
      side.paidNotCovered!.count++;
      side.paidNotCovered!.cents += amount - (received.get(val(r, 'Invoice ID')) ?? 0);
    }
    side.invoiceCount++;
  }
  for (const r of rowsOf(files.leads)) {
    const m = monthOf(val(r, 'Lead Created Date'));
    add(side.leads, `${m}|${leadSource(val(r, 'Referral Source')).source}`, 1);
    add(side.leadsPerMonth, m, 1);
  }
  return side;
}

export async function ourSide(s: Scope, tz: string): Promise<Side> {
  const side: Side = { jobs: new Map(), invoiced: new Map(), collected: new Map(), leads: new Map(), leadsPerMonth: new Map(), openBalance: 0, invoiceCount: 0, paymentCount: 0 };
  const imported = (type: string) =>
    s.db.select({ id: hhmcImportRefs.recordId }).from(hhmcImportRefs).where(and(s.where(hhmcImportRefs), eq(hhmcImportRefs.source, 'movegistics'), eq(hhmcImportRefs.sourceType, type)));
  const localMonth = (col: unknown) => sql<string>`to_char(${col} at time zone ${tz}, 'YYYY-MM')`;

  const jobs = await s.db
    .select({ m: localMonth(hhmcJobs.createdAt), n: sql<number>`count(*)::int` })
    .from(hhmcJobs)
    .where(and(s.where(hhmcJobs), inArray(hhmcJobs.id, imported('work_request')), sql`${hhmcJobs.jobNumber} not like 'invoice-job:%' and ${hhmcJobs.jobNumber} not like 'estimate-job:%'`))
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
  for (const r of leads) {
    add(side.leads, `${r.m}|${r.source}`, r.n);
    add(side.leadsPerMonth, r.m, r.n);
  }
  return side;
}

const usd = (c: number) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function reconciliationReport(
  mg: Side,
  ours: Side,
  issues: Record<string, number>,
  explanations: Record<string, string>,
  followups: Followups = { partialRefundsWithoutAmount: [], paidInvoicesNotCovered: [], estimatesOnPlaceholder: [] },
): { markdown: string; differences: number; summary: string } {
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
    const collectedCell = mg.unverifiedMonths?.has(m) && mc === oc ? '⚠️ equal, unverified (a partial refund of unknown size)' : cell(mc, oc, true);
    lines.push(`| ${m} | ${mj} / ${oj} | ${cell(mj, oj, false)} | ${usd(mi)} / ${usd(oi)} | ${cell(mi, oi, true)} | ${usd(mc)} / ${usd(oc)} | ${collectedCell} |`);
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
    `Generated ${new Date().toISOString()} by \`scripts/hhmc-import\`. Movegistics' side is computed directly from its own CSV exports; ours from the local database's HHMC live data. Totals and Movegistics ids only: no names.`,
    '',
    '@@HEADLINE@@',
    '',
    '## Per month',
    '',
    'Work requests by the month Movegistics created them; invoiced = invoice amounts by invoice date; collected = payments received (not "requested"), net of full refunds, by payment date.',
    '',
    ...lines,
    '',
    '## Open balance today',
    '',
    `Movegistics leaves the "Balance Due" column above zero on ${mg.paidWithBalance ?? 0} invoices it marks **PAID**; its invoice list shows the same contradiction on screen. A PAID (or void) invoice is counted here as owing $0, and the column as exported is shown for transparency. Check against Movegistics' own payments export: **${mg.paidNotCovered?.count ?? 0} PAID invoices (${usd(mg.paidNotCovered?.cents ?? 0)}) are not fully covered by payments recorded against them**. The import credits each work request's deposit to its invoice; ${followups.paidInvoicesNotCovered.length} remain uncovered after that (listed by id at the end): paid some other way, or a Movegistics data error.`,
    '',
    `| | Movegistics | Ours | |`,
    `|---|---|---|---|`,
    `| Open balance (PAID = $0; an open invoice owes at most what its own payments leave) | ${usd(mg.openBalance)} | ${usd(ours.openBalance)} | ${open} |`,
    `| Open balance as Movegistics' own list shows it (unpaid statuses, Balance Due as exported) | ${usd(mg.openBalanceAsShown ?? mg.openBalance)} | | higher: it ignores payments recorded against those invoices |`,
    `| "Balance Due" column as Movegistics exports it | ${usd(mg.openBalanceAsExported ?? mg.openBalance)} | | explained below |`,
    `| Invoices | ${mg.invoiceCount} | ${ours.invoiceCount} | ${cell(mg.invoiceCount, ours.invoiceCount, false)} |`,
    `| Payments received | ${mg.paymentCount} | ${ours.paymentCount} | ${cell(mg.paymentCount, ours.paymentCount, false)} |`,
    '',
    '## Leads per month (leads still open in Movegistics; independent of the source mapping)',
    '',
    '| Month | Movegistics | Ours | |',
    '|---|---|---|---|',
    ...[...new Set([...mg.leadsPerMonth.keys(), ...ours.leadsPerMonth.keys()])].sort().map((m) => `| ${m} | ${mg.leadsPerMonth.get(m) ?? 0} | ${ours.leadsPerMonth.get(m) ?? 0} | ${cell(mg.leadsPerMonth.get(m) ?? 0, ours.leadsPerMonth.get(m) ?? 0, false)} |`),
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
    '## To look up in Movegistics (ids only)',
    '',
    `- Partial refunds with no amount (add each to \`data/movegistics/refund-amounts.csv\` as "Payment ID","Refunded Amount", then re-run): ${followups.partialRefundsWithoutAmount.join(', ') || 'none'}`,
    `- PAID invoices not covered by any payment or deposit in the export: ${followups.paidInvoicesNotCovered.join(', ') || 'none'}`,
    `- Estimates kept on a placeholder work request (no work request for their contact): ${followups.estimatesOnPlaceholder.join(', ') || 'none'}`,
    `- Invoices still open more than a year past due (paid outside Movegistics, or to write off?): ${followups.staleOpenInvoices?.join(', ') || 'none'}`,
    '',
  ].join('\n');
  // The headline is written last, after every cell above has counted its difference.
  const warnings = [
    mg.unverifiedMonths?.size ? `${mg.unverifiedMonths.size} month(s) hold a partial refund of unknown size (equal, but unverified)` : null,
    // Counted after crediting each work request's deposit (the normalizer's list), not the raw count above.
    followups.paidInvoicesNotCovered.length ? `${followups.paidInvoicesNotCovered.length} PAID invoice(s) are not covered by any payment or deposit in the export` : null,
  ].filter(Boolean);
  const headline = `**Result: ${differences === 0 ? 'every number matches to the cent ✅' : `${differences} difference(s): each is explained below ❌`}${warnings.length ? `; ⚠️ unverified: ${warnings.join('; ')} — NEEDS JAI REVIEW` : ''}**`;
  const allTime = `All time: work requests ${sum.mj} / ${sum.oj}, invoiced ${usd(sum.mi)} / ${usd(sum.oi)}, collected ${usd(sum.mc)} / ${usd(sum.oc)}, open balance ${usd(mg.openBalance)} / ${usd(ours.openBalance)} (Movegistics / ours).`;
  const summary = [headline.replace(/\*\*/g, ''), allTime, ...Object.entries(issues).map(([k, v]) => `  ${v} ${k}`)].join('\n');
  return { markdown: md.replace('@@HEADLINE@@', headline), differences, summary };
}
