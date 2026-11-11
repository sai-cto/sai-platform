/**
 * Invoices (ref §7.1): built from the signed estimate plus the actual hours, less the deposit
 * received (including its card fee). Draft → Sent → Partially Paid → Paid, or Void.
 * Paying in full closes the job and sends "How did your move go?" (ref §9.2).
 */
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { customers } from '@/core/db/schema/tenant';
import { withScope, type Scope } from '@/core/db/scope';
import { takeLock } from '@/core/db/lock';
import { NotFoundError, ValidationError } from '@/core/errors';
import { isUuid } from '@/core/ids';
import { linkFor } from '@/core/links/links';
import { sendNotification } from '@/core/notifications/notifications';
import { takePayment } from '@/core/payments/payments';
import { authorize } from '@/core/rbac/permissions';
import { nextRecordNumber } from '@/core/records/numbering';
import { archiveRecord, createRecord, updateRecord } from '@/core/records/records';
import type { BusinessContext } from '@/core/tenancy/context';
import { invoiceEntity, invoiceLineEntity } from '../entities';
import { CORE, P } from '../permissions';
import { addDays, dueDateFor, invoiceStatusAfterPayment, isDateText, localDate, localTime } from '../rules';
import {
  hhmcEstimates,
  hhmcInvoiceLines,
  hhmcInvoices,
  hhmcJobs,
  INVOICE_TERMS,
  type InvoiceStatus,
} from '../schema';
import { loadSettings } from '../settings';
import { cancelQueued, enqueue } from './automations';
import {
  invoiceLink,
  loadCustomer,
  loadInvoice,
  loadJob,
  money,
  personName,
  PURPOSE,
  renderEmail,
} from './common';
import { jobDaysOf } from './booking';
import { moveStage } from './jobs';
import { balanceDueCents, computeTotals, minutesToQtyHundredths, parseMoney, parseQty, SECTION_KEYS } from './pricing';

export const INVOICES_PAGE_SIZE = 25;

export async function invoiceLines(s: Scope, invoiceId: string) {
  return s.db
    .select()
    .from(hhmcInvoiceLines)
    .where(and(s.where(hhmcInvoiceLines), eq(hhmcInvoiceLines.invoiceId, invoiceId)))
    .orderBy(asc(hhmcInvoiceLines.sortOrder), asc(hhmcInvoiceLines.createdAt));
}

export function balanceOf(invoice: Pick<typeof hhmcInvoices.$inferSelect, 'totalCents' | 'depositReceivedCents' | 'paidCents'>) {
  return balanceDueCents(invoice.totalCents, invoice.depositReceivedCents, invoice.paidCents);
}

/** Re-prices a draft invoice from its lines and options. */
async function recalculate(s: Scope, invoice: typeof hhmcInvoices.$inferSelect) {
  const lines = await invoiceLines(s, invoice.id);
  const totals = computeTotals(lines, {
    serviceTaxOn: invoice.serviceTaxOn,
    convenienceFeeOn: invoice.convenienceFeeOn,
    serviceTaxBp: invoice.serviceTaxBp,
    convenienceFeeBp: invoice.convenienceFeeBp,
  });
  return updateRecord(s, invoiceEntity, invoice.id, {
    subtotalCents: totals.subtotalCents,
    serviceTaxCents: totals.serviceTaxCents,
    convenienceFeeCents: totals.convenienceFeeCents,
    totalCents: totals.totalCents,
  });
}

/**
 * Creates the invoice for a booked job (ref §2.1 step 12): the signed estimate's lines, with
 * the hourly Transportation Labor replaced by the actual hours when they were entered (rounded
 * up to the billing step), less the deposit received. The job becomes Completed.
 */
