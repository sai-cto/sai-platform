/**
 * HHMC calendar (services/calendar.ts): ONLY confirmed moves (managers' feedback round 1).
 * A job day shows once its job is Confirmed (signed, deposit paid, booked) and stays once the
 * move is done. Requests, estimates, signed-but-unpaid estimates and invoices never show;
 * converting a lead never puts a move on the calendar. Lost and cancelled jobs never appear.
 */
import { describe, expect, it } from 'vitest';
import type { BusinessContext } from '@/core/tenancy/context';
import { P } from '@/modules/hhmc/permissions';
import { bookJob, unconfirmMovesWithoutDeposit } from '@/modules/hhmc/services/booking';
import { withScope } from '@/core/db/scope';
import { loadJob } from '@/modules/hhmc/services/common';
import { updateRecord } from '@/core/records/records';
import { estimateEntity } from '@/modules/hhmc/entities';
import {
  allowedCalendarKinds,
  calendarBetween,
  jobEventKind,
  parseCalendarKinds,
  type CalendarEvent,
} from '@/modules/hhmc/services/calendar';
import { customerLinkFor, payDepositByLink, sendEstimate, signEstimateByLink } from '@/modules/hhmc/services/estimates';
import { createInvoice, recordInvoicePayment, sendInvoice } from '@/modules/hhmc/services/invoices';
import { cancelJob, markLost } from '@/modules/hhmc/services/jobs';
import { convertLead, createLead } from '@/modules/hhmc/services/leads';
import { addQuoteLine } from '@/modules/hhmc/services/quote';
import { buildLinkContext } from '@/core/links/links';
import { USERS, ctxFor } from './helpers';

let counter = 0;
const tag = () => `${Date.now().toString(36)}c${(counter += 1)}`;
const admin = () => ctxFor(USERS.hhmcAdmin, 'hhmc', 'live');
const DAY = 24 * 3600 * 1000;
const day = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
// Covers the move dates (day 20) and an invoice due today in the business's time zone.
const FROM = day(-2);
const TO = day(40);

async function newJob(ctx: BusinessContext) {
  const t = tag();
  const lead = await createLead(ctx, {
    firstName: 'Casey',
    lastName: `Calendar${t}`,
    email: `casey.${t}@example.com`,
    source: 'Google',
    moveDate: day(20),
    originAddress: '1 Test St, Ithaca, NY',
    destinationAddress: '2 Test St, Ithaca, NY',
  });
  const { job } = await convertLead(ctx, lead.id, { serviceType: 'local', jobType: 'Local Full Service Move', crewSize: 2, trucks: 1 });
  await addQuoteLine(ctx, job.id, { section: 'transportation_labor', name: '2 Men', unit: 'hour', qty: '2', rate: '195' });
  return job;
}

async function signed(ctx: BusinessContext, jobId: string) {
  const est = await sendEstimate(ctx, jobId);
  const customer = await buildLinkContext((await customerLinkFor(ctx, est.id)).split('/l/')[1]);
  await signEstimateByLink(customer, { valuationInitials: 'CC', signatureName: 'Casey Calendar', agree: true, ip: null, userAgent: null });
  await payDepositByLink(customer, { attemptKey: `t${tag()}` });
  return est;
}

async function eventsOf(ctx: BusinessContext, jobId: string): Promise<CalendarEvent[]> {
  const { days } = await calendarBetween(ctx, FROM, TO);
  return days.flatMap((d) => d.events).filter((e) => e.jobId === jobId);
}

describe('calendar: rules', () => {
  it('only confirmed (and done) moves are on the calendar', () => {
    expect(jobEventKind('qualified')).toBeNull();
    expect(jobEventKind('estimate_sent')).toBeNull();
    expect(jobEventKind('booked')).toBe('booked');
    expect(jobEventKind('completed')).toBe('booked');
    expect(jobEventKind('closed')).toBe('booked');
    expect(jobEventKind('lost')).toBeNull();
    expect(jobEventKind('cancelled')).toBeNull();
    expect([...parseCalendarKinds('booked, estimate,invoice,nonsense')]).toEqual(['booked']);
  });
});

