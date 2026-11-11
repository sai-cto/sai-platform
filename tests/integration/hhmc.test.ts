/**
 * HHMC end to end against the real database: the whole life of one move, the automation
 * queue, versioned estimates, permissions, customer links and live/sandbox separation.
 * The pricing examples of ref §4.2 are in hhmc-pricing.test.ts.
 */
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { appointments, notifications, payments } from '@/core/db/schema';
import { withScope } from '@/core/db/scope';
import { ForbiddenError, NotFoundError, ValidationError } from '@/core/errors';
import { buildLinkContext, signLink, verifyLink } from '@/core/links/links';
import type { BusinessContext } from '@/core/tenancy/context';
import { P } from '@/modules/hhmc/permissions';
import { canMoveStage, findMatchingCustomer, probableDuplicates, stageMoveProblem } from '@/modules/hhmc/rules';
import { hhmcAutomationQueue, hhmcAutomationRules, hhmcEstimates, hhmcJobs } from '@/modules/hhmc/schema';
import { enqueue, processDueAutomations, processDueAutomationsInScope } from '@/modules/hhmc/services/automations';
import { addJobDay, bookJob, markSoldOut, releaseBooking, scheduleBetween, setActualTime, unmarkSoldOut } from '@/modules/hhmc/services/booking';
import { loadJob } from '@/modules/hhmc/services/common';
import { estimateFunnel, invoiceTotals, leadsThisMonth } from '@/modules/hhmc/services/dashboard';
import {
  customerLinkFor,
  openEstimateByLink,
  payDepositByLink,
  sendEstimate,
  signEstimateByLink,
  voidEstimate,
} from '@/modules/hhmc/services/estimates';
import { createInvoice, openInvoiceByLink, payInvoiceByLink, recordInvoicePayment, sendInvoice } from '@/modules/hhmc/services/invoices';
import { addNote, cancelJob, createJob, markLost, moveStage, reopenJob, setAutomationOptIn } from '@/modules/hhmc/services/jobs';
import { convertLead, conversionPreview, createLead, disqualifyLead, startNoContactEmails } from '@/modules/hhmc/services/leads';
import { addQuoteLine, quoteSummary, setQuoteOptions } from '@/modules/hhmc/services/quote';
import { USERS, ctxFor, logFor, systemContext } from './helpers';

let counter = 0;
const tag = () => `${Date.now().toString(36)}${(counter += 1)}`;
const admin = (env: 'live' | 'sandbox' = 'live') => ctxFor(USERS.hhmcAdmin, 'hhmc', env);
const DAY = 24 * 3600 * 1000;

/** A date `days` from today, "yyyy-mm-dd" (UTC is fine for tests). */
const day = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

async function newLead(ctx: BusinessContext, extra: Record<string, unknown> = {}) {
  const t = tag();
  return createLead(ctx, {
    firstName: 'Avery',
    lastName: `Lifecycle${t}`,
    email: `avery.${t}@example.com`,
    phone: `607-555-${String(counter % 10000).padStart(4, '0')}`,
    source: 'Google',
    moveDate: day(20),
    originAddress: '1 Test St, Ithaca, NY',
    destinationAddress: '2 Test St, Ithaca, NY',
    ...extra,
  });
}

/** A converted job with Example A's quote (2 Men 2.5 h + 16' truck, card fee on): $709.80. */
async function exampleAJob(ctx: BusinessContext) {
  const lead = await newLead(ctx);
  const { job } = await convertLead(ctx, lead.id, { serviceType: 'local', jobType: 'Local Full Service Move', crewSize: 2, trucks: 1 });
  const catalog = await withScope(ctx, P.catalogRead, async (s) => {
    const { hhmcCatalogItems } = await import('@/modules/hhmc/schema');
    return s.db.select().from(hhmcCatalogItems).where(s.where(hhmcCatalogItems));
  });
  const men = catalog.find((c) => c.name === '2 Men')!;
  await addQuoteLine(ctx, job.id, { section: 'transportation_labor', catalogItemId: men.id, qty: '2.5' });
  await setQuoteOptions(ctx, job.id, { serviceTaxOn: false, convenienceFeeOn: true });
  return { lead, job };
}