export async function createInvoice(
  ctx: BusinessContext,
  jobId: string,
  raw: { terms?: string } = {},
  now: Date = new Date(),
) {
  const terms = (INVOICE_TERMS as readonly string[]).includes(raw.terms ?? '') ? (raw.terms as (typeof INVOICE_TERMS)[number]) : 'due_on_receipt';
  return withScope(ctx, P.invoicesWrite, async (s) => {
    authorize(ctx, P.jobsWrite);
    // The estimate lock too, so a deposit cannot land while the invoice is being made.
    await takeLock(s, `hhmc-estimates:${jobId}`);
    await takeLock(s, `hhmc-invoice:${jobId}`);
    const job = await loadJob(s, jobId);
    if (job.stage !== 'booked' && job.stage !== 'completed')
      throw new ValidationError('An invoice is created once the job is booked.');
    const open = await s.db
      .select({ id: hhmcInvoices.id })
      .from(hhmcInvoices)
      // Archived (Data tab) invoices still count: an archive must not let a job be billed twice.
      .where(and(s.where(hhmcInvoices, 'include'), eq(hhmcInvoices.jobId, jobId), ne(hhmcInvoices.status, 'void')))
      .limit(1);
    if (open.length > 0) throw new ValidationError('This job already has an invoice. Void it first to start again.');
    const [estimate] = await s.db
      .select()
      .from(hhmcEstimates)
      .where(and(s.where(hhmcEstimates, 'include'), eq(hhmcEstimates.jobId, jobId), eq(hhmcEstimates.status, 'signed')))
      .limit(1);
    if (!estimate) throw new ValidationError('The job has no signed estimate.');
    const settings = await loadSettings(ctx);
    const days = await jobDaysOf(s, jobId);
    const actualMinutes = days.reduce((sum, d) => sum + (d.actualMinutes ?? 0), 0);
    const anyActual = days.some((d) => d.actualMinutes !== null);

    let lines = estimate.snapshot.lines.map((l) => ({ ...l }));
    if (anyActual) {
      const hourly = lines.filter((l) => l.section === 'transportation_labor' && l.unit === 'hour');
      if (hourly.length > 0) {
        const first = hourly[0];
        lines = lines.filter((l) => !hourly.includes(l));
        lines.unshift({ ...first, qtyHundredths: minutesToQtyHundredths(actualMinutes, settings.roundingMinutes), description: 'Actual time' });
      }
    }
    const invoiceDate = localDate(now, ctx.business.timeZone);
    const [invoiceNumber] = await nextRecordNumber(s, invoiceEntity, hhmcInvoices.invoiceNumber, 'I');
    const invoice = await createRecord(s, invoiceEntity, {
      invoiceNumber,
      jobId,
      estimateId: estimate.id,
      customerId: job.customerId,
      status: 'draft',
      terms,
      invoiceDate,
      dueDate: dueDateFor(invoiceDate, terms),
      poNumber: job.poNumber,
      serviceTaxOn: estimate.snapshot.serviceTaxOn,
      convenienceFeeOn: estimate.snapshot.convenienceFeeOn,
      serviceTaxBp: estimate.snapshot.serviceTaxBp,
      convenienceFeeBp: estimate.snapshot.convenienceFeeBp,
      depositReceivedCents: estimate.depositPaidCents,
    });
    for (const [i, l] of lines.entries()) {
      await createRecord(s, invoiceLineEntity, {
        invoiceId: invoice.id,
        section: l.section,
        name: l.name,
        unit: l.unit,
        qtyHundredths: l.qtyHundredths,
        rateCents: l.rateCents,
        discountType: l.discountType,
        discountValue: l.discountValue,
        serviceDate: days[0]?.dayDate ?? job.moveDate,
        sortOrder: i,
      });
    }
    const priced = await recalculate(s, invoice);
    if (job.stage === 'booked') await moveStage(s, jobId, 'completed', {}, now);
    return priced;
  });
}

async function draftInvoice(s: Scope, invoiceId: string) {
  const invoice = await loadInvoice(s, invoiceId);
  if (invoice.status !== 'draft') throw new ValidationError('Only a draft invoice can be changed.');
  return invoice;
}

const lineInput = z.object({
  section: z.enum(SECTION_KEYS as [string, ...string[]], { message: 'Choose a section' }),
  name: z.string().trim().min(1, 'Enter the item').max(200),
  unit: z.string().trim().max(20).default('each'),
  qty: z.string().trim(),
  rate: z.string().trim(),
});

