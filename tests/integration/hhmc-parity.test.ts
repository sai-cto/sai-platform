/**
 * Office workflows that must work exactly as in Movegistics: booking when no truck is free,
 * rescheduling a booked move, the move date that never drifts from the booked days, cancelling
 * with a deposit, and the dashboard on imported Movegistics data. Fake data only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { appointments } from '@/core/db/schema';
import { withScope, type Scope } from '@/core/db/scope';
import { hhmcInvoices, hhmcJobDays, hhmcJobs, hhmcNotes } from '@/modules/hhmc/schema';
import { P } from '@/modules/hhmc/permissions';
import { addJobDay, bookJob, markSoldOut, rescheduleJob } from '@/modules/hhmc/services/booking';
import { loadJob, trucksOf } from '@/modules/hhmc/services/common';
import { dashboardSummary } from '@/modules/hhmc/services/dashboard';
import { recordDeposit } from '@/modules/hhmc/services/estimates';
import { cancelJob, updateJob } from '@/modules/hhmc/services/jobs';
import { loadIntoHhmc } from '../../scripts/hhmc-import/load';
import { FILE_NAMES, normalize, type Files } from '../../scripts/hhmc-import/movegistics';
import { ourSide } from '../../scripts/hhmc-import/reconcile';
import { systemContext } from './helpers';
import { bookedJob, dayFromNow, gm, newJob, signedJob, tag } from './hhmc-helpers';

const job = (ctx: Awaited<ReturnType<typeof gm>>, id: string) => withScope(ctx, P.jobsRead, (s) => loadJob(s, id));
const daysOf = (ctx: Awaited<ReturnType<typeof gm>>, jobId: string) =>
  withScope(ctx, P.jobsRead, (s) => s.db.select().from(hhmcJobDays).where(and(s.where(hhmcJobDays), eq(hhmcJobDays.jobId, jobId))).orderBy(hhmcJobDays.dayDate));
const appointmentsOf = (ctx: Awaited<ReturnType<typeof gm>>, dayIds: string[]) =>
  withScope(ctx, 'scheduling.read', (s) => s.db.select().from(appointments).where(and(s.where(appointments), inArray(appointments.subjectId, dayIds))));

/** The details form as the job page sends it (everything the job already has). */
const detailsOf = (j: typeof hhmcJobs.$inferSelect, change: Record<string, unknown> = {}) => ({
  originAddress: j.originAddress, destinationAddress: j.destinationAddress, extraStops: j.extraStops, moveDate: j.moveDate, tentative: j.tentative,
  arrivalWindow: j.arrivalWindow, serviceType: j.serviceType, jobType: j.jobType, bedrooms: j.bedrooms, crewSize: j.crewSize, trucks: j.trucks,
  customerComments: j.customerComments, scopeOfWork: j.scopeOfWork, internalNotes: j.internalNotes, ...change,
});

describe('booking when no truck is free (OPS-4)', () => {
  it('a day that needs a truck and finds none is refused; "book without a truck" books it with no truck yet', async () => {
    const ctx = await gm();
    const date = dayFromNow(1200 + Math.floor(Math.random() * 300));
    // One move per active truck takes the whole fleet (other test files add trucks to this
    // business, so its size is read, never assumed).
    const fleet = await withScope(ctx, P.jobsRead, (s) => trucksOf(s));
    expect(fleet.length).toBeGreaterThan(0);
    for (let i = 0; i < fleet.length; i++) await bookedJob(ctx, date);
    const { job: fourth } = await signedJob(ctx, date);
    await expect(bookJob(ctx, fourth.id)).rejects.toThrow(/No truck is free on .* book it without a truck for now/);
    expect((await job(ctx, fourth.id)).stage).toBe('estimate_sent'); // nothing changed
    await bookJob(ctx, fourth.id, new Date(), { allowNoTruck: true });
    const [day] = await daysOf(ctx, fourth.id);
    const [appt] = await appointmentsOf(ctx, [day.id]);
    expect(appt.resourceId).toBeNull();
    expect(appt.notes).toContain('no truck yet');
  });
});

