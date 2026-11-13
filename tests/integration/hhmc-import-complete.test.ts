/**
 * The Movegistics importer, parity round: every exported column is kept, more fields are mapped,
 * work-order days follow re-exports, estimates are never dropped, deposits are credited to
 * invoices, and hand-entered partial refunds reconcile. FAKE data only (made-up people at
 * example.com), built in the exact column layout of the fixture exports.
 */
import fs from 'node:fs';
import path from 'node:path';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { appointments, payments } from '@/core/db/schema';
import { withScope, type Scope } from '@/core/db/scope';
import { updateRecord } from '@/core/records/records';
import { jobDayEntity } from '@/modules/hhmc/entities';
import { hhmcImportRefs, hhmcInvoices, hhmcJobDays, hhmcJobs, hhmcLeads } from '@/modules/hhmc/schema';
import { loadIntoHhmc } from '../../scripts/hhmc-import/load';
import { daysBetween, FILE_NAMES, normalize, parseRefundOverrides, type Files } from '../../scripts/hhmc-import/movegistics';
import { movegisticsSide, ourSide, reconciliationReport } from '../../scripts/hhmc-import/reconcile';
import { contactPage } from '@/modules/hhmc/services/directory';
import { jobPage, leadPage } from '@/modules/hhmc/services/views';
import { ctxFor, systemContext, USERS } from './helpers';

const dir = path.resolve(__dirname, '../fixtures/movegistics');
const fixture = Object.fromEntries(Object.entries(FILE_NAMES).map(([k, f]) => [k, fs.readFileSync(path.join(dir, f), 'utf8')])) as Files;
const header = (text: string) => text.split('\n')[0];
const columns = (text: string) => header(text).split(',').map((c) => c.replace(/^"|"$/g, ''));