export async function addInvoiceLine(ctx: BusinessContext, invoiceId: string, raw: unknown) {
  const parsed = lineInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  const qty = parseQty(parsed.data.qty);
  const rate = parseMoney(parsed.data.rate);
  if (qty === null) throw new ValidationError('Enter the quantity as a number.');
  if (rate === null) throw new ValidationError('Enter the rate in dollars.');
  return withScope(ctx, P.invoicesWrite, async (s) => {
    const invoice = await draftInvoice(s, invoiceId);
    const existing = await invoiceLines(s, invoiceId);
    await createRecord(s, invoiceLineEntity, {
      invoiceId,
      section: parsed.data.section as (typeof SECTION_KEYS)[number],
      name: parsed.data.name,
      unit: parsed.data.unit || 'each',
      qtyHundredths: qty,
      rateCents: rate,
      sortOrder: existing.length,
    });
    return recalculate(s, invoice);
  });
}

export async function removeInvoiceLine(ctx: BusinessContext, invoiceId: string, lineId: string) {
  return withScope(ctx, P.invoicesWrite, async (s) => {
    const invoice = await draftInvoice(s, invoiceId);
    if (!(await invoiceLines(s, invoiceId)).some((l) => l.id === lineId)) throw new NotFoundError();
    await archiveRecord(s, invoiceLineEntity, lineId);
    return recalculate(s, invoice);
  });
}

export async function updateInvoiceOptions(
  ctx: BusinessContext,
  invoiceId: string,
  input: { terms: string; serviceTaxOn: boolean; convenienceFeeOn: boolean; invoiceDate?: string; remarks?: string },
) {
  if (!(INVOICE_TERMS as readonly string[]).includes(input.terms)) throw new ValidationError('Choose the terms.');
  if (input.invoiceDate && !isDateText(input.invoiceDate)) throw new ValidationError('Enter the invoice date as a date.');
  return withScope(ctx, P.invoicesWrite, async (s) => {
    const invoice = await draftInvoice(s, invoiceId);
    const terms = input.terms as (typeof INVOICE_TERMS)[number];
    const invoiceDate = input.invoiceDate || invoice.invoiceDate;
    const updated = await updateRecord(s, invoiceEntity, invoiceId, {
      terms,
      invoiceDate,
      dueDate: dueDateFor(invoiceDate, terms),
      serviceTaxOn: input.serviceTaxOn,
      convenienceFeeOn: input.convenienceFeeOn,
      remarks: input.remarks?.trim().slice(0, 2000) || null,
    });
    return recalculate(s, updated);
  });
}

/** Sends the invoice with its payment link; the past-due reminder is queued (ref §9.2). */
export async function sendInvoice(ctx: BusinessContext, invoiceId: string, now: Date = new Date()) {
  return withScope(ctx, P.invoicesWrite, async (s) => {
    // Everything this needs, before the email goes out (ARCHITECTURE rule 7).
    authorize(ctx, CORE.notificationsWrite);
    authorize(ctx, P.jobsWrite);
    await takeLock(s, `hhmc-invoice-pay:${invoiceId}`);
    const invoice = await loadInvoice(s, invoiceId);
    if (invoice.status !== 'draft' && invoice.status !== 'sent' && invoice.status !== 'partially_paid')
      throw new ValidationError('This invoice cannot be sent.');
    const job = await loadJob(s, invoice.jobId);
    const customer = await loadCustomer(s, invoice.customerId);
    if (!customer.email) throw new ValidationError('The customer has no email address.');
    const balance = balanceOf(invoice);
    const first = invoice.status === 'draft';
    const status: InvoiceStatus = first ? (balance <= 0 ? 'paid' : 'sent') : invoice.status;
    const updated = await updateRecord(s, invoiceEntity, invoiceId, {
      status,
      sentAt: invoice.sentAt ?? now,
      paidAt: status === 'paid' ? now : undefined,
    });
    const email = await renderEmail(s, 'invoice_email', {
      businessName: ctx.business.name,
      firstName: customer.firstName,
      customerName: personName(customer),
      invoiceNumber: invoice.invoiceNumber,
      invoiceTotal: money(invoice.totalCents),
      balanceDue: money(Math.max(balance, 0)),
      dueDate: invoice.dueDate,
      link: balance > 0 ? invoiceLink(s, invoice, now) : '',
    });
    await sendNotification(s, { recipient: customer.email, subject: email.subject, body: email.body, subjectType: invoiceEntity.key, subjectId: invoiceId });
    if (first && status === 'sent') {
      // Never before the day after the due date (a Net 30 invoice is not past due on day 8).
      const notBefore = localTime(addDays(invoice.dueDate, 1), '09:00', ctx.business.timeZone);
      await enqueue(s, 'invoice_sent', { jobId: job.id, invoiceId, recipient: customer.email, optIn: job.automationOptIn, notBefore }, now);
    }
    if (status === 'paid') await afterPaidInFull(s, updated, now);
    return updated;
  });
}

