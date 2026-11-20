/**
 * HHMC's automatic emails (docs/hhmc-emails.md): every trigger fires at the right moment,
 * reschedules move the scheduled emails, cancellations stop them, and nothing ever sends twice.
 * A recording channel stands in for Amazon SES.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { withScope } from '@/core/db/scope';
import { consoleEmailChannel, setEmailChannel, type NotificationChannel } from '@/core/notifications/notifications';
import type { BusinessContext } from '@/core/tenancy/context';
import { P } from '@/modules/hhmc/permissions';
import { hhmcAutomationQueue, hhmcAutomationRules } from '@/modules/hhmc/schema';
import { enqueue, processDueAutomationsInScope } from '@/modules/hhmc/services/automations';
import { convertLead, createLead } from '@/modules/hhmc/services/leads';
import { USERS, ctxFor } from './helpers';

let counter = 0;
const tag = () => `${Date.now().toString(36)}${(counter += 1)}`;
const admin = () => ctxFor(USERS.hhmcAdmin, 'hhmc', 'live');
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

type Sent = { recipient: string; subject: string; body: string };
let sent: Sent[] = [];
const recorder: NotificationChannel = { name: 'recorder', async send(m) { sent.push(m); return { ok: true }; } };
const saved = { ...process.env };

beforeEach(() => {
  sent = [];
  setEmailChannel(recorder);
  // Everyone in these tests may receive real email (the allow-list is tested in email-channel.test.ts).
  delete process.env.EMAIL_ALLOWED_RECIPIENTS;
  delete process.env.PILOT_MODE;
});
afterEach(() => {
  setEmailChannel(consoleEmailChannel);
  for (const key of ['EMAIL_ALLOWED_RECIPIENTS', 'PILOT_MODE'])
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
});

async function newJob(ctx: BusinessContext, moveInDays = 30 + (counter % 200)) {
  const t = tag();
  const lead = await createLead(ctx, {
    firstName: 'Riley',
    lastName: `Workflow${t}`,
    email: `riley.${t}@example.com`,
    phone: `607-555-01${String(counter % 100).padStart(2, '0')}`,
    source: 'Google',
    moveDate: day(moveInDays),
    originAddress: '1 Test St, Ithaca, NY',
    destinationAddress: '2 Test St, Ithaca, NY',
  });
  const { job } = await convertLead(ctx, lead.id, { serviceType: 'local', jobType: 'Local Full Service Move', crewSize: 2, trucks: 1 });
  return { lead, job, email: `riley.${t}@example.com` };
}

async function queueOf(ctx: BusinessContext, jobId: string) {
  return withScope(ctx, P.jobsRead, (s) =>
    s.db
      .select({ q: hhmcAutomationQueue, trigger: hhmcAutomationRules.trigger, key: hhmcAutomationRules.key })
      .from(hhmcAutomationQueue)
      .innerJoin(hhmcAutomationRules, eq(hhmcAutomationRules.id, hhmcAutomationQueue.ruleId))
      .where(and(s.where(hhmcAutomationQueue), eq(hhmcAutomationQueue.jobId, jobId))),
  );
}

describe('nothing sends twice', () => {
  it('the same email for the same records is queued once, however often its event fires', async () => {
    const ctx = await admin();
    const { job, email } = await newJob(ctx);
    const first = await withScope(ctx, P.jobsWrite, (s) => enqueue(s, 'job_booked', { jobId: job.id, recipient: email, optIn: true, notBefore: new Date(Date.now() + 3_600_000) }));
    const again = await withScope(ctx, P.jobsWrite, (s) => enqueue(s, 'job_booked', { jobId: job.id, recipient: email, optIn: true, notBefore: new Date(Date.now() + 3_600_000) }));
    expect(first).toBeGreaterThan(0);
    expect(again).toBe(0);
    const rows = (await queueOf(ctx, job.id)).filter((r) => r.trigger === 'job_booked');
    expect(rows.filter((r) => r.q.status === 'queued')).toHaveLength(first);
  });

  it('two runs of the scheduler at the same moment send each due email once', async () => {
    const ctx = await admin();
    const { job, email } = await newJob(ctx);
    // A receipt is wanted whatever the job's stage, so only the double run can stop it.
    await withScope(ctx, P.jobsWrite, (s) => enqueue(s, 'payment_received', { jobId: job.id, recipient: email, optIn: true, notBefore: new Date(Date.now() + 60_000) }));
    const later = new Date(Date.now() + 2 * 3_600_000);
    await Promise.all([
      withScope(ctx, P.jobsWrite, (s) => processDueAutomationsInScope(s, later)),
      withScope(ctx, P.jobsWrite, (s) => processDueAutomationsInScope(s, later)),
    ]);
    const mine = sent.filter((m) => m.recipient === email);
    const queued = (await queueOf(ctx, job.id)).filter((r) => r.trigger === 'payment_received');
    expect(queued.length).toBeGreaterThan(0);
    expect(mine).toHaveLength(queued.filter((r) => r.q.status === 'sent').length);
    expect(queued.every((r) => r.q.status === 'sent')).toBe(true);
  });
});

/** A move booked the normal way: quote, estimate sent, signed, deposit paid, confirmed. */
async function bookedJob(ctx: BusinessContext, moveInDays: number) {
  const { job, email } = await newJob(ctx, moveInDays);
  const { hhmcCatalogItems } = await import('@/modules/hhmc/schema');
  const { addQuoteLine } = await import('@/modules/hhmc/services/quote');
  const { customerLinkFor, payDepositByLink, sendEstimate, signEstimateByLink } = await import('@/modules/hhmc/services/estimates');
  const { buildLinkContext } = await import('@/core/links/links');
  const { bookJob } = await import('@/modules/hhmc/services/booking');
  const catalog = await withScope(ctx, P.catalogRead, (s) => s.db.select().from(hhmcCatalogItems).where(s.where(hhmcCatalogItems)));
  await addQuoteLine(ctx, job.id, { section: 'transportation_labor', catalogItemId: catalog.find((c) => c.name === '2 Men')!.id, qty: '2.5' });
  const estimate = await sendEstimate(ctx, job.id);
  const customer = await buildLinkContext((await customerLinkFor(ctx, estimate.id)).split('/l/')[1]);
  await signEstimateByLink(customer, { valuationInitials: 'RW', signatureName: 'Riley Workflow', agree: true, ip: null, userAgent: null });
  await payDepositByLink(customer, { attemptKey: `t${tag()}d` });
  await bookJob(ctx, job.id, new Date(), { allowNoTruck: true });
  return { job, email };
}