/** A CSV in the fixture's own column layout; the work-order export has two "Status" columns. */
function csv(of: keyof Files, rows: Record<string, string>[]): string {
  const cols = columns(fixture[of]);
  const line = (r: Record<string, string>) => cols.map((c, i) => `"${(cols.indexOf(c) === i ? r[c] : r[`${c}#2`]) ?? ''}"`).join(',');
  return [header(fixture[of]), ...rows.map(line)].join('\n') + '\n';
}

const person = (id: string, first: string, last: string, extra: Record<string, string> = {}) => ({
  'Contact ID': id, 'First Name': first, 'Last Name': last, 'Email Address': `${first}.${last}@example.com`.toLowerCase(), 'Contact Number - Mobile': '',
  'Contact Owner': 'Hired  Hands', 'Contact Created Date': '04/01/2026', 'Contact Modified Date': '04/01/2026', ...extra,
});
const workRequest = (id: string, title: string, contact: string, extra: Record<string, string> = {}) => ({
  'Work Request Owner': 'Hired  Hands', 'Work Request ID': id, 'Work Request Title': title, 'Contact Name': contact, Tentative: 'no', 'Move Date': '05/10/2026',
  'Move Type': 'Residential', Pipeline: 'Sales', 'Pipeline Stage': 'Closed Won', 'Transportation Labor Amount': '500', 'Work Request Amount': '500',
  'Service Type': 'Local', 'Work Request Created Date': '04/02/2026', 'Origin Address Line 1': '1 Fake St', 'Origin City': 'Ithaca', 'Origin State': 'NY',
  'Destination Address Line 1': '2 Fake Ave', 'Destination City': 'Ithaca', 'Destination State': 'NY', ...extra,
});
const workOrder = (id: string, wr: string, contact: string, start: string, end: string, extra: Record<string, string> = {}) => ({
  'WO ID': id, 'Start Date': start, 'End Date': end, 'WO Title': `${wr} - Work Order`, Pipeline: 'Operations', 'Pipeline Stage': 'Booked', 'Service Type': 'Local',
  'Created At': '04/03/2026', 'Contact Name': contact, 'Work Request': wr, 'Owner Name': 'Hired  Hands', ...extra,
});

describe('normalizing: more fields, nothing dropped', () => {
  it('keeps every non-blank column of every row, including merged duplicate contacts', () => {
    const n = normalize(fixture);
    const avery = n.contacts.find((c) => c.sid === 'CN900001')!;
    expect(avery.raw['Contact ID']).toBe('CN900001');
    expect(avery.raw['Contact Owner']).toBe('Hired  Hands');
    expect(Object.values(avery.raw).every((v) => v.trim() !== '')).toBe(true);
    expect(avery.duplicates.map((d) => [d.sid, d.raw['Internal Note']])).toEqual([['CN900002', 'duplicate']]);
    expect(n.jobs.find((j) => j.sid === 'WR900001')!.raw['Work Request Amount']).toBe('800.40');
    expect(n.payments.find((p) => p.sid === 'PM900005')!.description).toContain('refund reason: Changed date');
  });

  it('maps lead status, rating, storage, move type and campaign ids', () => {
    const leads = fixture.leads
      .replace('"New","","","","03/01/2026"', '"Disqualified","","Too far","03/04/2026","03/01/2026"')
      .replace('"casey.lead@example.com","+1 607-555-0103","","Google search","1767225600000","Residential","",', '"casey.lead@example.com","+1 607-555-0103","","Google search","1767225600000","Commercial","Yes",');
    const n = normalize({ ...fixture, leads });
    const casey = n.leads.find((l) => l.sid === 'LD900001')!;
    expect(casey).toMatchObject({ status: 'disqualified', disqualifiedReason: 'Too far', disqualifiedOn: '2026-03-04', moveType: 'commercial', storage: true });
    expect(n.leads.find((l) => l.sid === 'LD900002')!.status).toBe('new');
  });

  it('an unknown lead status is kept as New and counted, never stops the import', () => {
    const n = normalize({ ...fixture, leads: fixture.leads.replace('"New","","","","03/15/2026"', '"Nurturing","","","","03/15/2026"') });
    expect(n.leads.find((l) => l.sid === 'LD900002')!.status).toBe('new');
    expect(n.issues['leads with a status the importer does not know (kept as New; the original is on the lead)']).toBe(1);
  });

  it('a work order spanning days books every day; cancelled work orders are left out; the move date is the first day', () => {
    expect(daysBetween('2026-05-10', '2026-05-12')).toEqual(['2026-05-10', '2026-05-11', '2026-05-12']);
    expect(daysBetween('2026-05-10', null)).toEqual(['2026-05-10']);
    expect(daysBetween('2026-05-10', '2026-07-01')).toHaveLength(14);
    const n = normalize({
      ...fixture,
      contacts: csv('contacts', [person('CN910001', 'Quinn', 'Multiday')]),
      workRequests: csv('workRequests', [workRequest('WR910001', 'Quinn Multiday - Work Request', 'Quinn Multiday')]),
      workOrders: csv('workOrders', [
        workOrder('WO910001', 'Quinn Multiday - Work Request', 'Quinn Multiday', '05/11/2026', '05/12/2026', { Crew: 'Two movers', 'Assigned vehicle': "16' truck" }),
        workOrder('WO910002', 'Quinn Multiday - Work Request', 'Quinn Multiday', '05/20/2026', '05/20/2026', { 'Pipeline Stage': 'Cancelled Out' }),
      ]),
      estimates: csv('estimates', []), invoices: csv('invoices', []), payments: csv('payments', []), leads: csv('leads', []),
    });
    const job = n.jobs.find((j) => j.sid === 'WR910001')!;
    expect(job.days).toEqual(['2026-05-11', '2026-05-12']);
    expect(job.moveDate).toBe('2026-05-11');
    expect(job.dayNotes['2026-05-11']).toBe("WO WO910001, crew: Two movers, vehicle: 16' truck");
  });

  it('a repeat customer\'s work requests with the same title each get only their own work order', () => {
    const title = 'Sam Repeat - Work Request';
    const n = normalize({
      ...fixture,
      contacts: csv('contacts', [person('CN930001', 'Sam', 'Repeat')]),
      workRequests: csv('workRequests', [
        workRequest('WR930001', title, 'Sam Repeat', { 'Work Request Created Date': '01/05/2025', 'Move Date': '02/01/2025' }),
        workRequest('WR930002', title, 'Sam Repeat', { 'Work Request Created Date': '05/05/2026', 'Move Date': '06/10/2026' }),
      ]),
      workOrders: csv('workOrders', [
        workOrder('WO930001', title, 'Sam Repeat', '02/01/2025', '02/01/2025', { 'Created At': '01/10/2025' }),
        workOrder('WO930002', title, 'Sam Repeat', '06/10/2026', '06/10/2026', { 'Created At': '05/10/2026' }),
      ]),
      estimates: csv('estimates', []), invoices: csv('invoices', []), payments: csv('payments', []), leads: csv('leads', []),
    });
    const [first, second] = ['WR930001', 'WR930002'].map((sid) => n.jobs.find((j) => j.sid === sid)!);
    expect([first.workOrderSids, first.days, first.bookedOn]).toEqual([['WO930001'], ['2025-02-01'], '2025-01-10']);
    expect([second.workOrderSids, second.days, second.bookedOn]).toEqual([['WO930002'], ['2026-06-10'], '2026-05-10']);
  });

  it("a repeat customer's invoice goes to the booked move it is for, not to a later lost request with the same title", () => {
    const title = 'Gale Repeat - Work Request';
    const n = normalize({
      ...fixture,
      contacts: csv('contacts', [person('CN940001', 'Gale', 'Repeat')]),
      workRequests: csv('workRequests', [
        workRequest('WR940001', title, 'Gale Repeat', { 'Work Request Created Date': '04/24/2022', 'Move Date': '06/09/2022' }),
        workRequest('WR940002', title, 'Gale Repeat', { 'Work Request Created Date': '05/15/2022', 'Move Date': '06/11/2022', 'Pipeline Stage': 'Closed Lost' }),
      ]),
      workOrders: csv('workOrders', [workOrder('WO940001', title, 'Gale Repeat', '06/09/2022', '06/09/2022', { 'Created At': '04/30/2022' })]),
      invoices: csv('invoices', [{ 'Invoice ID': 'IN940001', 'Invoice Date': '06/10/2022', 'Invoice Amount': '300', 'Balance Due': '0', Status: 'PAID', 'Due Date': '06/10/2022', 'Contact Name': 'Gale Repeat', 'Created Date': '06/10/2022', 'Work Request Title': title }]),
      estimates: csv('estimates', []), payments: csv('payments', []), leads: csv('leads', []),
    });
    expect(n.invoices[0].jobSid).toBe('WR940001');
    // ...and its deposit, paid before the lost request's earlier move date, goes to the same move.
    const withDeposit = normalize({
      ...fixture,
      contacts: csv('contacts', [person('CN940001', 'Gale', 'Repeat')]),
      workRequests: csv('workRequests', [
        workRequest('WR940001', title, 'Gale Repeat', { 'Work Request Created Date': '04/24/2022', 'Move Date': '06/20/2022' }),
        workRequest('WR940002', title, 'Gale Repeat', { 'Work Request Created Date': '05/15/2022', 'Move Date': '06/01/2022', 'Pipeline Stage': 'Closed Lost' }),
      ]),
      workOrders: csv('workOrders', [workOrder('WO940001', title, 'Gale Repeat', '06/20/2022', '06/20/2022', { 'Created At': '04/30/2022' })]),
      payments: csv('payments', [{ 'Payment Date': '05/20/2022', 'Payment ID': 'PM940001', 'Amount Recd': '60', 'Payment Mode': 'Card', Deposit: 'Yes', 'Contact Name': 'Gale Repeat', 'Transaction Status': 'Successful', 'Created At': '05/20/2022' }]),
      estimates: csv('estimates', []), invoices: csv('invoices', []), leads: csv('leads', []),
    });
    expect(withDeposit.payments[0].jobSid).toBe('WR940001');
    expect(n.jobs.find((j) => j.sid === 'WR940001')!.workOrderSids).toEqual(['WO940001']);
  });

  it("an estimate whose title matches no work request goes to its contact's work request", () => {
    const n = normalize({ ...fixture, estimates: fixture.estimates.replace('"Avery Fixture - Work Request","Local"', '"Avery Fixture - Renamed","Local"') });
    expect(n.estimates.find((e) => e.sid === 'ES900001')!.jobSid).toBe('WR900001');
    expect(n.issues["estimates linked to their contact's work request (the work request title did not match)"]).toBe(1);
  });

  it("credits the work request's deposit to a PAID invoice Movegistics left it unapplied on", () => {
    const n = normalize(fixture);
    // Avery: $800.40 invoice PAID; $640.32 paid on it, the $160.08 deposit "Unapplied".
    expect(n.invoices.find((i) => i.sid === 'IN900001')!.depositCreditCents).toBe(16008);
    expect(n.followups.paidInvoicesNotCovered).toEqual([]);
    // Without the deposit, the same invoice is listed by id for a manager to look up.
    const without = normalize({ ...fixture, payments: fixture.payments.replace(/"01\/08\/2026","PM900001".*\n/, '') });
    expect(without.followups.paidInvoicesNotCovered).toEqual(['IN900001']);
  });

  it('an open invoice its own payments already cover is paid; partly covered, it owes only what is left; reconciliation agrees', () => {
    // Movegistics shows IN900002 "Sent" with its whole $250 due, though $150 was paid against it.
    const stale = fixture.invoices.replace('"02/01/2026","250.0000000000001","100","PARTIAL_PAID"', '"02/01/2026","250.0000000000001","250","SENT"');
    const partly = normalize({ ...fixture, invoices: stale });
    expect(partly.invoices.find((i) => i.sid === 'IN900002')).toMatchObject({ status: 'partially_paid', balanceCents: 10000 });
    expect(movegisticsSide({ ...fixture, invoices: stale }).openBalance).toBe(10000);
    expect(movegisticsSide({ ...fixture, invoices: stale }).openBalanceAsShown).toBe(25000);
    // The rest was paid too, but Movegistics never changed the status.
    const paid = fixture.payments.replace('"02/02/2026","PM900003","150"', '"02/02/2026","PM900003","250"');
    const covered = normalize({ ...fixture, invoices: stale, payments: paid });
    expect(covered.invoices.find((i) => i.sid === 'IN900002')).toMatchObject({ status: 'paid', balanceCents: 0 });
    expect(covered.issues['open invoices whose own payments cover them in full (imported as paid)']).toBe(1);
    expect(movegisticsSide({ ...fixture, invoices: stale, payments: paid }).openBalance).toBe(0);
    // Its placeholder work request is closed with it.
    expect(covered.jobs.find((j) => j.sid === 'invoice-job:IN900002')!.stage).toBe('closed');
  });

  it('invoices open more than a year past due are listed for a manager, still counted as open', () => {
    const n = normalize(fixture, { today: '2027-03-01' });
    expect(n.followups.staleOpenInvoices).toEqual(['IN900002']);
    expect(normalize(fixture, { today: '2026-06-01' }).followups.staleOpenInvoices).toEqual([]);
    expect(n.invoices.find((i) => i.sid === 'IN900002')!.balanceCents).toBe(10000);
  });

  it('partial refunds: listed by id without an amount; the hand-entered amount is used and reconciles', () => {
    const partial = fixture.payments.replace('"Check","No","Blake Sample","","IN900002","CLOSED","RECORDED"', '"Check","No","Blake Sample","","IN900002","CLOSED","PARTIAL_REFUNDED"');
    const before = normalize({ ...fixture, payments: partial });
    expect(before.followups.partialRefundsWithoutAmount).toEqual(['PM900003']);
    const refunds = parseRefundOverrides('"Payment ID","Refunded Amount"\n"PM900003","40.00"\n');
    const after = normalize({ ...fixture, payments: partial }, { refunds });
    expect(after.payments.find((p) => p.sid === 'PM900003')!.refundedCents).toBe(4000);
    expect(after.followups.partialRefundsWithoutAmount).toEqual([]);
    // Movegistics' side uses the same hand-entered amount, so the month is no longer "unverified".
    const mg = movegisticsSide({ ...fixture, payments: partial }, refunds);
    expect(mg.unverifiedMonths!.size).toBe(0);
    expect(mg.collected.get('2026-02')).toBe(15000 - 4000);
    expect(() => parseRefundOverrides('"Payment ID","Refunded Amount"\n"PM1","abc"\n')).toThrow(/not an amount/);
    expect(() => parseRefundOverrides('"Payment ID","Refunded Amount"\n"","5"\n')).toThrow(/needs both/);
  });
});

describe('loading: raw rows kept, deposits credited, days follow re-exports', () => {
  // Scenarios with extra work requests run in test mode, so live keeps exactly the shared fixture
  // (the other import test reconciles live against it).
  const batchOf = async (mode: 'live' | 'sandbox' = 'live') => {
    const ctx = await systemContext('hhmc', mode);
    return { ctx, batch: <T>(fn: (s: Scope) => Promise<T>) => withScope(ctx, 'hhmc.import.run', fn) };
  };

  it('stores each exported row with its import link, and updates it when Movegistics changes a column we do not map', async () => {
    const { batch } = await batchOf();
    const first = await loadIntoHhmc(batch, normalize(fixture));
    const refOf = (type: string, sid: string) =>
      batch(async (s) => (await s.db.select().from(hhmcImportRefs).where(and(s.where(hhmcImportRefs), eq(hhmcImportRefs.sourceType, type), eq(hhmcImportRefs.sourceId, sid))))[0]);
    expect((await refOf('contact', 'CN900002')).recordId).toBe(first.ids.get('contact:CN900001'));
    expect((await refOf('contact', 'CN900002')).sourceData['Internal Note']).toBe('duplicate');
    expect((await refOf('work_order', 'WO900001')).recordId).toBe(first.ids.get('work_request:WR900001'));

    const tagged = { ...fixture, contacts: fixture.contacts.replace('"CN900001","Avery","Fixture","avery.fixture@example.com","+1 607-555-0101","","Hired  Hands","",""', '"CN900001","Avery","Fixture","avery.fixture@example.com","+1 607-555-0101","","Hired  Hands","","VIP"') };
    await loadIntoHhmc(batch, normalize(tagged));
    expect((await refOf('contact', 'CN900001')).sourceData.Tags).toBe('VIP');
    await loadIntoHhmc(batch, normalize(fixture));
    expect((await refOf('contact', 'CN900001')).sourceData.Tags).toBeUndefined();

    // The deposit shows on the invoice; the balance stays Movegistics' own ($0 on a PAID invoice).
    const inv = await batch(async (s) => (await s.db.select().from(hhmcInvoices).where(and(s.where(hhmcInvoices), eq(hhmcInvoices.id, first.ids.get('invoice:IN900001')!))))[0]);
    expect([inv.depositReceivedCents, inv.paidCents, inv.totalCents - inv.depositReceivedCents - inv.paidCents]).toEqual([16008, 64032, 0]);
  });

  it('lead fields are loaded, and a status change in Movegistics follows on re-import', async () => {
    const { batch } = await batchOf();
    const leads = fixture.leads.replace('"New","","","","03/15/2026"', '"Disqualified","","Went with another mover","03/20/2026","03/15/2026"');
    const run = await loadIntoHhmc(batch, normalize({ ...fixture, leads }));
    const dana = await batch(async (s) => (await s.db.select().from(hhmcLeads).where(and(s.where(hhmcLeads), eq(hhmcLeads.id, run.ids.get('lead:LD900002')!))))[0]);
    expect(dana).toMatchObject({ status: 'disqualified', disqualifiedReason: 'Went with another mover' });
    await loadIntoHhmc(batch, normalize(fixture));
    const back = await batch(async (s) => (await s.db.select().from(hhmcLeads).where(and(s.where(hhmcLeads), eq(hhmcLeads.id, run.ids.get('lead:LD900002')!))))[0]);
    expect(back.status).toBe('new');
  });

  it('a work order moved in Movegistics moves the booked days; once staff change a day, the import leaves the days alone', async () => {
    const { batch } = await batchOf('sandbox');
    const base: Files = {
      ...fixture,
      contacts: csv('contacts', [person('CN920001', 'Riley', 'Moved')]),
      workRequests: csv('workRequests', [workRequest('WR920001', 'Riley Moved - Work Request', 'Riley Moved')]),
      workOrders: csv('workOrders', [workOrder('WO920001', 'Riley Moved - Work Request', 'Riley Moved', '05/10/2026', '05/11/2026')]),
      estimates: csv('estimates', []), invoices: csv('invoices', []), payments: csv('payments', []), leads: csv('leads', []),
    };
    const run = await loadIntoHhmc(batch, normalize(base));
    const jobId = run.ids.get('work_request:WR920001')!;
    const daysOf = () => batch(async (s) => (await s.db.select().from(hhmcJobDays).where(and(s.where(hhmcJobDays), eq(hhmcJobDays.jobId, jobId))).orderBy(asc(hhmcJobDays.dayDate))).map((d) => d.dayDate));
    const moveDate = () => batch(async (s) => (await s.db.select().from(hhmcJobs).where(and(s.where(hhmcJobs), eq(hhmcJobs.id, jobId))))[0].moveDate);
    expect(await daysOf()).toEqual(['2026-05-10', '2026-05-11']);

    const moved = { ...base, workOrders: csv('workOrders', [workOrder('WO920001', 'Riley Moved - Work Request', 'Riley Moved', '05/15/2026', '05/15/2026')]) };
    const second = await loadIntoHhmc(batch, normalize(moved));
    expect(await daysOf()).toEqual(['2026-05-15']);
    expect(await moveDate()).toBe('2026-05-15');
    expect(second.stats.job_day.created).toBe(0); // the old day was moved, not duplicated

    // Re-running the same export changes nothing.
    const third = await loadIntoHhmc(batch, normalize(moved));
    expect(third.stats.job_day.created + third.stats.job_day.updated).toBe(0);

    // Staff change the day in SAI: later exports no longer touch the days.
    const gm = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'sandbox');
    const [day] = await batch((s) => s.db.select().from(hhmcJobDays).where(and(s.where(hhmcJobDays), eq(hhmcJobDays.jobId, jobId))));
    await withScope(gm, 'hhmc.jobs.write', (s) => updateRecord(s, jobDayEntity, day.id, { startTime: '09:00' }));
    const fourth = await loadIntoHhmc(batch, normalize(base));
    expect(fourth.stats.job_day.kept).toBe(1);
    expect(await daysOf()).toEqual(['2026-05-15']);
  });

  it('a move still to come holds a truck (an appointment) like any booking; it follows the work order and is released when lost', async () => {
    const { batch } = await batchOf('sandbox');
    const us = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
    const future = new Date(Date.now() + 400 * 86_400_000);
    const later = new Date(Date.now() + 410 * 86_400_000);
    const files = (start: Date, stage = 'Closed Won'): Files => ({
      ...fixture,
      contacts: csv('contacts', [person('CN950001', 'Toni', 'Future')]),
      workRequests: csv('workRequests', [workRequest('WR950001', 'Toni Future - Work Request', 'Toni Future', { 'Move Date': us(start), 'Pipeline Stage': stage })]),
      workOrders: csv('workOrders', [workOrder('WO950001', 'Toni Future - Work Request', 'Toni Future', us(start), us(start))]),
      estimates: csv('estimates', []), invoices: csv('invoices', []), payments: csv('payments', []), leads: csv('leads', []),
    });
    const run = await loadIntoHhmc(batch, normalize(files(future)));
    const jobId = run.ids.get('work_request:WR950001')!;
    const live = () =>
      batch(async (s) => {
        const days = await s.db.select().from(hhmcJobDays).where(and(s.where(hhmcJobDays, 'include'), eq(hhmcJobDays.jobId, jobId)));
        const appts = await s.db.select().from(appointments).where(and(s.where(appointments), inArray(appointments.subjectId, days.map((d) => d.id))));
        return appts.filter((a) => a.status !== 'canceled').map((a) => a.startsAt.toISOString().slice(0, 10));
      });
    expect(await live()).toEqual([future.toISOString().slice(0, 10)]);
    expect((await loadIntoHhmc(batch, normalize(files(future)))).stats.appointment.created).toBe(0); // re-run: nothing new
    await loadIntoHhmc(batch, normalize(files(later)));
    expect(await live()).toEqual([later.toISOString().slice(0, 10)]);
    await loadIntoHhmc(batch, normalize(files(later, 'Closed Lost')));
    expect(await live()).toEqual([]);
  });

  it('with a hand-entered partial refund, collected money reconciles to the cent', async () => {
    const { ctx, batch } = await batchOf();
    const partial = { ...fixture, payments: fixture.payments.replace('"Check","No","Blake Sample","","IN900002","CLOSED","RECORDED"', '"Check","No","Blake Sample","","IN900002","CLOSED","PARTIAL_REFUNDED"') };
    const refunds = parseRefundOverrides('"Payment ID","Refunded Amount"\n"PM900003","40"\n');
    const n = normalize(partial, { refunds });
    await loadIntoHhmc(batch, n);
    const pay = await batch(async (s) => (await s.db.select().from(payments).where(and(s.where(payments), inArray(payments.providerRef, ['movegistics:PM900003']))))[0]);
    expect(pay.refundedCents).toBe(4000);
    const report = reconciliationReport(movegisticsSide(partial, refunds), await batch((s) => ourSide(s, ctx.business.timeZone)), n.issues, {}, n.followups);
    expect(report.markdown).toMatch(/\| 2026-02 \|.*\| \$110\.00 \/ \$110\.00 \| ✅ \|/);
    expect(report.summary).toContain('All time:');
    await loadIntoHhmc(batch, normalize(fixture)); // back to the shared fixture state
  });
});