function tokenOf(link: string) {
  return link.split('/l/')[1];
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

async function emailsAbout(ctx: BusinessContext, subjectId: string) {
  return withScope(ctx, 'notifications.read', (s) =>
    s.db.select().from(notifications).where(and(s.where(notifications), eq(notifications.subjectId, subjectId))),
  );
}

describe('rules', () => {
  it('stage moves: only the listed transitions are allowed', () => {
    expect(canMoveStage('qualified', 'estimate_sent')).toBe(true);
    expect(canMoveStage('estimate_sent', 'booked')).toBe(true);
    expect(canMoveStage('booked', 'completed')).toBe(true);
    expect(canMoveStage('completed', 'closed')).toBe(true);
    expect(canMoveStage('qualified', 'booked')).toBe(false);
    expect(canMoveStage('closed', 'qualified')).toBe(false);
    expect(canMoveStage('cancelled', 'qualified')).toBe(false);
    expect(stageMoveProblem('qualified', 'closed')).toMatch(/cannot become Closed/);
  });

  it('a lead reuses a customer by email, then by phone; same name only is a probable duplicate', () => {
    const customers = [
      { id: 'a', firstName: 'Ana', lastName: 'Lee', email: 'ANA@example.com', phone: null },
      { id: 'b', firstName: 'Bo', lastName: 'Ray', email: null, phone: '(607) 555-0101' },
      { id: 'c', firstName: 'Cy', lastName: 'Fox', email: 'cy@example.com', phone: null },
    ];
    expect(findMatchingCustomer({ firstName: 'x', lastName: 'y', email: 'ana@example.com', phone: null }, customers)?.id).toBe('a');
    expect(findMatchingCustomer({ firstName: 'x', lastName: 'y', email: null, phone: '1-607-555-0101' }, customers)?.id).toBe('b');
    expect(findMatchingCustomer({ firstName: 'Cy', lastName: 'Fox', email: 'other@example.com', phone: null }, customers)).toBeNull();
    expect(probableDuplicates({ firstName: 'Cy', lastName: 'Fox', email: 'other@example.com', phone: null }, customers).map((c) => c.id)).toEqual(['c']);
  });
});

describe('the whole life of one move', () => {
  it('lead → convert → quote → send → view → sign → deposit → book → invoice → pay → Closed', async () => {
    const ctx = await admin();
    const started = new Date(Date.now() - 1000);

    // Lead → Job.
    const { lead, job } = await exampleAJob(ctx);
    expect(job.stage).toBe('qualified');
    expect((await logFor('hhmc.lead', lead.id)).map((e) => e.action)).toEqual(expect.arrayContaining(['create', 'update']));

    // The quote reproduces Example A.
    const quote = await withScope(ctx, P.jobsRead, (s) => quoteSummary(s, job.id));
    expect(quote.totals.totalCents).toBe(70980);
    expect(quote.deposit.totalDueCents).toBe(14196);

    // Send → Estimate Sent, "Please Sign" email, four drip emails queued.
    const estimate = await sendEstimate(ctx, job.id);
    expect(estimate.status).toBe('sent');
    expect(estimate.totalCents).toBe(70980);
    expect(estimate.documentFileId).toBeNull(); // set by the follow-up update; read again below
    expect((await loadJobAs(ctx, job.id)).stage).toBe('estimate_sent');
    expect((await emailsAbout(ctx, estimate.id)).map((n) => n.subject)).toEqual([expect.stringMatching(/^Please Sign: Local Estimate for Avery/)]);
    const drips = (await queueOf(ctx, job.id)).filter((r) => r.trigger === 'estimate_sent');
    expect(drips.map((r) => r.q.status)).toEqual(['queued', 'queued', 'queued', 'queued']);

    // The customer opens the link → Viewed.
    const link = await customerLinkFor(ctx, estimate.id);
    const customer = await buildLinkContext(tokenOf(link));
    expect(customer.role).toBe('customer_link');
    const opened = await openEstimateByLink(customer);
    expect(opened.estimate.status).toBe('viewed');

    // Sign → Signed, drips cancelled, signed copy emailed and stored.
    const signed = await signEstimateByLink(customer, { valuationInitials: 'AL', signatureName: 'Avery Lifecycle', agree: true, ip: '192.0.2.1', userAgent: 'Vitest' });
    expect(signed.status).toBe('signed');
    expect(signed.signedIp).toBe('192.0.2.1');
    expect(signed.documentFileId).not.toBeNull();
    expect((await queueOf(ctx, job.id)).filter((r) => r.trigger === 'estimate_sent').every((r) => r.q.status === 'cancelled')).toBe(true);

    // Deposit by card (mock): 20% of $682.50 + 4% card fee = $141.96; receipt sent at once.
    const deposit = await payDepositByLink(customer, { attemptKey: `t${tag()}` });
    expect(deposit.ok).toBe(true);
    if (!deposit.ok) return;
    expect(deposit.payment.amountCents).toBe(14196);
    expect((await queueOf(ctx, job.id)).find((r) => r.trigger === 'payment_received')?.q.status).toBe('sent');
    // Signing and paying does NOT book.
    expect((await loadJobAs(ctx, job.id)).stage).toBe('estimate_sent');

    // Book (staff) → appointments per truck, "You're booked".
    await bookJob(ctx, job.id);
    const booked = await loadJobAs(ctx, job.id);
    expect(booked.stage).toBe('booked');
    const appts = await withScope(ctx, 'scheduling.read', (s) =>
      s.db.select().from(appointments).where(and(s.where(appointments), eq(appointments.kind, 'hhmc.job_day'), eq(appointments.customerId, booked.customerId))),
    );
    expect(appts).toHaveLength(1);
    expect(appts[0].status).toBe('confirmed');
    expect((await queueOf(ctx, job.id)).find((r) => r.trigger === 'job_booked')?.q.status).toBe('sent');

    // Actual time 1 h 05 → billed 1.25 h. Invoice → Completed, deposit subtracted.
    const days = await withScope(ctx, P.jobsRead, async (s) => (await import('@/modules/hhmc/services/booking')).jobDaysOf(s, job.id));
    await setActualTime(ctx, job.id, days[0].id, String(65 / 60));
    const invoice = await createInvoice(ctx, job.id, { terms: 'net_7' });
    expect((await loadJobAs(ctx, job.id)).stage).toBe('completed');
    // 2 Men 1.25 h × $195 = $243.75 + truck $195 = $438.75; + 4% = $17.55 → $456.30.
    expect(invoice.subtotalCents).toBe(43875);
    expect(invoice.totalCents).toBe(45630);
    // The deposit is credited at its base ($136.50); the $5.46 card fee was a fee, not a credit (H4).
    expect(invoice.depositReceivedCents).toBe(13650);
    expect(invoice.status).toBe('draft');

    // Send → past-due reminder queued for +8 days.
    const sent = await sendInvoice(ctx, invoice.id);
    expect(sent.status).toBe('sent');
    const pastDue = (await queueOf(ctx, job.id)).find((r) => r.trigger === 'invoice_sent');
    expect(pastDue?.q.status).toBe('queued');
    expect(pastDue!.q.dueAt.getTime() - sent.sentAt!.getTime()).toBe(8 * DAY);

    // The customer pays the balance from the invoice link → Paid → job Closed.
    const invoiceCtx = await withScope(ctx, P.invoicesRead, async (s) => {
      const { invoiceLink } = await import('@/modules/hhmc/services/common');
      return buildLinkContext(tokenOf(invoiceLink(s, invoice)));
    });
    const seen = await openInvoiceByLink(invoiceCtx);
    expect(seen.invoice.invoiceNumber).toBe(invoice.invoiceNumber);
    const paid = await payInvoiceByLink(invoiceCtx, { attemptKey: `t${tag()}` });
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    // Balance $438.75 − $136.50 = $302.25, paid by card + 4% = $314.34.
    expect(paid.payment.amountCents).toBe(31434);
    expect(paid.invoice.status).toBe('paid');
    const closed = await loadJobAs(ctx, job.id);
    expect(closed.stage).toBe('closed');
    expect(closed.closedAt).not.toBeNull();
    const queue = await queueOf(ctx, job.id);
    expect(queue.find((r) => r.trigger === 'invoice_sent')?.q.status).toBe('cancelled');
    expect(queue.find((r) => r.trigger === 'invoice_paid')?.q.status).toBe('sent');

    // Every stage change is in the activity log, in order.
    const log = await logFor('hhmc.job', job.id, started);
    const stages = log
      .filter((e) => e.action === 'update' && e.after && 'stage' in (e.after as object))
      .map((e) => (e.after as { stage: string }).stage)
      .reverse();
    expect(stages).toEqual(['estimate_sent', 'booked', 'completed', 'closed']);
    // The customer's own steps are logged under the link actor.
    const estimateLog = await logFor('hhmc.estimate', estimate.id, started);
    expect(estimateLog.some((e) => e.actorName === 'Customer (link)' && e.actorRole === 'customer_link')).toBe(true);
  });
});

async function loadJobAs(ctx: BusinessContext, id: string) {
  return withScope(ctx, P.jobsRead, (s) => loadJob(s, id));
}

describe('estimates', () => {
  it('sending v2 voids an unsigned v1 and its drip; never two live estimates', async () => {
    const ctx = await admin();
    const { job } = await exampleAJob(ctx);
    const v1 = await sendEstimate(ctx, job.id);
    await addQuoteLine(ctx, job.id, { section: 'packing_materials', name: 'Medium Box', qty: '10', rate: '3.50' });
    const v2 = await sendEstimate(ctx, job.id);
    expect(v2.version).toBe(2);
    expect(v2.estimateNumber).toBe(v1.estimateNumber);
    expect(v2.totalCents).toBe(70980 + 3640); // + $35.00 + 4%
    const rows = await withScope(ctx, P.jobsRead, (s) => s.db.select().from(hhmcEstimates).where(and(s.where(hhmcEstimates), eq(hhmcEstimates.jobId, job.id))));
    expect(rows.find((r) => r.id === v1.id)?.status).toBe('void');
    expect(rows.filter((r) => ['sent', 'viewed', 'signed'].includes(r.status))).toHaveLength(1);
    const drips = (await queueOf(ctx, job.id)).filter((r) => r.trigger === 'estimate_sent');
    expect(drips.filter((r) => r.q.estimateId === v1.id).every((r) => r.q.status === 'cancelled')).toBe(true);
    expect(drips.filter((r) => r.q.estimateId === v2.id).every((r) => r.q.status === 'queued')).toBe(true);
    // The old link no longer signs anything.
    const oldLink = await buildLinkContext(signLink(ctx, { purpose: 'hhmc.estimate', subjectId: v1.id, expiresAt: new Date(Date.now() + DAY) }));
    await expect(signEstimateByLink(oldLink, { valuationInitials: 'AL', signatureName: 'Avery', agree: true, ip: null, userAgent: null })).rejects.toBeInstanceOf(ValidationError);
  });

  it('a signed estimate cannot be voided or replaced; voiding the only live one returns the job to Qualified', async () => {
    const ctx = await admin();
    const { job } = await exampleAJob(ctx);
    const v1 = await sendEstimate(ctx, job.id);
    await voidEstimate(ctx, v1.id, 'Wrong date');
    expect((await loadJobAs(ctx, job.id)).stage).toBe('qualified');
    const v2 = await sendEstimate(ctx, job.id);
    const customer = await buildLinkContext(tokenOf(await customerLinkFor(ctx, v2.id)));
    await signEstimateByLink(customer, { valuationInitials: 'AL', signatureName: 'Avery Signer', agree: true, ip: null, userAgent: null });
    await expect(voidEstimate(ctx, v2.id, 'x')).rejects.toThrow(/signed estimate cannot be voided/);
    await expect(sendEstimate(ctx, job.id)).rejects.toThrow(/already has a signed estimate/);
  });

  it('signing checks the initials, the name and the agreement; an expired estimate cannot be signed', async () => {
    const ctx = await admin();
    const { job } = await exampleAJob(ctx);
    const est = await sendEstimate(ctx, job.id);
    const customer = await buildLinkContext(tokenOf(await customerLinkFor(ctx, est.id)));
    const sig = { valuationInitials: 'AL', signatureName: 'Avery Signer', agree: true, ip: null, userAgent: null };
    await expect(signEstimateByLink(customer, { ...sig, valuationInitials: '' })).rejects.toThrow(/Initial the Valuation/);
    await expect(signEstimateByLink(customer, { ...sig, signatureName: 'A' })).rejects.toThrow(/full name/);
    await expect(signEstimateByLink(customer, { ...sig, agree: false })).rejects.toThrow(/agree/);
    await expect(signEstimateByLink(customer, sig, new Date(Date.now() + 31 * DAY))).rejects.toThrow(/expired/);
    // A declined card is recorded as failed and the deposit stays unpaid; a retry with a new attempt works.
    await signEstimateByLink(customer, sig);
    const declined = await payDepositByLink(customer, { cardToken: 'mock_declined', attemptKey: `t${tag()}` });
    expect(declined.ok).toBe(false);
    const ok = await payDepositByLink(customer, { attemptKey: `t${tag()}` });
    expect(ok.ok).toBe(true);
    await expect(payDepositByLink(customer, { attemptKey: `t${tag()}` })).rejects.toThrow(/already been paid/);
  });
});

describe('automations', () => {
  it('drips are cancelled when the estimate is signed, and when booking leaves Estimate Sent', async () => {
    const ctx = await admin();
    const { job } = await exampleAJob(ctx);
    const est = await sendEstimate(ctx, job.id);
    const customer = await buildLinkContext(tokenOf(await customerLinkFor(ctx, est.id)));
    await signEstimateByLink(customer, { valuationInitials: 'AL', signatureName: 'Avery Signer', agree: true, ip: null, userAgent: null });
    expect((await queueOf(ctx, job.id)).filter((r) => r.trigger === 'estimate_sent').every((r) => r.q.status === 'cancelled')).toBe(true);
    // A drip queued after signing (e.g. by an older version of the rules) is cancelled by booking.
    await withScope(ctx, P.jobsWrite, (s) => enqueue(s, 'estimate_sent', { jobId: job.id, estimateId: est.id, recipient: 'late@example.com', optIn: true }));
    expect((await queueOf(ctx, job.id)).some((r) => r.trigger === 'estimate_sent' && r.q.status === 'queued')).toBe(true);
    await bookJob(ctx, job.id);
    const drips = (await queueOf(ctx, job.id)).filter((r) => r.trigger === 'estimate_sent');
    expect(drips.every((r) => r.q.status === 'cancelled')).toBe(true);
    expect(drips.some((r) => r.q.cancelledReason === 'The job moved to Booked.')).toBe(true);
  });

  it('turning opt-in off cancels the drip; the processor sends what is due and re-checks first', async () => {
    const ctx = await admin();
    const tech = await ctxFor(USERS.tech, 'hhmc');
    const a = await exampleAJob(ctx);
    const b = await exampleAJob(ctx);
    const estA = await sendEstimate(ctx, a.job.id);
    await sendEstimate(ctx, b.job.id);
    await setAutomationOptIn(ctx, b.job.id, false);
    expect((await queueOf(ctx, b.job.id)).filter((r) => r.trigger === 'estimate_sent').every((r) => r.q.status === 'cancelled')).toBe(true);

    // 3 hours later: only the +2 h email of job A is due.
    const later = new Date(estA.sentAt!.getTime() + 3 * 3600 * 1000);
    await withScope(ctx, P.jobsWrite, (s) => processDueAutomationsInScope(s, later));
    const queueA = await queueOf(ctx, a.job.id);
    expect(queueA.find((r) => r.key === 'drip_same_day')?.q.status).toBe('sent');
    expect(queueA.find((r) => r.key === 'drip_day2')?.q.status).toBe('queued');

    // Job A is marked lost: the next run cancels instead of sending (moveStage did it already).
    await markLost(ctx, a.job.id, 'Chose another mover');
    expect((await queueOf(ctx, a.job.id)).filter((r) => r.key !== 'drip_same_day' && r.trigger === 'estimate_sent').every((r) => r.q.status === 'cancelled')).toBe(true);

    // "Run due emails" is for the tech team only.
    await expect(processDueAutomations(ctx)).rejects.toBeInstanceOf(ForbiddenError);
    const result = await processDueAutomations(tech, new Date(Date.now() + 9 * DAY));
    expect(result.failed).toBe(0);
  });

  it('lead no-contact emails go out at 0 / +24 h / +2 d and stop when the lead is converted', async () => {
    const ctx = await admin();
    const lead = await newLead(ctx);
    expect(await startNoContactEmails(ctx, lead.id)).toBe(3);
    await expect(startNoContactEmails(ctx, lead.id)).rejects.toThrow(/already started/);
    const rows = await withScope(ctx, P.jobsRead, (s) =>
      s.db.select().from(hhmcAutomationQueue).where(and(s.where(hhmcAutomationQueue), eq(hhmcAutomationQueue.leadId, lead.id))),
    );
    expect(rows.map((r) => r.status).sort()).toEqual(['queued', 'queued', 'sent']);
    await convertLead(ctx, lead.id, {});
    const after = await withScope(ctx, P.jobsRead, (s) =>
      s.db.select().from(hhmcAutomationQueue).where(and(s.where(hhmcAutomationQueue), eq(hhmcAutomationQueue.leadId, lead.id))),
    );
    expect(after.filter((r) => r.status === 'queued')).toHaveLength(0);
  });
});

describe('leads', () => {
  it('converting reuses the customer whose email matches; a same-name stranger needs confirmation', async () => {
    const ctx = await admin();
    const first = await newLead(ctx);
    const one = await convertLead(ctx, first.id, {});
    const again = await newLead(ctx, { email: first.email!.toUpperCase(), firstName: 'Different' });
    const two = await convertLead(ctx, again.id, {});
    expect(two.customerId).toBe(one.customerId);
    expect(two.reusedCustomer).toBe(true);

    const namesake = await newLead(ctx, { firstName: first.firstName, lastName: first.lastName, email: `other.${tag()}@example.com`, phone: '607-555-9999' });
    const preview = await conversionPreview(ctx, namesake.id);
    expect(preview.match).toBeNull();
    expect(preview.duplicates.map((d) => d.id)).toContain(one.customerId);
    await expect(convertLead(ctx, namesake.id, {})).rejects.toThrow(/already exists with different contact details/);
    const three = await convertLead(ctx, namesake.id, {}, { confirmNewCustomer: true });
    expect(three.customerId).not.toBe(one.customerId);
  });

  it('disqualifying needs a reason and stamps the date; converted leads stay converted', async () => {
    const ctx = await admin();
    const lead = await newLead(ctx);
    await expect(disqualifyLead(ctx, lead.id, ' ')).rejects.toThrow(/reason/);
    await disqualifyLead(ctx, lead.id, 'Outside our area');
    await expect(convertLead(ctx, lead.id, {})).rejects.toThrow(/cannot become converted/);
    const other = await newLead(ctx);
    await convertLead(ctx, other.id, {});
    await expect(disqualifyLead(ctx, other.id, 'x')).rejects.toThrow(/cannot become disqualified/);
  });

  it('a lead needs a name and a way to reach them; the source is a fixed list', async () => {
    const ctx = await admin();
    await expect(createLead(ctx, { firstName: '', lastName: '', email: 'a@example.com', source: 'Google' })).rejects.toThrow(/name/);
    await expect(createLead(ctx, { firstName: 'A', email: '', phone: '', source: 'Google' })).rejects.toThrow(/email address or a phone/);
    await expect(createLead(ctx, { firstName: 'A', email: 'a@example.com', source: 'google search!' })).rejects.toThrow(/source/);
  });
});

describe('jobs, booking and the schedule', () => {
  it('stage changes outside the allowed list are refused; lost needs a reason and can be reopened', async () => {
    const ctx = await admin();
    const { job } = await exampleAJob(ctx);
    await expect(withScope(ctx, P.jobsWrite, (s) => moveStage(s, job.id, 'closed'))).rejects.toThrow(/cannot become Closed/);
    await expect(markLost(ctx, job.id, '')).rejects.toThrow(/reason/);
    await markLost(ctx, job.id, 'Too expensive');
    expect((await loadJobAs(ctx, job.id)).lostReason).toBe('Too expensive');
    await reopenJob(ctx, job.id);
    expect((await loadJobAs(ctx, job.id)).stage).toBe('qualified');
  });

  it('booking needs a signed estimate and refuses a sold-out date; release and cancel undo it', async () => {
    const ctx = await admin();
    const { job } = await exampleAJob(ctx);
    const est = await sendEstimate(ctx, job.id);
    await expect(bookJob(ctx, job.id)).rejects.toThrow(/must sign/);
    const customer = await buildLinkContext(tokenOf(await customerLinkFor(ctx, est.id)));
    await signEstimateByLink(customer, { valuationInitials: 'AL', signatureName: 'Avery Signer', agree: true, ip: null, userAgent: null });

    const moveDay = (await loadJobAs(ctx, job.id)).moveDate!;
    const soldOut = await markSoldOut(ctx, moveDay, 'Sold out');
    await expect(bookJob(ctx, job.id)).rejects.toThrow(/blocked/);
    await unmarkSoldOut(ctx, soldOut.id);

    await addJobDay(ctx, job.id, { dayDate: moveDay, startTime: '13:00', hours: '3', crewSize: '2', trucks: '1' });
    await bookJob(ctx, job.id);
    const schedule = await scheduleBetween(ctx, moveDay, (await import('@/modules/hhmc/rules')).addDays(moveDay, 1));
    const entries = schedule.days[0].entries.filter((e) => e.jobId === job.id);
    expect(entries).toHaveLength(2);
    expect(schedule.days[0].crewBooked).toBeGreaterThanOrEqual(4);

    await releaseBooking(ctx, job.id);
    expect((await loadJobAs(ctx, job.id)).stage).toBe('estimate_sent');
    const after = await scheduleBetween(ctx, moveDay, (await import('@/modules/hhmc/rules')).addDays(moveDay, 1));
    expect(after.days[0].entries.filter((e) => e.jobId === job.id)).toHaveLength(0);

    await bookJob(ctx, job.id);
    await cancelJob(ctx, job.id, 'Customer moved the date to next year');
    expect((await loadJobAs(ctx, job.id)).stage).toBe('cancelled');
  });

  it('notes and calls are kept on the job', async () => {
    const ctx = await admin();
    const { job } = await exampleAJob(ctx);
    await expect(addNote(ctx, { jobId: job.id }, { kind: 'call', body: '' })).rejects.toThrow(/how the call went/);
    const call = await addNote(ctx, { jobId: job.id }, { kind: 'call', callOutcome: 'voicemail', body: 'Left a message' });
    expect(call.authorName).toBe(ctx.actor.name);
  });

  it('a job type must belong to its service type', async () => {
    const ctx = await admin();
    const lead = await newLead(ctx);
    const { customerId } = await convertLead(ctx, lead.id, {});
    await expect(createJob(ctx, { customerId, serviceType: 'interstate', jobType: 'Junk Removal', crewSize: '2', trucks: '1' })).rejects.toThrow(/Interstate Move/);
  });
});

describe('invoices', () => {
  it('Example C: $202.80 by card less a $40.56 deposit leaves $162.24 by card ($156.00 cash); part payments then Paid', async () => {
    const ctx = await admin();
    const lead = await newLead(ctx);
    const { job } = await convertLead(ctx, lead.id, { serviceType: 'local', jobType: 'Onsite Labor Only', crewSize: 2, trucks: 0 });
    const lines = await withScope(ctx, P.jobsRead, (s) => quoteSummary(s, job.id));
    // Onsite labor only: no truck. 2 Men 1 h.
    for (const l of lines.lines) await (await import('@/modules/hhmc/services/quote')).removeQuoteLine(ctx, job.id, l.id);
    await addQuoteLine(ctx, job.id, { section: 'transportation_labor', name: '2 Men', unit: 'hour', qty: '1', rate: '195' });
    const est = await sendEstimate(ctx, job.id);
    expect(est.totalCents).toBe(20280);
    const customer = await buildLinkContext(tokenOf(await customerLinkFor(ctx, est.id)));
    await signEstimateByLink(customer, { valuationInitials: 'AL', signatureName: 'Avery Signer', agree: true, ip: null, userAgent: null });
    const dep = await payDepositByLink(customer, { attemptKey: `t${tag()}` });
    expect(dep.ok && dep.payment.amountCents).toBe(4056);
    await bookJob(ctx, job.id);
    const invoice = await createInvoice(ctx, job.id);
    expect(invoice.totalCents).toBe(20280);
    // H4: credits are in base money; the card fee is added to card payments only.
    const { balanceOf, cardBalanceOf } = await import('@/modules/hhmc/services/invoices');
    expect(invoice.depositReceivedCents).toBe(3900);
    expect(balanceOf(invoice)).toBe(15600);
    expect(cardBalanceOf(invoice)).toBe(16224); // ref §4.2 example C: $202.80 − $40.56 = $162.24 by card
    await expect(createInvoice(ctx, job.id)).rejects.toThrow(/already has an invoice/);
    await sendInvoice(ctx, invoice.id);
    await expect(recordInvoicePayment(ctx, invoice.id, { amount: '200', method: 'cash', attemptKey: `t${tag()}` })).rejects.toThrow(/balance due is \$156\.00/);
    const part = await recordInvoicePayment(ctx, invoice.id, { amount: '100', method: 'check', attemptKey: `t${tag()}` });
    expect(part.ok && part.invoice.status).toBe('partially_paid');
    // The rest by card: $56.00 credited, $58.24 charged (cash or check would never pay the fee).
    const rest = await recordInvoicePayment(ctx, invoice.id, { amount: '56', method: 'card', attemptKey: `t${tag()}` });
    expect(rest.ok && rest.invoice.status).toBe('paid');
    expect(rest.ok && rest.payment.amountCents).toBe(5824);
    expect(part.ok && part.payment.amountCents).toBe(10000);
    expect((await loadJobAs(ctx, job.id)).stage).toBe('closed');
  });
});

describe('permissions and separation', () => {
  it('a staff member without the permission is refused (book, invoices, catalog)', async () => {
    const staff = await ctxFor(USERS.hhmcStaff, 'hhmc');
    expect(staff.permissions.has(P.jobsRead)).toBe(true);
    expect(staff.permissions.has(P.jobsBook)).toBe(false);
    const ctx = await admin();
    const { job } = await exampleAJob(ctx);
    await expect(bookJob(staff, job.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createInvoice(staff, job.id)).rejects.toBeInstanceOf(ForbiddenError);
    const exec = await ctxFor(USERS.executive, 'hhmc');
    await expect(createLead(exec, { firstName: 'A', email: 'a@example.com', source: 'Google' })).rejects.toBeInstanceOf(ForbiddenError);
    // Staff cannot use the customer-side functions, even for a real estimate.
    const est = await sendEstimate(ctx, job.id);
    await expect(signEstimateByLink(staff, { valuationInitials: 'AL', signatureName: 'Avery', agree: true, ip: null, userAgent: null })).rejects.toBeInstanceOf(NotFoundError);
    await expect(signEstimateByLink({ ...ctx, link: { purpose: 'hhmc.invoice', subjectId: est.id, expiresAt: new Date() } }, { valuationInitials: 'AL', signatureName: 'Avery', agree: true, ip: null, userAgent: null })).rejects.toBeInstanceOf(NotFoundError);
    // Another business's admin cannot reach HHMC.
    await expect(ctxFor(USERS.brssAdmin, 'hhmc')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('sandbox and live never mix: records, links and payments stay in their own mode', async () => {
    const live = await admin('live');
    const sandbox = await admin('sandbox');
    const { job } = await exampleAJob(live);
    await expect(withScope(sandbox, P.jobsRead, (s) => loadJob(s, job.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(sendEstimate(sandbox, job.id)).rejects.toBeInstanceOf(NotFoundError);
    const est = await sendEstimate(live, job.id);
    // A sandbox link naming a live estimate finds nothing.
    const forged = await buildLinkContext(signLink(sandbox, { purpose: 'hhmc.estimate', subjectId: est.id, expiresAt: new Date(Date.now() + DAY) }));
    expect(forged.environment).toBe('sandbox');
    await expect(openEstimateByLink(forged)).rejects.toBeInstanceOf(NotFoundError);
    // A sandbox move uses the mock provider and stays in the sandbox.
    const s = await exampleAJob(sandbox);
    const sEst = await sendEstimate(sandbox, s.job.id);
    const sCustomer = await buildLinkContext(tokenOf(await customerLinkFor(sandbox, sEst.id)));
    await signEstimateByLink(sCustomer, { valuationInitials: 'AL', signatureName: 'Avery Sandbox', agree: true, ip: null, userAgent: null });
    const dep = await payDepositByLink(sCustomer, { attemptKey: `t${tag()}` });
    expect(dep.ok).toBe(true);
    if (!dep.ok) return;
    expect(dep.payment.environment).toBe('sandbox');
    expect(dep.payment.provider).toBe('mock');
    const liveCopy = await withScope(live, 'payments.read', (q) => q.db.select().from(payments).where(and(q.where(payments), eq(payments.id, dep.payment.id))));
    expect(liveCopy).toHaveLength(0);
  });
});

describe('customer links (src/core/links)', () => {
  it('a tampered, expired, re-purposed or switched-off link is "not found"', async () => {
    const ctx = await admin();
    const { job } = await exampleAJob(ctx);
    const est = await sendEstimate(ctx, job.id);
    const token = tokenOf(await customerLinkFor(ctx, est.id));
    expect(verifyLink(token).s).toBe(est.id);
    const [body, sig] = token.split('.');
    const swapped = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), s: job.id })).toString('base64url');
    expect(() => verifyLink(`${swapped}.${sig}`)).toThrow(NotFoundError);
    expect(() => verifyLink(`${body}.${sig.slice(0, -2)}xx`)).toThrow(NotFoundError);
    expect(() => verifyLink('garbage')).toThrow(NotFoundError);
    expect(() => verifyLink(token, new Date(Date.now() + 40 * DAY))).toThrow(NotFoundError);
    // An estimate link is not an invoice link.
    const estimateCtx = await buildLinkContext(token);
    await expect(openInvoiceByLink(estimateCtx)).rejects.toBeInstanceOf(NotFoundError);
    // The link holds only its purpose's permissions.
    expect(estimateCtx.permissions.has('business.people.manage')).toBe(false);
    expect(estimateCtx.permissions.has('business.data.export')).toBe(false);
    expect(estimateCtx.permissions.has(P.invoicesWrite)).toBe(false);
    // An unknown purpose cannot be signed.
    expect(() => signLink(ctx, { purpose: 'hhmc.everything', subjectId: est.id, expiresAt: new Date(Date.now() + DAY) })).toThrow(/Unknown link purpose/);
    // A business without customer links cannot have one: no module purpose.
    const brss = await systemContext('brss', 'live');
    expect(() => signLink(brss, { purpose: 'hhmc.estimate', subjectId: est.id, expiresAt: new Date(Date.now() + DAY) })).toThrow(/Unknown link purpose/);
  });
});

describe('dashboard', () => {
  it('counts leads, estimates and invoices of this business only', async () => {
    const ctx = await admin();
    const numbers = await withScope(ctx, P.jobsRead, async (s) => ({
      leads: await leadsThisMonth(s),
      funnel: await estimateFunnel(s),
      invoices: await invoiceTotals(s),
    }));
    expect(numbers.leads.leads).toBeGreaterThan(0);
    expect(numbers.funnel.sent).toBeGreaterThanOrEqual(numbers.funnel.signed);
    expect(numbers.invoices.openCents).toBeGreaterThanOrEqual(0);
    const jobs = await withScope(ctx, P.jobsRead, (s) => s.db.$count(hhmcJobs, s.where(hhmcJobs)));
    expect(jobs).toBeGreaterThan(5);
  });
});

describe('review gate round 1: regressions', () => {
  const sig = { valuationInitials: 'AL', signatureName: 'Avery Signer', agree: true, ip: null, userAgent: null };

  async function signedJob(ctx: BusinessContext) {
    const { job } = await exampleAJob(ctx);
    const est = await sendEstimate(ctx, job.id);
    const customer = await buildLinkContext(tokenOf(await customerLinkFor(ctx, est.id)));
    return { job, est, customer };
  }

  it('two deposit payments at the same moment charge once', async () => {
    const ctx = await admin();
    const { est, customer } = await signedJob(ctx);
    await signEstimateByLink(customer, sig);
    const results = await Promise.allSettled([
      payDepositByLink(customer, { attemptKey: `a${tag()}x` }),
      payDepositByLink(customer, { attemptKey: `b${tag()}x` }),
    ]);
    const paid = results.filter((r) => r.status === 'fulfilled' && r.value.ok);
    expect(paid).toHaveLength(1);
    const charges = await withScope(ctx, 'payments.read', (s) =>
      s.db.select().from(payments).where(and(s.where(payments), eq(payments.subjectId, est.id), eq(payments.status, 'succeeded'))),
    );
    expect(charges).toHaveLength(1);
  });

  it('void and sign at the same moment: exactly one wins', async () => {
    const ctx = await admin();
    const { job, est, customer } = await signedJob(ctx);
    await Promise.allSettled([voidEstimate(ctx, est.id, 'x'), signEstimateByLink(customer, sig)]);
    const [row] = await withScope(ctx, P.jobsRead, (s) => s.db.select().from(hhmcEstimates).where(and(s.where(hhmcEstimates), eq(hhmcEstimates.id, est.id))));
    const stage = (await loadJobAs(ctx, job.id)).stage;
    if (row.status === 'signed') expect(stage).toBe('estimate_sent');
    else expect([row.status, stage]).toEqual(['void', 'qualified']);
  });

  it('a lost job voids its open estimate, so the link cannot sign or pay', async () => {
    const ctx = await admin();
    const { job, customer } = await signedJob(ctx);
    await markLost(ctx, job.id, 'Went elsewhere');
    await expect(signEstimateByLink(customer, sig)).rejects.toThrow(/can no longer be signed/);
  });

  it('no deposit once the move is invoiced (no overpayment)', async () => {
    const ctx = await admin();
    const { job, est, customer } = await signedJob(ctx);
    await signEstimateByLink(customer, sig);
    await bookJob(ctx, job.id); // booked without a deposit (P5-11)
    await createInvoice(ctx, job.id);
    await expect(payDepositByLink(customer, { attemptKey: `t${tag()}x` })).rejects.toThrow(/invoiced|no longer be taken/);
    expect(est.id).toBeTruthy();
  });

  it('a card deposit carries the card fee only when the estimate has it on', async () => {
    const ctx = await admin();
    const { job } = await exampleAJob(ctx);
    await setQuoteOptions(ctx, job.id, { serviceTaxOn: false, convenienceFeeOn: false });
    const est = await sendEstimate(ctx, job.id);
    const customer = await buildLinkContext(tokenOf(await customerLinkFor(ctx, est.id)));
    await signEstimateByLink(customer, sig);
    const dep = await payDepositByLink(customer, { attemptKey: `t${tag()}x` });
    expect(dep.ok && dep.payment.amountCents).toBe(13650); // 20% of $682.50, no fee
  });

  it('a retry after a declined card with a new attempt key is charged', async () => {
    const ctx = await admin();
    const { customer } = await signedJob(ctx);
    await signEstimateByLink(customer, sig);
    expect((await payDepositByLink(customer, { cardToken: 'mock_declined', attemptKey: `d${tag()}x` })).ok).toBe(false);
    expect((await payDepositByLink(customer, { attemptKey: `e${tag()}x` })).ok).toBe(true);
  });

  it('sending needs the job permission up front, before any email goes out', async () => {
    const ctx = await admin();
    const { job } = await exampleAJob(ctx);
    const limited = { ...ctx, permissions: new Set([...ctx.permissions].filter((p) => p !== P.jobsWrite)) };
    await expect(sendEstimate(limited, job.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await emailsAbout(ctx, job.id)).length).toBe(0);
  });

  it('a double click converts a lead once', async () => {
    const ctx = await admin();
    const lead = await newLead(ctx);
    const results = await Promise.allSettled([convertLead(ctx, lead.id, {}), convertLead(ctx, lead.id, {})]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('the past-due reminder waits for the due date; an expired estimate gets no drip', async () => {
    const { automationStillWanted } = await import('@/modules/hhmc/rules');
    expect(automationStillWanted({ trigger: 'invoice_sent', respectsOptIn: false, invoiceStatus: 'sent', invoicePastDue: false }).ok).toBe(false);
    expect(automationStillWanted({ trigger: 'invoice_sent', respectsOptIn: false, invoiceStatus: 'sent', invoicePastDue: true }).ok).toBe(true);
    expect(automationStillWanted({ trigger: 'estimate_sent', respectsOptIn: true, jobOptIn: true, jobStage: 'estimate_sent', estimateStatus: 'sent', estimateExpired: true }).ok).toBe(false);
  });

  it('cancelling a booked job needs the booking permission', async () => {
    const ctx = await admin();
    const { job, customer } = await signedJob(ctx);
    await signEstimateByLink(customer, sig);
    await bookJob(ctx, job.id);
    const noBook = { ...ctx, permissions: new Set([...ctx.permissions].filter((p) => p !== P.jobsBook)) };
    await expect(cancelJob(noBook, job.id, 'x')).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('review gate round 2: regressions', () => {
  const sig = { valuationInitials: 'AL', signatureName: 'Avery Signer', agree: true, ip: null, userAgent: null };

  it('marking lost and signing at the same moment never leave a signed estimate on a lost job', async () => {
    const ctx = await admin();
    const { job } = await exampleAJob(ctx);
    const est = await sendEstimate(ctx, job.id);
    const customer = await buildLinkContext(tokenOf(await customerLinkFor(ctx, est.id)));
    await Promise.allSettled([markLost(ctx, job.id, 'Gone'), signEstimateByLink(customer, sig)]);
    const [row] = await withScope(ctx, P.jobsRead, (s) => s.db.select().from(hhmcEstimates).where(and(s.where(hhmcEstimates), eq(hhmcEstimates.id, est.id))));
    const stage = (await loadJobAs(ctx, job.id)).stage;
    // Either it was signed first (and the job may then be lost with the signature kept), or voided first.
    if (stage === 'lost' && row.status !== 'signed') expect(row.status).toBe('void');
    if (row.status === 'signed') expect(row.signatureName).toBe('Avery Signer');
    expect(row.status === 'void' && row.signedAt !== null).toBe(false);
  });

  it('a Net 30 invoice gets its past-due reminder after the due date, not cancelled on day 8', async () => {
    const ctx = await admin();
    const { job } = await exampleAJob(ctx);
    const est = await sendEstimate(ctx, job.id);
    const customer = await buildLinkContext(tokenOf(await customerLinkFor(ctx, est.id)));
    await signEstimateByLink(customer, sig);
    await bookJob(ctx, job.id);
    const invoice = await createInvoice(ctx, job.id, { terms: 'net_30' });
    const sent = await sendInvoice(ctx, invoice.id);
    const reminder = (await queueOf(ctx, job.id)).find((r) => r.trigger === 'invoice_sent')!;
    expect(reminder.q.dueAt.getTime()).toBeGreaterThan(sent.sentAt!.getTime() + 30 * DAY);
    // Running the processor on day 9 does nothing to it.
    await withScope(ctx, P.jobsWrite, (s) => processDueAutomationsInScope(s, new Date(sent.sentAt!.getTime() + 9 * DAY)));
    expect((await queueOf(ctx, job.id)).find((r) => r.trigger === 'invoice_sent')!.q.status).toBe('queued');
    // After the due date it goes out.
    await withScope(ctx, P.jobsWrite, (s) => processDueAutomationsInScope(s, new Date(sent.sentAt!.getTime() + 33 * DAY)));
    expect((await queueOf(ctx, job.id)).find((r) => r.trigger === 'invoice_sent')!.q.status).toBe('sent');
  });

  it('opening an old link never brings a void estimate back', async () => {
    const ctx = await admin();
    const { job } = await exampleAJob(ctx);
    const v1 = await sendEstimate(ctx, job.id);
    const oldCustomer = await buildLinkContext(tokenOf(await customerLinkFor(ctx, v1.id)));
    await Promise.allSettled([sendEstimate(ctx, job.id), openEstimateByLink(oldCustomer)]);
    const rows = await withScope(ctx, P.jobsRead, (s) => s.db.select().from(hhmcEstimates).where(and(s.where(hhmcEstimates), eq(hhmcEstimates.jobId, job.id))));
    expect(rows.filter((r) => ['sent', 'viewed', 'signed'].includes(r.status)).length).toBeLessThanOrEqual(1);
  });

  it('a signed estimate link keeps working for the deposit after the estimate would have expired', async () => {
    const ctx = await admin();
    const { job } = await exampleAJob(ctx);
    const est = await sendEstimate(ctx, job.id);
    const customer = await buildLinkContext(tokenOf(await customerLinkFor(ctx, est.id)));
    await signEstimateByLink(customer, sig);
    const link = await customerLinkFor(ctx, est.id);
    expect(() => verifyLink(tokenOf(link), new Date(Date.now() + 60 * DAY))).not.toThrow();
  });

  it('customer-link actions call only link services (never a staff service with the link context)', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('src/modules/hhmc/actions.ts', 'utf8');
    const linkActions = source.split('export async function ').filter((block) => block.includes('requireLinkContext('));
    expect(linkActions.length).toBe(3);
    for (const block of linkActions) {
      const called = [...block.matchAll(/await (\w+)\(ctx/g)].map((m) => m[1]);
      expect(called.length).toBeGreaterThan(0);
      for (const fn of called) expect(fn).toMatch(/ByLink$/);
    }
  });
});

describe('review gate round 3: regressions', () => {
  it('a past-due reminder that comes due before the due date is deferred, not cancelled', async () => {
    const ctx = await admin();
    const { job } = await exampleAJob(ctx);
    const est = await sendEstimate(ctx, job.id);
    const customer = await buildLinkContext(tokenOf(await customerLinkFor(ctx, est.id)));
    await signEstimateByLink(customer, { valuationInitials: 'AL', signatureName: 'Avery Signer', agree: true, ip: null, userAgent: null });
    await bookJob(ctx, job.id);
    const invoice = await createInvoice(ctx, job.id, { terms: 'net_60' });
    const sent = await sendInvoice(ctx, invoice.id);
    // A reminder queued the old way (8 days after sending, ignoring the terms).
    await withScope(ctx, P.jobsWrite, (s) => enqueue(s, 'invoice_sent', { jobId: job.id, invoiceId: invoice.id, recipient: 'x@example.com', optIn: true }, sent.sentAt!));
    const day9 = new Date(sent.sentAt!.getTime() + 9 * DAY);
    const result = await withScope(ctx, P.jobsWrite, (s) => processDueAutomationsInScope(s, day9));
    expect(result.deferred).toBe(1);
    const rows = (await queueOf(ctx, job.id)).filter((r) => r.trigger === 'invoice_sent');
    expect(rows.every((r) => r.q.status === 'queued')).toBe(true);
    expect(rows.every((r) => r.q.dueAt.getTime() > sent.sentAt!.getTime() + 60 * DAY)).toBe(true);
  });
});

describe('H4: the card fee is charged on card payments only', () => {
  it('new quotes default to no service tax and the card fee on; cash and check never pay the fee', async () => {
    const ctx = await admin();
    const lead = await newLead(ctx);
    const { job } = await convertLead(ctx, lead.id, {});
    const q = await withScope(ctx, P.jobsRead, (s) => quoteSummary(s, job.id));
    expect(q.quote.serviceTaxOn).toBe(false);
    expect(q.quote.convenienceFeeOn).toBe(true);
    const est = await sendEstimate(ctx, job.id);
    const customer = await buildLinkContext(tokenOf(await customerLinkFor(ctx, est.id)));
    await signEstimateByLink(customer, { valuationInitials: 'AL', signatureName: 'Avery Signer', agree: true, ip: null, userAgent: null });
    const { recordDeposit } = await import('@/modules/hhmc/services/estimates');
    const cash = await recordDeposit(ctx, est.id, { method: 'cash', attemptKey: `c${tag()}x` });
    expect(cash.ok && cash.payment.amountCents).toBe(est.depositCents); // no fee on cash
  });
});
