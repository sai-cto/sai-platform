/**
 * The Movegistics importer (scripts/hhmc-import) on FAKE Movegistics-shaped exports
 * (tests/fixtures/movegistics/): the mapping rules, then a real load into the test database
 * through the record functions, the reconciliation, and a re-run that changes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, inArray, like } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { notifications, payments } from '@/core/db/schema';
import { withScope, type Scope } from '@/core/db/scope';
import { updateRecord } from '@/core/records/records';
import { jobEntity } from '@/modules/hhmc/entities';
import { hhmcAutomationQueue, hhmcEstimates, hhmcImportRefs, hhmcInvoiceLines, hhmcInvoices, hhmcJobs } from '@/modules/hhmc/schema';
import { loadIntoHhmc } from '../../scripts/hhmc-import/load';
import { cents, day, FILE_NAMES, leadSource, normalize, UnknownValues, type Files } from '../../scripts/hhmc-import/movegistics';
import { movegisticsSide, ourSide, reconciliationReport } from '../../scripts/hhmc-import/reconcile';
import { ctxFor, systemContext, USERS } from './helpers';

const dir = path.resolve(__dirname, '../fixtures/movegistics');
const files = Object.fromEntries(Object.entries(FILE_NAMES).map(([k, f]) => [k, fs.readFileSync(path.join(dir, f), 'utf8')])) as Files;

describe('Movegistics exports → normalized records', () => {
  const n = normalize(files);

  it('reads amounts exactly, rounding Movegistics float noise to the cent', () => {
    expect(cents('800.40')).toBe(80040);
    expect(cents('250.0000000000001')).toBe(25000);
    expect(cents('12.999999999999998')).toBe(1300);
    expect(cents('$1,234.5')).toBe(123450);
    expect(day('01/20/2026')).toBe('2026-01-20');
    expect(day('1767225600000')).toBe('2025-12-31'); // midnight UTC = 7 pm the day before in Ithaca
  });

  it('keeps one customer per email (then phone)', () => {
    expect(n.contacts.filter((c) => c.email === 'avery.fixture@example.com')).toHaveLength(1);
    expect(n.issues['contacts merged as duplicates (same email or phone)']).toBe(1);
  });

  it('never makes a customer out of an unconverted lead', () => {
    expect(n.leads).toHaveLength(2);
    expect(n.contacts.some((c) => c.email === 'casey.lead@example.com')).toBe(false);
    expect(n.leads.map((l) => l.source)).toEqual(['Google', 'Other']);
    expect(leadSource('Cornell university').source).toBe('Cornellian');
    expect(leadSource('Used you before').source).toBe('Repeat Customer');
  });

  it('maps work requests to stages from what happened next', () => {
    const avery = n.jobs.find((j) => j.sid === 'WR900001')!;
    expect(avery.stage).toBe('closed'); // closed won, invoiced, invoice paid
    expect(avery.days).toEqual(['2026-01-20']);
    expect(avery.serviceType).toBe('local');
    expect(n.jobs.find((j) => j.sid === 'WR900002')!.stage).toBe('estimate_sent');
  });

  it('keeps one estimate in force per work request; the older open one is void with a reason', () => {
    const blake = n.estimates.filter((e) => e.jobSid === 'WR900002');
    expect(blake.map((e) => [e.sid, e.version, e.status])).toEqual([['ES900002', 1, 'void'], ['ES900003', 2, 'sent']]);
    expect(blake[0].voidReason).toMatch(/later estimate/);
    expect(n.issues['estimates with no matching work request (not imported)']).toBe(1);
  });

  it('a PAID invoice owes nothing, whatever its stale "Balance Due" says', () => {
    expect(n.invoices.find((i) => i.sid === 'IN900001')).toMatchObject({ status: 'paid', amountCents: 80040, balanceCents: 0 });
    expect(n.invoices.find((i) => i.sid === 'IN900002')).toMatchObject({ status: 'partially_paid', amountCents: 25000, balanceCents: 10000 });
    // No work request named: a placeholder keeps the money in the totals.
    expect(n.jobs.find((j) => j.sid === 'invoice-job:IN900002')!.placeholder).toBe(true);
  });

  it('payments: requests never paid are skipped; refunds recorded; deposits find their work request', () => {
    expect(n.payments.map((p) => p.sid).sort()).toEqual(['PM900001', 'PM900002', 'PM900003', 'PM900005']);
    expect(n.payments.find((p) => p.sid === 'PM900005')!.refundedCents).toBe(5000);
    expect(n.payments.find((p) => p.sid === 'PM900001')).toMatchObject({ isDeposit: true, jobSid: 'WR900001', method: 'card', cardLast4: '4242' });
    expect(n.payments.find((p) => p.sid === 'PM900003')!.method).toBe('check');
  });
});

describe('unknown Movegistics values stop the import', () => {
  it('an invoice, estimate or payment status the importer does not know is never guessed', () => {
    const odd = { ...files, invoices: files.invoices.replace('"PARTIAL_PAID"', '"WRITTEN_OFF"'), payments: files.payments.replace('"REQUESTED"', '"CHARGEBACK"') };
    expect(() => normalize(odd)).toThrow(UnknownValues);
    expect(() => normalize(odd)).toThrow(/invoice Status: WRITTEN_OFF.*payment Transaction Status: CHARGEBACK/);
  });

  it('declined or failed payments are not money; a void invoice owes nothing', () => {
    const n = normalize({ ...files, payments: files.payments.replace('"REQUESTED"', '"FAILED"'), invoices: files.invoices.replace('"PARTIAL_PAID"', '"VOID"') });
    expect(n.payments.some((p) => p.sid === 'PM900004')).toBe(false);
    expect(n.invoices.find((i) => i.sid === 'IN900002')).toMatchObject({ status: 'void', balanceCents: 0 });
  });
});

describe('loading into HHMC through the record functions', () => {
  it('imports, reconciles to the cent, and a second run changes nothing', async () => {
    const ctx = await systemContext('hhmc', 'live');
    const batch = <T>(fn: (s: Scope) => Promise<T>) => withScope(ctx, 'hhmc.import.run', fn);
    const n = normalize(files);
    const first = await loadIntoHhmc(batch, n);
    expect(first.stats.work_request.created + first.stats.work_request.unchanged + first.stats.work_request.updated).toBe(n.jobs.length);

    const report = reconciliationReport(movegisticsSide(files), await batch((s) => ourSide(s, ctx.business.timeZone)), n.issues, {});
    // Our side counts every import in this test database, so compare this fixture's own records.
    const ids = first.ids;
    const mine = await batch(async (s) => ({
      invoices: await s.db.select().from(hhmcInvoices).where(and(s.where(hhmcInvoices), inArray(hhmcInvoices.id, [ids.get('invoice:IN900001')!, ids.get('invoice:IN900002')!]))),
      pays: await s.db.select().from(payments).where(and(s.where(payments), like(payments.providerRef, 'movegistics:PM9%'))),
      jobs: await s.db.select().from(hhmcJobs).where(and(s.where(hhmcJobs), inArray(hhmcJobs.jobNumber, ['WR900001', 'WR900002']))),
    }));
    expect(mine.invoices.reduce((t, i) => t + i.totalCents, 0)).toBe(80040 + 25000);
    expect(mine.pays.map((p) => p.provider)).toEqual(['manual', 'manual', 'manual', 'manual']);
    expect(mine.pays.reduce((t, p) => t + p.amountCents - p.refundedCents, 0)).toBe(16008 + 64032 + 15000);
    expect(mine.jobs.find((j) => j.jobNumber === 'WR900001')!.createdAt.toISOString().slice(0, 10)).toBe('2026-01-06');
    expect(report.differences).toBe(0);
    expect(report.markdown).toContain('every number matches to the cent');

    // Nothing was emailed or queued for imported records.
    const quiet = await batch(async (s) => ({
      queued: await s.db.select().from(hhmcAutomationQueue).where(and(s.where(hhmcAutomationQueue), inArray(hhmcAutomationQueue.jobId, mine.jobs.map((j) => j.id)))),
      sent: await s.db.select().from(notifications).where(and(s.where(notifications), inArray(notifications.recipient, ['avery.fixture@example.com', 'blake.sample@example.com']))),
    }));
    expect(quiet.queued).toHaveLength(0);
    expect(quiet.sent).toHaveLength(0);

    // Re-running: no duplicates, nothing changed.
    const second = await loadIntoHhmc(batch, normalize(files));
    for (const st of Object.values(second.stats)) expect(st.created + st.updated + st.linked).toBe(0);
    const refs = await batch((s) => s.db.select().from(hhmcImportRefs).where(and(s.where(hhmcImportRefs), eq(hhmcImportRefs.sourceId, 'WR900001'))));
    expect(refs).toHaveLength(1);
  });
});

describe('re-running the import on a changed export', () => {
  it('keeps two people who share a phone apart, keeps staff edits, never collides on an estimate version, keeps the invoice line equal to its total', async () => {
    const ctx = await systemContext('hhmc', 'live');
    const batch = <T>(fn: (s: Scope) => Promise<T>) => withScope(ctx, 'hhmc.import.run', fn);
    const base = await loadIntoHhmc(batch, normalize(files));

    // Staff change a work request in SAI.
    const gm = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'live');
    const wr = base.ids.get('work_request:WR900002')!;
    await withScope(gm, 'hhmc.jobs.write', (s) => updateRecord(s, jobEntity, wr, { internalNotes: 'Changed by staff in SAI' }));

    const changed: Files = {
      ...files,
      // Someone else on Avery's (shared) phone, with a different email.
      contacts: files.contacts.trimEnd() + '\n"CN900009","Dana","Sharedline","dana.sharedline@example.com","+1 607-555-0101","","Hired  Hands","","","","03/01/2026","03/01/2026","","","","","","","","","","","",""\n',
      // Movegistics changes the same work request's note.
      workRequests: files.workRequests.replace('"1170","","","","","","Interstate"', '"1170","","","","Edited in Movegistics","","Interstate"'),
      // A new estimate dated BEFORE the existing ones for the same work request.
      estimates: files.estimates.trimEnd() + '\n"ES900005","Interstate Estimate for Blake Sample","1050","Sent","General","Blake Sample","","","02/01/2026","02/01/2026","03/01/2026","Blake Sample - Work Request","Interstate",""\n',
      // An invoice amount corrected in Movegistics.
      invoices: files.invoices.replace('"IN900001","","","01/21/2026","800.40","800.40"', '"IN900001","","","01/21/2026","810.00","810.00"'),
    };
    const run = await loadIntoHhmc(batch, normalize(changed));
    expect(run.ids.get('contact:CN900009')).not.toBe(base.ids.get('contact:CN900001'));
    expect(run.stats.work_request.kept).toBeGreaterThanOrEqual(1);
    const after = await batch(async (s) => ({
      job: (await s.db.select().from(hhmcJobs).where(and(s.where(hhmcJobs), eq(hhmcJobs.id, wr))))[0],
      versions: (await s.db.select({ v: hhmcEstimates.version, n: hhmcEstimates.estimateNumber }).from(hhmcEstimates).where(and(s.where(hhmcEstimates, 'include'), eq(hhmcEstimates.jobId, wr)))).map((e) => e.v),
      line: (await s.db.select().from(hhmcInvoiceLines).where(and(s.where(hhmcInvoiceLines), eq(hhmcInvoiceLines.invoiceId, base.ids.get('invoice:IN900001')!))))[0],
    }));
    expect(after.job.internalNotes).toBe('Changed by staff in SAI');
    expect(new Set(after.versions).size).toBe(after.versions.length);
    expect(after.line.rateCents).toBe(81000);

    // Back to the original export (other tests rely on it).
    await loadIntoHhmc(batch, normalize(files));
  });
});

describe('re-running the import: deposits and shared phones', () => {
  it('an estimate with a deposit still takes Movegistics changes (the deposit is part of its own import)', async () => {
    const ctx = await systemContext('hhmc', 'live');
    const batch = <T>(fn: (s: Scope) => Promise<T>) => withScope(ctx, 'hhmc.import.run', fn);
    const base = await loadIntoHhmc(batch, normalize(files));
    const id = base.ids.get('estimate:ES900001')!;
    const signed = await batch(async (s) => (await s.db.select().from(hhmcEstimates).where(and(s.where(hhmcEstimates), eq(hhmcEstimates.id, id))))[0]);
    expect(signed.depositPaidCents).toBe(16008);
    const run = await loadIntoHhmc(batch, normalize({ ...files, estimates: files.estimates.replace('"ES900001","Local Estimate for Avery Fixture","800.40","Signed"', '"ES900001","Local Estimate for Avery Fixture","800.40","Void"') }));
    expect(run.stats.estimate.kept).toBe(0);
    const voided = await batch(async (s) => (await s.db.select().from(hhmcEstimates).where(and(s.where(hhmcEstimates), eq(hhmcEstimates.id, id))))[0]);
    expect(voided.status).toBe('void');
    await loadIntoHhmc(batch, normalize(files)); // restore
  });

  it('someone without an email, then someone else with an email on the same phone: two customers', () => {
    const n = normalize({
      ...files,
      contacts: files.contacts.trimEnd() + '\n"CN900010","Pat","Nomail","","+1 607-555-0177","","Hired  Hands","","","","03/01/2026","03/01/2026","","","","","","","","","","","",""\n"CN900011","Robin","Hasmail","robin.hasmail@example.com","+1 607-555-0177","","Hired  Hands","","","","03/02/2026","03/02/2026","","","","","","","","","","","",""\n',
    });
    expect(n.contacts.filter((c) => c.phone === '6075550177').map((c) => c.sid)).toEqual(['CN900010', 'CN900011']);
  });
});

describe('the loader matches phones only against customers from before the run', () => {
  it('two people on one phone (the first without an email) become two customers', async () => {
    const ctx = await systemContext('hhmc', 'live');
    const batch = <T>(fn: (s: Scope) => Promise<T>) => withScope(ctx, 'hhmc.import.run', fn);
    const extra = '\n"CN900020","Sam","Nomail","","+1 607-555-0178","","Hired  Hands","","","","03/01/2026","03/01/2026","","","","","","","","","","","",""\n"CN900021","Lee","Hasmail","lee.hasmail@example.com","+1 607-555-0178","","Hired  Hands","","","","03/02/2026","03/02/2026","","","","","","","","","","","",""\n';
    const run = await loadIntoHhmc(batch, normalize({ ...files, contacts: files.contacts.trimEnd() + extra }));
    expect(run.ids.get('contact:CN900020')).toBeTruthy();
    expect(run.ids.get('contact:CN900021')).toBeTruthy();
    expect(run.ids.get('contact:CN900021')).not.toBe(run.ids.get('contact:CN900020'));
  });
});
