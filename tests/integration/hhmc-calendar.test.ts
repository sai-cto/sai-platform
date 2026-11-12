/**
 * HHMC calendar: which records show as which kind of event (services/calendar.ts).
 * Booked move = job days of Booked/Completed/Closed jobs; Estimate = Estimate Sent jobs on their
 * move date; Work request = Qualified jobs with a move date; Invoice due = invoices not Paid or
 * Void, on their due date. Lost and cancelled jobs never appear.
 */
import { describe, expect, it } from 'vitest';
import type { BusinessContext } from '@/core/tenancy/context';
import { P } from '@/modules/hhmc/permissions';
import { bookJob } from '@/modules/hhmc/services/booking';
import {
  allowedCalendarKinds,
  calendarBetween,
  invoiceIsDue,
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
  it('maps job stages and invoice statuses to kinds', () => {
    expect(jobEventKind('qualified')).toBe('request');
    expect(jobEventKind('estimate_sent')).toBe('estimate');
    expect(jobEventKind('booked')).toBe('booked');
    expect(jobEventKind('completed')).toBe('booked');
    expect(jobEventKind('closed')).toBe('booked');
    expect(jobEventKind('lost')).toBeNull();
    expect(jobEventKind('cancelled')).toBeNull();
    expect(invoiceIsDue('draft')).toBe(true);
    expect(invoiceIsDue('sent')).toBe(true);
    expect(invoiceIsDue('partially_paid')).toBe(true);
    expect(invoiceIsDue('paid')).toBe(false);
    expect(invoiceIsDue('void')).toBe(false);
    expect([...parseCalendarKinds('estimate, invoice,nonsense')]).toEqual(['estimate', 'invoice']);
  });
});

describe('calendar: records become events', () => {
  it('a qualified job is a work request, then an estimate with its status; booked days are booked moves', async () => {
    const ctx = await admin();
    const job = await newJob(ctx);
    // Qualified with a move date: a work request, and its job day is NOT a booked move.
    expect((await eventsOf(ctx, job.id)).map((e) => [e.kind, e.date])).toEqual([['request', day(20)]]);

    const est = await sendEstimate(ctx, job.id);
    const asEstimate = await eventsOf(ctx, job.id);
    expect(asEstimate).toHaveLength(1);
    expect(asEstimate[0]).toMatchObject({ kind: 'estimate', date: day(20), estimateId: est.id, estimateStatus: 'sent' });

    const customer = await buildLinkContext((await customerLinkFor(ctx, est.id)).split('/l/')[1]);
    await signEstimateByLink(customer, { valuationInitials: 'CC', signatureName: 'Casey Calendar', agree: true, ip: null, userAgent: null });
    expect((await eventsOf(ctx, job.id))[0]).toMatchObject({ kind: 'estimate', estimateStatus: 'signed' });

    await bookJob(ctx, job.id);
    const booked = await eventsOf(ctx, job.id);
    expect(booked.map((e) => e.kind)).toEqual(['booked']);
    expect(booked[0]).toMatchObject({ date: day(20), crewSize: 2, trucks: 1 });
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

  it('an invoice is due on its due date with its balance until it is paid', async () => {
    const ctx = await admin();
    const job = await newJob(ctx);
    await signed(ctx, job.id);
    await bookJob(ctx, job.id);
    const invoice = await createInvoice(ctx, job.id);
    const draft = (await eventsOf(ctx, job.id)).filter((e) => e.kind === 'invoice');
    expect(draft).toHaveLength(1);
    expect(draft[0]).toMatchObject({ invoiceId: invoice.id, date: invoice.dueDate, invoiceStatus: 'draft' });

    await sendInvoice(ctx, invoice.id);
    const sent = (await eventsOf(ctx, job.id)).find((e) => e.kind === 'invoice');
    expect(sent).toMatchObject({ invoiceStatus: 'sent', pastDue: false });
    const balance = sent && sent.kind === 'invoice' ? sent.balanceCents : 0;
    expect(balance).toBeGreaterThan(0);

    await recordInvoicePayment(ctx, invoice.id, { amount: (balance / 100).toFixed(2), method: 'cash', attemptKey: `t${tag()}` });
    const after = await eventsOf(ctx, job.id);
    // Paid: no invoice event; the (now closed) job's day is still a booked move.
    expect(after.map((e) => e.kind)).toEqual(['booked']);
  });

  it('only kinds the person may see are loaded; hidden kinds are not loaded', async () => {
    const ctx = await admin();
    const job = await newJob(ctx);
    const noInvoices: BusinessContext = { ...ctx, permissions: new Set([...ctx.permissions].filter((p) => p !== P.invoicesRead)) };
    expect(allowedCalendarKinds(noInvoices)).toEqual(['booked', 'estimate', 'request']);
    const noJobs: BusinessContext = { ...ctx, permissions: new Set([...ctx.permissions].filter((p) => p !== P.jobsRead)) };
    expect(allowedCalendarKinds(noJobs)).toEqual(['invoice']);
    const jobEvents = (await calendarBetween(noJobs, FROM, TO)).days.flatMap((d) => d.events);
    expect(jobEvents.every((e) => e.kind === 'invoice')).toBe(true);

    const hidden = (await calendarBetween(ctx, FROM, TO, { kinds: ['booked', 'estimate'] })).days.flatMap((d) => d.events);
    expect(hidden.some((e) => e.jobId === job.id)).toBe(false);
    await expect(calendarBetween(ctx, day(0), day(100))).rejects.toThrow(/at most/);
  });
});