async function afterPaidInFull(s: Scope, invoice: typeof hhmcInvoices.$inferSelect, now: Date) {
  await cancelQueued(s, { triggers: ['invoice_sent'], invoiceId: invoice.id }, 'The invoice was paid.');
  const job = await loadJob(s, invoice.jobId);
  const customer = await loadCustomer(s, invoice.customerId);
  await enqueue(s, 'invoice_paid', { jobId: job.id, invoiceId: invoice.id, recipient: customer.email, optIn: job.automationOptIn }, now);
  if (job.stage === 'completed') await moveStage(s, job.id, 'closed', {}, now);
}

async function applyPayment(
  s: Scope,
  invoice: typeof hhmcInvoices.$inferSelect,
  input: { amountCents: number; method: 'card' | 'cash' | 'check'; cardToken?: string; attemptKey: string },
  now: Date,
) {
  if (invoice.status !== 'sent' && invoice.status !== 'partially_paid')
    throw new ValidationError(invoice.status === 'paid' ? 'This invoice is already paid.' : 'This invoice is not open for payment.');
  const balance = balanceOf(invoice);
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new ValidationError('Enter an amount more than zero.');
  if (input.amountCents > balance) throw new ValidationError(`The balance due is ${money(balance)}; the payment cannot be more.`);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.attemptKey)) throw new ValidationError('Reload the page and try again.');
  const job = await loadJob(s, invoice.jobId);
  const payment = await takePayment(s, {
    amountCents: input.amountCents,
    description: `Payment on ${invoice.invoiceNumber} (${job.jobNumber})`,
    idempotencyKey: `hhmc-invoice:${invoice.id}:${input.attemptKey}`,
    customerId: invoice.customerId,
    method: input.method,
    paymentMethodToken: input.cardToken,
    subjectType: invoiceEntity.key,
    subjectId: invoice.id,
  });
  if (payment.status !== 'succeeded')
    return { ok: false as const, message: payment.failureReason ?? 'The payment did not go through.' };
  const paidCents = invoice.paidCents + payment.amountCents;
  const status = invoiceStatusAfterPayment(balanceDueCents(invoice.totalCents, invoice.depositReceivedCents, paidCents), true);
  const updated = await updateRecord(s, invoiceEntity, invoice.id, { paidCents, status, paidAt: status === 'paid' ? now : null });
  const customer = await loadCustomer(s, invoice.customerId);
  await enqueue(s, 'payment_received', { jobId: job.id, invoiceId: invoice.id, paymentId: payment.id, recipient: customer.email, optIn: job.automationOptIn }, now);
  if (status === 'paid') await afterPaidInFull(s, updated, now);
  return { ok: true as const, payment, invoice: updated };
}

/** Receive Payment (ref §7.2), by staff: card, cash or check. */
export async function recordInvoicePayment(
  ctx: BusinessContext,
  invoiceId: string,
  input: { amount: string; method: 'card' | 'cash' | 'check'; cardToken?: string; attemptKey: string },
  now: Date = new Date(),
) {
  const amountCents = parseMoney(input.amount);
  if (amountCents === null) throw new ValidationError('Enter the amount in dollars.');
  if (!['card', 'cash', 'check'].includes(input.method)) throw new ValidationError('Choose how it was paid.');
  return withScope(ctx, P.invoicesWrite, async (s) => {
    authorize(ctx, CORE.paymentsWrite);
    authorize(ctx, P.jobsWrite);
    await takeLock(s, `hhmc-invoice-pay:${invoiceId}`);
    const invoice = await loadInvoice(s, invoiceId);
    return applyPayment(s, invoice, { ...input, amountCents }, now);
  });
}