describe('move reminders', () => {
  it('booking queues the reminders before the move date; rescheduling moves them; nothing is sent twice', async () => {
    const ctx = await admin();
    const { job } = await bookedJob(ctx, 20);
    const reminders = () => queueOf(ctx, job.id).then((rows) => rows.filter((r) => r.trigger === 'move_reminder'));
    const first = (await reminders()).filter((r) => r.q.status === 'queued');
    expect(first.length).toBeGreaterThan(0);
    for (const r of first) expect(r.q.dueAt.getTime()).toBeLessThan(Date.parse(`${day(20)}T23:59:59Z`));

    const { rescheduleJob } = await import('@/modules/hhmc/services/booking');
    await rescheduleJob(ctx, job.id, { date: day(25), allowNoTruck: true });
    const after = await reminders();
    expect(after.filter((r) => r.q.status === 'cancelled' && r.q.cancelledReason === 'The move was rescheduled.')).toHaveLength(first.length);
    const moved = after.filter((r) => r.q.status === 'queued');
    expect(moved).toHaveLength(first.length);
    for (const r of moved) expect(r.q.dueAt.getTime()).toBeGreaterThan(Date.parse(`${day(21)}T00:00:00Z`));

    // Due time passes: each reminder is sent once, even with two runs at once.
    const later = new Date(Date.parse(`${day(25)}T12:00:00Z`));
    await Promise.all([
      withScope(ctx, P.jobsWrite, (s) => processDueAutomationsInScope(s, later)),
      withScope(ctx, P.jobsWrite, (s) => processDueAutomationsInScope(s, later)),
    ]);
    expect((await reminders()).filter((r) => r.q.status === 'sent')).toHaveLength(first.length);
  });

  it('a reminder whose time has already passed when the move is booked is not queued', async () => {
    const ctx = await admin();
    const { job } = await bookedJob(ctx, 1);
    const rows = (await queueOf(ctx, job.id)).filter((r) => r.trigger === 'move_reminder');
    for (const r of rows) expect(r.q.dueAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe('cancelling a job stops all its scheduled emails', () => {
  it('cancels every queued email of the job, whatever its trigger', async () => {
    const ctx = await admin();
    const { job } = await bookedJob(ctx, 30);
    expect((await queueOf(ctx, job.id)).some((r) => r.q.status === 'queued')).toBe(true);
    const { cancelJob } = await import('@/modules/hhmc/services/jobs');
    await cancelJob(ctx, job.id, 'Customer changed plans', { deposit: 'kept' });
    const rows = await queueOf(ctx, job.id);
    expect(rows.filter((r) => r.q.status === 'queued')).toHaveLength(0);
    expect(rows.some((r) => r.q.cancelledReason === 'The job was cancelled.')).toBe(true);
  });
});

describe("the job's email log", () => {
  it('lists every email the job sent (estimate, signed copy, receipt, booking) with its recipient, newest first', async () => {
    const ctx = await admin();
    const { job } = await bookedJob(ctx, 40);
    const { jobPage } = await import('@/modules/hhmc/services/views');
    const page = await jobPage(ctx, job.id);
    expect(page.emailLog).not.toBeNull();
    const log = page.emailLog!;
    expect(log.length).toBeGreaterThanOrEqual(2);
    // The customer's address (the lead may have matched an existing customer).
    const email = log[0].recipient;
    expect(log.every((m) => m.recipient === email)).toBe(true);
    expect(log.map((m) => m.subject).join('|')).toMatch(/Booked/);
    expect(log.every((m) => m.adapter === 'recorder' && m.status === 'sent')).toBe(true);
    const times = log.map((m) => m.createdAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(sent.filter((m) => m.recipient === email).length).toBe(log.length);
  });
});

describe('each trigger queues its emails at the moment Movegistics sent them', () => {
  const at = (rows: { q: { dueAt: Date }; key: string }[], key: string, from: number) =>
    Math.round((rows.find((r) => r.key === key)!.q.dueAt.getTime() - from) / 60_000);

  it('estimate sent: 2 hours, then 1, 3 and 7 days', async () => {
    const ctx = await admin();
    const { job } = await newJob(ctx);
    const { hhmcCatalogItems } = await import('@/modules/hhmc/schema');
    const { addQuoteLine } = await import('@/modules/hhmc/services/quote');
    const { sendEstimate } = await import('@/modules/hhmc/services/estimates');
    const catalog = await withScope(ctx, P.catalogRead, (s) => s.db.select().from(hhmcCatalogItems).where(s.where(hhmcCatalogItems)));
    await addQuoteLine(ctx, job.id, { section: 'transportation_labor', catalogItemId: catalog.find((c) => c.name === '2 Men')!.id, qty: '3' });
    const t0 = Date.now();
    await sendEstimate(ctx, job.id);
    const rows = await queueOf(ctx, job.id);
    for (const [key, minutes] of [['drip_same_day', 120], ['drip_day2', 1440], ['drip_day3', 4320], ['drip_day7', 10080]] as const)
      expect(Math.abs(at(rows, key, t0) - minutes)).toBeLessThanOrEqual(1);
    // The estimate itself goes out at once.
    expect(sent.some((m) => /Please (Sign|Review)/.test(m.subject))).toBe(true);
  });

  it("lead couldn't be reached: at once, after 24 hours, after 2 days; converting the lead stops the rest", async () => {
    const ctx = await admin();
    const t = tag();
    const lead = await createLead(ctx, { firstName: 'Noor', lastName: `Unreached${t}`, email: `noor.${t}@example.com`, phone: `607-555-02${String(counter % 100).padStart(2, '0')}`, source: 'Google', moveDate: day(60), originAddress: '1 Test St, Ithaca, NY', destinationAddress: '2 Test St, Ithaca, NY' });
    const { startNoContactEmails } = await import('@/modules/hhmc/services/leads');
    const t0 = Date.now();
    await startNoContactEmails(ctx, lead.id);
    const rows = await withScope(ctx, P.jobsRead, (s) =>
      s.db
        .select({ q: hhmcAutomationQueue, key: hhmcAutomationRules.key })
        .from(hhmcAutomationQueue)
        .innerJoin(hhmcAutomationRules, eq(hhmcAutomationRules.id, hhmcAutomationQueue.ruleId))
        .where(and(s.where(hhmcAutomationQueue), eq(hhmcAutomationQueue.leadId, lead.id))),
    );
    expect(Math.abs(at(rows, 'lead_didnt_connect', t0) - 1440)).toBeLessThanOrEqual(1);
    expect(Math.abs(at(rows, 'lead_last_checkin', t0) - 2880)).toBeLessThanOrEqual(1);
    expect(sent.filter((m) => m.recipient === `noor.${t}@example.com`)).toHaveLength(1);
    await convertLead(ctx, lead.id, { serviceType: 'local', jobType: 'Local Full Service Move', crewSize: 2, trucks: 1 });
    const after = await withScope(ctx, P.jobsRead, (s) => s.db.select().from(hhmcAutomationQueue).where(and(s.where(hhmcAutomationQueue), eq(hhmcAutomationQueue.leadId, lead.id))));
    expect(after.filter((r) => r.status === 'queued')).toHaveLength(0);
  });
});