describe('reschedule a booked move (OPS-2) and the move date (OPS-MD)', () => {
  it('moves every day by the same amount, re-books the trucks, updates the move date and leaves a note', async () => {
    const ctx = await gm();
    const first = dayFromNow(1600 + Math.floor(Math.random() * 300));
    const second = new Date(Date.parse(`${first}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const { job: j } = await bookedJob(ctx, first, [second]);
    const before = await daysOf(ctx, j.id);
    expect(before.map((d) => d.dayDate)).toEqual([first, second]);
    const target = new Date(Date.parse(`${first}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    await rescheduleJob(ctx, j.id, { date: target, startTime: '09:30', reason: 'Customer asked' });
    const after = await daysOf(ctx, j.id);
    expect(after.map((d) => [d.dayDate, d.startTime])).toEqual([[target, '09:30'], [new Date(Date.parse(`${target}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10), '09:30']]);
    expect((await job(ctx, j.id)).moveDate).toBe(target);
    const appts = await appointmentsOf(ctx, after.map((d) => d.id));
    expect(appts.filter((a) => a.status === 'confirmed')).toHaveLength(2);
    expect(appts.filter((a) => a.status === 'canceled')).toHaveLength(2);
    const notes = await withScope(ctx, P.jobsRead, (s) => s.db.select().from(hhmcNotes).where(and(s.where(hhmcNotes), eq(hhmcNotes.jobId, j.id))));
    expect(notes.some((n) => n.body.startsWith(`Rescheduled from ${first} 08:00`) && n.body.includes('Reason: Customer asked'))).toBe(true);
  });

  it('a sold-out new date is refused and nothing changes; only booked moves, never into the past', async () => {
    const ctx = await gm();
    const date = dayFromNow(2000 + Math.floor(Math.random() * 300));
    const { job: j } = await bookedJob(ctx, date);
    const soldOut = new Date(Date.parse(`${date}T12:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
    await markSoldOut(ctx, soldOut, 'Full');
    await expect(rescheduleJob(ctx, j.id, { date: soldOut })).rejects.toThrow();
    expect((await daysOf(ctx, j.id)).map((d) => d.dayDate)).toEqual([date]);
    expect((await job(ctx, j.id)).moveDate).toBe(date);
    const [appt] = await appointmentsOf(ctx, (await daysOf(ctx, j.id)).map((d) => d.id));
    expect(appt.status).toBe('confirmed');
    await expect(rescheduleJob(ctx, j.id, { date: dayFromNow(-2) })).rejects.toThrow(/past/);
    await expect(rescheduleJob(ctx, j.id, { date })).rejects.toThrow(/already has/);
    const unbooked = await newJob(ctx);
    await expect(rescheduleJob(ctx, unbooked.id, { date })).rejects.toThrow(/Only a booked move/);
  });

  it('a booked move date cannot be changed by editing details; an unbooked one moves its day with it', async () => {
    const ctx = await gm();
    const { job: booked } = await bookedJob(ctx);
    const b = await job(ctx, booked.id);
    await expect(updateJob(ctx, b.id, detailsOf(b, { moveDate: dayFromNow(5) }))).rejects.toThrow(/use "Reschedule"/);
    await updateJob(ctx, b.id, detailsOf(b, { internalNotes: 'Gate code 1234' })); // other changes are fine
    expect((await job(ctx, b.id)).internalNotes).toBe('Gate code 1234');

    const open = await newJob(ctx);
    const o = await job(ctx, open.id);
    expect((await daysOf(ctx, o.id)).map((d) => d.dayDate)).toEqual([o.moveDate]);
    const later = dayFromNow(2400 + Math.floor(Math.random() * 100));
    await updateJob(ctx, o.id, detailsOf(o, { moveDate: later }));
    expect((await daysOf(ctx, o.id)).map((d) => d.dayDate)).toEqual([later]);
    // Booking makes the first day the move date, whatever was typed before.
    const extra = dayFromNow(2600 + Math.floor(Math.random() * 100));
    await addJobDay(ctx, o.id, { dayDate: extra, startTime: '08:00', hours: '4', crewSize: '2', trucks: '1' });
    expect((await daysOf(ctx, o.id)).map((d) => d.dayDate)).toEqual([later, extra].sort());
  });
});

describe('cancel (OPS-3)', () => {
  it('with a deposit paid, cancelling says what happens to it; no refund is taken by the software', async () => {
    const ctx = await gm();
    const { job: j, estimate } = await signedJob(ctx);
    await recordDeposit(ctx, estimate.id, { method: 'check', reference: '3301', attemptKey: `d${tag()}` });
    await bookJob(ctx, j.id);
    await expect(cancelJob(ctx, j.id, 'Moving next year instead')).rejects.toThrow(/deposit of \$[\d,.]+ was paid/);
    await expect(cancelJob(ctx, j.id, '  ', { deposit: 'kept' })).rejects.toThrow(/reason/);
    await cancelJob(ctx, j.id, 'Moving next year instead', { deposit: 'refund' });
    const after = await job(ctx, j.id);
    expect(after.stage).toBe('cancelled');
    expect(after.cancelledReason).toMatch(/^Moving next year instead · Deposit \$[\d,.]+: to be refunded outside the software$/);
    const [day] = await daysOf(ctx, j.id);
    expect((await appointmentsOf(ctx, [day.id])).every((a) => a.status === 'canceled')).toBe(true);
  });

  it('without a deposit, a reason is enough', async () => {
    const ctx = await gm();
    const j = await newJob(ctx);
    await cancelJob(ctx, j.id, 'Changed their mind');
    expect((await job(ctx, j.id)).cancelledReason).toBe('Changed their mind');
  });
});

describe('dashboard on imported Movegistics data (DASH-1)', () => {
  it('invoiced and collected per month equal the reconciliation; booked moves count without a signed estimate', async () => {
    const dir = path.resolve(__dirname, '../fixtures/movegistics');
    const files = Object.fromEntries(Object.entries(FILE_NAMES).map(([k, f]) => [k, fs.readFileSync(path.join(dir, f), 'utf8')])) as Files;
    const system = await systemContext('hhmc', 'live');
    const batch = <T,>(fn: (s: Scope) => Promise<T>) => withScope(system, 'hhmc.import.run', fn);
    const run = await loadIntoHhmc(batch, normalize(files));
    const ctx = await gm();
    // Only imported records live in these months (everything else in the test database is near today).
    const range = { from: '2026-01-01', to: '2026-02-28' };
    const others = await withScope(ctx, P.invoicesRead, (s) =>
      s.db.select({ id: hhmcInvoices.id }).from(hhmcInvoices).where(and(s.where(hhmcInvoices), inArray(hhmcInvoices.invoiceNumber, ['IN900001', 'IN900002']))),
    );
    expect(others).toHaveLength(2);
    const summary = await withScope(ctx, P.jobsRead, (s) => dashboardSummary(s, range));
    const ours = await batch((s) => ourSide(s, system.business.timeZone));
    for (const m of summary.byMonth) {
      expect(m.invoicedCents).toBe(ours.invoiced.get(m.month) ?? 0);
      expect(m.collectedCents).toBe(ours.collected.get(m.month) ?? 0);
    }
    expect(summary.invoicedCents).toBe(80040 + 25000);
    expect(summary.collectedCents).toBe(16008 + 64032 + 15000);
    // WR900001 was booked in Movegistics when its work order was made (01/09/2026), estimate signed.
    expect(summary.booked.count).toBeGreaterThanOrEqual(1);
    const wr = run.ids.get('work_request:WR900001')!;
    expect((await job(ctx, wr)).bookedAt!.toISOString().slice(0, 10)).toBe('2026-01-09');
  });
});