/** The customer pays the balance from the emailed link (no account). */
export async function payInvoiceByLink(ctx: BusinessContext, input: { cardToken?: string; attemptKey: string }, now: Date = new Date()) {
  const invoiceId = ctx.link?.subjectId ?? '';
  if (!linkFor(ctx, PURPOSE.invoice, invoiceId)) throw new NotFoundError();
  return withScope(ctx, P.customerInvoice, async (s) => {
    await takeLock(s, `hhmc-invoice-pay:${invoiceId}`);
    const invoice = await loadInvoice(s, invoiceId);
    return applyPayment(s, invoice, { amountCents: balanceOf(invoice), method: 'card', cardToken: input.cardToken, attemptKey: input.attemptKey }, now);
  });
}

/** What the customer sees on their invoice link. */
export async function openInvoiceByLink(ctx: BusinessContext) {
  const invoiceId = ctx.link?.subjectId ?? '';
  if (!linkFor(ctx, PURPOSE.invoice, invoiceId)) throw new NotFoundError();
  return withScope(ctx, P.customerInvoice, async (s) => {
    const invoice = await loadInvoice(s, invoiceId);
    if (invoice.status === 'draft') throw new NotFoundError();
    return { invoice, lines: await invoiceLines(s, invoiceId) };
  });
}

export async function voidInvoice(ctx: BusinessContext, invoiceId: string, now: Date = new Date()) {
  return withScope(ctx, P.invoicesWrite, async (s) => {
    await takeLock(s, `hhmc-invoice-pay:${invoiceId}`);
    const invoice = await loadInvoice(s, invoiceId);
    if (invoice.status === 'void') throw new ValidationError('This invoice is already void.');
    if (invoice.paidCents > 0 || invoice.status === 'paid')
      throw new ValidationError('An invoice with payments cannot be voided. Refund the payments first.');
    await updateRecord(s, invoiceEntity, invoiceId, { status: 'void', voidedAt: now });
    await cancelQueued(s, { triggers: ['invoice_sent'], invoiceId }, 'The invoice was voided.');
  });
}

// ---------------------------------------------------------------- list

export type InvoiceFilters = { status?: InvoiceStatus | 'open' | 'past_due' | 'all'; page?: number };

export async function listInvoices(ctx: BusinessContext, filters: InvoiceFilters = {}, now: Date = new Date()) {
  return withScope(ctx, P.invoicesRead, async (s) => {
    const status = filters.status ?? 'open';
    const today = localDate(now, ctx.business.timeZone);
    const open = inArray(hhmcInvoices.status, ['sent', 'partially_paid']);
    const where = and(
      s.where(hhmcInvoices),
      status === 'all'
        ? undefined
        : status === 'open'
          ? inArray(hhmcInvoices.status, ['draft', 'sent', 'partially_paid'])
          : status === 'past_due'
            ? and(open, sql`${hhmcInvoices.dueDate} < ${today}`)
            : eq(hhmcInvoices.status, status),
    );
    const page = Math.max(1, filters.page ?? 1);
    const rows = await s.db
      .select({ invoice: hhmcInvoices, job: hhmcJobs, customer: customers })
      .from(hhmcInvoices)
      .innerJoin(hhmcJobs, eq(hhmcJobs.id, hhmcInvoices.jobId))
      .innerJoin(customers, eq(customers.id, hhmcInvoices.customerId))
      .where(where)
      .orderBy(desc(hhmcInvoices.invoiceDate), desc(hhmcInvoices.createdAt))
      .limit(INVOICES_PAGE_SIZE)
      .offset((page - 1) * INVOICES_PAGE_SIZE);
    return { rows, total: await s.db.$count(hhmcInvoices, where), page, today };
  });
}

export async function invoicesOfJob(s: Scope, jobId: string) {
  if (!isUuid(jobId)) return [];
  return s.db
    .select()
    .from(hhmcInvoices)
    .where(and(s.where(hhmcInvoices), eq(hhmcInvoices.jobId, jobId)))
    .orderBy(asc(hhmcInvoices.createdAt));
}