describe('calendar: confirmed moves only', () => {
  it('a converted lead, a sent estimate and a signed estimate are not on the calendar; a confirmed move is', async () => {
    const ctx = await admin();
    const job = await newJob(ctx);
    // Converting a lead (a request with a move date and a job day) does not put it on the calendar.
    expect(await eventsOf(ctx, job.id)).toEqual([]);

    const est = await sendEstimate(ctx, job.id);
    expect(await eventsOf(ctx, job.id)).toEqual([]);

    const customer = await buildLinkContext((await customerLinkFor(ctx, est.id)).split('/l/')[1]);
    await signEstimateByLink(customer, { valuationInitials: 'CC', signatureName: 'Casey Calendar', agree: true, ip: null, userAgent: null });
    expect(await eventsOf(ctx, job.id)).toEqual([]);
    // Signed but the deposit is not paid: it cannot be confirmed yet.
    await expect(bookJob(ctx, job.id)).rejects.toThrow(/deposit .* must be paid/);
    expect((await withScope(ctx, P.jobsRead, (s) => loadJob(s, job.id))).stage).toBe('estimate_sent');

    await payDepositByLink(customer, { attemptKey: `t${tag()}` });
    await bookJob(ctx, job.id);
    const booked = await eventsOf(ctx, job.id);
    expect(booked.map((e) => e.kind)).toEqual(['booked']);
    expect(booked[0]).toMatchObject({ date: day(20), crewSize: 2, trucks: 1, stage: 'booked' });
  });

  it('existing booked moves without a paid deposit leave the calendar; nothing is deleted', async () => {
    const ctx = await admin();
    const job = await newJob(ctx);
    const est = await signed(ctx, job.id);
    await bookJob(ctx, job.id);
    // An old booking made before the rule, with no deposit on record (as some imported moves are).
    await withScope(ctx, P.jobsWrite, (s) => updateRecord(s, estimateEntity, est.id, { depositPaidCents: 0 }));
    const [paid] = await withScope(ctx, P.jobsRead, async (s) => {
      const { payments } = await import('@/core/db/schema/tenant');
      const { and, eq } = await import('drizzle-orm');
      return s.db.select().from(payments).where(and(s.where(payments), eq(payments.subjectId, est.id)));
    });
    await withScope(ctx, 'payments.write', async (s) => {
      const { paymentEntity } = await import('@/core/records/core-entities');
      await updateRecord(s, paymentEntity, paid.id, { refundedCents: paid.amountCents });
    });
    expect((await eventsOf(ctx, job.id)).map((e) => e.kind)).toEqual(['booked']);

    const listed = await withScope(ctx, P.jobsBook, (s) => unconfirmMovesWithoutDeposit(s, { apply: false }));
    expect(listed.map((j) => j.id)).toContain(job.id);
    expect((await withScope(ctx, P.jobsRead, (s) => loadJob(s, job.id))).stage).toBe('booked'); // a dry run changes nothing

    await withScope(ctx, P.jobsBook, (s) => unconfirmMovesWithoutDeposit(s, { apply: true }));
    const after = await withScope(ctx, P.jobsRead, (s) => loadJob(s, job.id));
    expect(after.stage).toBe('estimate_sent');
    expect(await eventsOf(ctx, job.id)).toEqual([]);
  });

  it('cancelled and lost jobs are left out', async () => {
    const ctx = await admin();
    const lost = await newJob(ctx);
    await markLost(ctx, lost.id, 'Chose another mover');
    expect(await eventsOf(ctx, lost.id)).toEqual([]);

    const cancelled = await newJob(ctx);
    await signed(ctx, cancelled.id);
    await bookJob(ctx, cancelled.id);
    expect((await eventsOf(ctx, cancelled.id)).map((e) => e.kind)).toEqual(['booked']);
    await cancelJob(ctx, cancelled.id, 'Customer moved the date to next year', { deposit: 'kept' });
    expect(await eventsOf(ctx, cancelled.id)).toEqual([]);
  });

  it('invoices are not on the calendar; a paid-up (closed) move stays on it', async () => {
    const ctx = await admin();
    const job = await newJob(ctx);
    await signed(ctx, job.id);
    await bookJob(ctx, job.id);
    const invoice = await createInvoice(ctx, job.id);
    await sendInvoice(ctx, invoice.id);
    expect((await eventsOf(ctx, job.id)).map((e) => e.kind)).toEqual(['booked']);
    const { balanceOf } = await import('@/modules/hhmc/services/invoices');
    const { hhmcInvoices } = await import('@/modules/hhmc/schema');
    const { eq } = await import('drizzle-orm');
    const [row] = await withScope(ctx, P.invoicesRead, (s) => s.db.select().from(hhmcInvoices).where(eq(hhmcInvoices.id, invoice.id)));
    await recordInvoicePayment(ctx, invoice.id, { amount: (balanceOf(row) / 100).toFixed(2), method: 'cash', attemptKey: `t${tag()}` });
    expect((await withScope(ctx, P.jobsRead, (s) => loadJob(s, job.id))).stage).toBe('closed');
    expect((await eventsOf(ctx, job.id)).map((e) => e.kind)).toEqual(['booked']);
  });

  it('only people who may see jobs see the calendar', async () => {
    const ctx = await admin();
    expect(allowedCalendarKinds(ctx)).toEqual(['booked']);
    const noJobs: BusinessContext = { ...ctx, permissions: new Set([...ctx.permissions].filter((p) => p !== P.jobsRead)) };
    expect(allowedCalendarKinds(noJobs)).toEqual([]);
    expect((await calendarBetween(noJobs, FROM, TO)).days.flatMap((d) => d.events)).toEqual([]);
    await expect(calendarBetween(ctx, day(0), day(100))).rejects.toThrow(/at most/);
  });
});