describe('"From Movegistics" on the pages', () => {
  it('the work request page shows its own, its work orders\', estimates\', invoices\' and payments\' exported rows; the lead and contact pages theirs', async () => {
    const ctx = await systemContext('hhmc', 'live');
    const run = await loadIntoHhmc(<T,>(fn: (s: Scope) => Promise<T>) => withScope(ctx, 'hhmc.import.run', fn), normalize(fixture));
    const gm = await ctxFor(USERS.hhmcAdmin, 'hhmc', 'live');
    const page = await jobPage(gm, run.ids.get('work_request:WR900001')!);
    expect(page.source.map((r) => `${r.type}:${r.sourceId}`)).toEqual(['work_request:WR900001', 'work_order:WO900001', 'estimate:ES900001', 'invoice:IN900001', 'payment:PM900001', 'payment:PM900002']);
    expect(page.source[0].data['Work Request Title']).toBe('Avery Fixture - Work Request');
    // The deposit (recorded on the estimate) is in the work request's payments too.
    expect(page.payments!.map((p) => p.providerRef).sort()).toEqual(['movegistics:PM900001', 'movegistics:PM900002']);
    expect((await leadPage(gm, run.ids.get('lead:LD900001')!)).source[0].data['Lead ID']).toBe('LD900001');
    expect((await contactPage(gm, run.ids.get('contact:CN900001')!)).source.map((r) => r.sourceId)).toEqual(['CN900001', 'CN900002']);
  });
});
