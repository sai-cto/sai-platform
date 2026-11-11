/**
 * Estimates: immutable, versioned snapshots of the quote, taken when sent (ref §3.5, §10).
 * Sent → Viewed → Signed, or Void. Sending v2 voids an unsigned v1 in the same transaction, so
 * a job never has two live estimates (a unique index refuses it too).
 *
 * Staff side: send, resend, void, the customer link. Customer side (through a customer link,
 * src/core/links): view, sign (ref §7.3), pay the deposit.
 */
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { withScope, type Scope } from '@/core/db/scope';
import { takeLock } from '@/core/db/lock';
import { ForbiddenError, NotFoundError, ValidationError } from '@/core/errors';
import { saveFile } from '@/core/files/files';
import { linkFor } from '@/core/links/links';
import { sendNotification } from '@/core/notifications/notifications';
import { takePayment } from '@/core/payments/payments';
import { authorize, can } from '@/core/rbac/permissions';
import { nextRecordNumber } from '@/core/records/numbering';
import { createRecord, updateRecord } from '@/core/records/records';
import type { BusinessContext } from '@/core/tenancy/context';
import { estimateEntity } from '../entities';
import { CORE, P } from '../permissions';
import { canSignEstimate, canVoidEstimate, isLiveEstimate } from '../rules';
import { hhmcEstimates, hhmcInvoices, type EstimateSnapshot } from '../schema';
import { loadSettings } from '../settings';
import { cancelQueued, enqueue } from './automations';
import {
  estimateLink,
  loadCustomer,
  loadEstimate,
  loadJob,
  loadTemplate,
  money,
  personName,
  PURPOSE,
  renderEmail,
} from './common';
import { estimateDocument } from './document';
import { moveStage } from './jobs';
import { computeDeposit, lineTotalCents } from './pricing';
import { quoteSummary } from './quote';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Loads an estimate, takes its job's lock, then loads it again: everything that changes an
 * estimate or its deposit decides on the row as it is AFTER waiting for anyone else.
 */
async function lockedEstimate(s: Scope, estimateId: string) {
  const first = await loadEstimate(s, estimateId);
  await takeLock(s, `hhmc-estimates:${first.jobId}`);
  return loadEstimate(s, estimateId);
}

async function liveEstimates(s: Scope, jobId: string) {
  return s.db
    .select()
    .from(hhmcEstimates)
    .where(
      and(
        s.where(hhmcEstimates),
        eq(hhmcEstimates.jobId, jobId),
        inArray(hhmcEstimates.status, ['sent', 'viewed', 'signed']),
      ),
    );
}

/** Saves the estimate document through the core's files, when the person may store files. */
async function storeDocument(s: Scope, estimate: typeof hhmcEstimates.$inferSelect, label: string) {
  if (!can(s.ctx, CORE.filesWrite)) return null;
  const file = await saveFile(s, {
    filename: `${estimate.estimateNumber}-v${estimate.version}-${label}.html`,
    contentType: 'text/html; charset=utf-8',
    bytes: new TextEncoder().encode(estimateDocument(s.ctx.business.name, estimate)),
    subjectType: estimateEntity.key,
    subjectId: estimate.id,
  });
  await updateRecord(s, estimateEntity, estimate.id, { documentFileId: file.id });
  return file;
}

/**
 * Sends a new estimate version: snapshot the quote, void any unsigned live estimate, email the
 * customer "Please Sign" with their link (ref §2.1 step 4), move the job to Estimate Sent and
 * queue the drip (ref §9.2).
 */
export async function sendEstimate(ctx: BusinessContext, jobId: string, now: Date = new Date()) {
  return withScope(ctx, P.estimatesWrite, async (s) => {
    // Everything this needs, before the email goes out (ARCHITECTURE rule 7).
    authorize(ctx, CORE.notificationsWrite);
    authorize(ctx, P.jobsWrite);
    await takeLock(s, `hhmc-estimates:${jobId}`);
    const job = await loadJob(s, jobId);
    if (job.stage !== 'qualified' && job.stage !== 'estimate_sent')
      throw new ValidationError('An estimate can only be sent before the job is booked.');
    const customer = await loadCustomer(s, job.customerId);
    if (!customer.email) throw new ValidationError('The customer has no email address. Add one to send the estimate.');
    const summary = await quoteSummary(s, jobId);
    if (summary.lines.length === 0) throw new ValidationError('Add at least one line to the quote first.');
    if (summary.totals.totalCents <= 0) throw new ValidationError('The quote total must be more than zero.');

    const live = await liveEstimates(s, jobId);
    // An archived (Data tab) signed estimate still counts: what a customer signed is never replaced.
    const [signedAnywhere] = await s.db
      .select({ id: hhmcEstimates.id })
      .from(hhmcEstimates)
      .where(and(s.where(hhmcEstimates, 'include'), eq(hhmcEstimates.jobId, jobId), eq(hhmcEstimates.status, 'signed')))
      .limit(1);
    if (signedAnywhere)
      throw new ValidationError('This job already has a signed estimate. It cannot be replaced.');
    for (const old of live) {
      await updateRecord(s, estimateEntity, old.id, { status: 'void', voidedAt: now, voidReason: 'Replaced by a newer version.' });
      await cancelQueued(s, { triggers: ['estimate_sent'], estimateId: old.id }, 'Replaced by a newer version.');
    }

    const settings = await loadSettings(ctx);
    const terms = await loadTemplate(s, `terms_${job.serviceType}`);
    const valuation = await loadTemplate(s, 'valuation_basic');
    const [previous] = await s.db
      .select({ version: hhmcEstimates.version, number: hhmcEstimates.estimateNumber })
      .from(hhmcEstimates)
      .where(and(s.where(hhmcEstimates, 'include'), eq(hhmcEstimates.jobId, jobId)))
      .orderBy(desc(hhmcEstimates.version))
      .limit(1);
    const version = (previous?.version ?? 0) + 1;
    // One number per job; versions count up under it.
    const estimateNumber =
      previous?.number ?? (await nextRecordNumber(s, estimateEntity, hhmcEstimates.estimateNumber, 'E'))[0];
    const { options, totals, lines } = summary;
    const snapshot: EstimateSnapshot = {
      title: `${job.serviceType === 'local' ? 'Local' : job.serviceType === 'intrastate' ? 'Intrastate' : 'Interstate'} Estimate for ${personName(customer)}`,
      customerName: personName(customer),
      customerEmail: customer.email,
      originAddress: job.originAddress,
      destinationAddress: job.destinationAddress,
      extraStops: job.extraStops,
      moveDate: job.moveDate,
      arrivalWindow: job.arrivalWindow,
      serviceType: job.serviceType,
      jobType: job.jobType,
      crewSize: job.crewSize,
      trucks: job.trucks,
      scopeOfWork: job.scopeOfWork,
      lines: lines.map((l) => ({
        section: l.section,
        name: l.name,
        unit: l.unit,
        qtyHundredths: l.qtyHundredths,
        rateCents: l.rateCents,
        discountType: l.discountType,
        discountValue: l.discountValue,
        totalCents: lineTotalCents(l),
        description: l.description,
      })),
      sections: totals.sections,
      serviceTaxOn: options.serviceTaxOn,
      convenienceFeeOn: options.convenienceFeeOn,
      serviceTaxBp: options.serviceTaxBp,
      convenienceFeeBp: options.convenienceFeeBp,
      depositBp: options.depositBp,
      termsTitle: terms?.name ?? 'Terms & Conditions',
      termsBody: terms?.body ?? '',
      valuation: valuation?.body ?? 'Basic Coverage: $0.60 per pound per article, at no charge.',
    };
    const deposit = computeDeposit(totals, options.depositBp, { byCard: false, convenienceFeeBp: options.convenienceFeeBp });
    const estimate = await createRecord(s, estimateEntity, {
      jobId,
      estimateNumber,
      version,
      status: 'sent',
      snapshot,
      subtotalCents: totals.subtotalCents,
      serviceTaxCents: totals.serviceTaxCents,
      convenienceFeeCents: totals.convenienceFeeCents,
      totalCents: totals.totalCents,
      depositCents: deposit.depositCents,
      sentAt: now,
      expiresAt: new Date(now.getTime() + settings.estimateExpiryDays * DAY),
    });
    await storeDocument(s, estimate, 'sent');
    await emailEstimate(s, estimate, customer, 'estimate_email');
    await moveStage(s, jobId, 'estimate_sent', {}, now);
    await enqueue(s, 'estimate_sent', { jobId, estimateId: estimate.id, recipient: customer.email, optIn: job.automationOptIn }, now);
    return estimate;
  });
}

async function emailEstimate(
  s: Scope,
  estimate: typeof hhmcEstimates.$inferSelect,
  customer: Awaited<ReturnType<typeof loadCustomer>>,
  templateKey: string,
) {
  if (!customer.email) throw new ValidationError('The customer has no email address.');
  const email = await renderEmail(s, templateKey, {
    businessName: s.ctx.business.name,
    firstName: customer.firstName,
    customerName: personName(customer),
    estimateTitle: estimate.snapshot.title,
    estimateNumber: estimate.estimateNumber,
    estimateTotal: money(estimate.totalCents),
    link: estimateLink(s, estimate),
  });
  return sendNotification(s, {
    recipient: customer.email,
    subject: email.subject,
    body: email.body,
    subjectType: estimateEntity.key,
    subjectId: estimate.id,
  });
}

/** "Resend Link" (ref §3.3 right column): the same estimate, emailed again. */
export async function resendEstimate(ctx: BusinessContext, estimateId: string) {
  return withScope(ctx, P.estimatesWrite, async (s) => {
    authorize(ctx, CORE.notificationsWrite);
    const estimate = await loadEstimate(s, estimateId);
    if (estimate.status !== 'sent' && estimate.status !== 'viewed')
      throw new ValidationError('Only an estimate waiting for a signature can be resent.');
    if (estimate.expiresAt && estimate.expiresAt.getTime() <= Date.now())
      throw new ValidationError('This estimate has expired: send a new version instead.');
    const job = await loadJob(s, estimate.jobId);
    await emailEstimate(s, estimate, await loadCustomer(s, job.customerId), 'estimate_email');
  });
}

/** Voids an unsigned estimate. If none is left in force, the job goes back to Qualified. */
export async function voidEstimate(ctx: BusinessContext, estimateId: string, reason: string, now: Date = new Date()) {
  const why = reason.trim() || 'Voided by staff.';
  return withScope(ctx, P.estimatesWrite, async (s) => {
    const estimate = await lockedEstimate(s, estimateId);
    if (!canVoidEstimate(estimate.status))
      throw new ValidationError(estimate.status === 'signed' ? 'A signed estimate cannot be voided.' : 'This estimate is already void.');
    await updateRecord(s, estimateEntity, estimateId, { status: 'void', voidedAt: now, voidReason: why.slice(0, 500) });
    if (can(ctx, P.jobsWrite))
      await cancelQueued(s, { triggers: ['estimate_sent'], estimateId }, 'The estimate was voided.');
    const job = await loadJob(s, estimate.jobId);
    if (job.stage === 'estimate_sent' && (await liveEstimates(s, job.id)).length === 0) {
      authorize(ctx, P.jobsWrite);
      await moveStage(s, job.id, 'qualified', {}, now);
    }
  });
}

/** The customer's link, for "Copy link" on the Job page. */
export async function customerLinkFor(ctx: BusinessContext, estimateId: string) {
  return withScope(ctx, P.estimatesWrite, async (s) => {
    const estimate = await loadEstimate(s, estimateId);
    if (!isLiveEstimate(estimate.status)) throw new ValidationError('A void estimate has no link.');
    return estimateLink(s, estimate);
  });
}

// ---------------------------------------------------------------- customer side (link only)

/** Refuses anything but a customer link for exactly this estimate. */
function requireEstimateLink(ctx: BusinessContext, estimateId: string) {
  if (!linkFor(ctx, PURPOSE.estimate, estimateId)) throw new NotFoundError();
}

/** What the customer sees. Opening it the first time marks it Viewed (ref §2.1 step 6). */
export async function openEstimateByLink(ctx: BusinessContext, now: Date = new Date()) {
  const estimateId = ctx.link?.subjectId ?? '';
  requireEstimateLink(ctx, estimateId);
  return withScope(ctx, P.customerEstimate, async (s) => {
    let estimate = await lockedEstimate(s, estimateId);
    const expired = estimate.status !== 'signed' && estimate.expiresAt !== null && estimate.expiresAt.getTime() <= now.getTime();
    if (estimate.status === 'void') return { estimate, settings: await loadSettings(ctx), job: null, expired };
    if (estimate.status === 'sent') {
      estimate = await updateRecord(s, estimateEntity, estimateId, { status: 'viewed', viewedAt: now });
    }
    const job = await loadJob(s, estimate.jobId);
    return { estimate, settings: await loadSettings(ctx), job, expired };
  });
}

export type SignatureInput = {
  valuationInitials: string;
  signatureName: string;
  agree: boolean;
  ip: string | null;
  userAgent: string | null;
};

/** E-sign (ref §7.3 step 3): initial Valuation, typed final signature, timestamp, IP and browser. */
export async function signEstimateByLink(ctx: BusinessContext, input: SignatureInput, now: Date = new Date()) {
  const estimateId = ctx.link?.subjectId ?? '';
  requireEstimateLink(ctx, estimateId);
  const initials = input.valuationInitials.trim();
  const name = input.signatureName.trim();
  if (!/^[\p{L}.\- ]{1,6}$/u.test(initials)) throw new ValidationError('Initial the Valuation section (up to 6 letters).');
  if (name.length < 2 || name.length > 120) throw new ValidationError('Type your full name to sign.');
  if (!input.agree) throw new ValidationError('Tick the box to agree to the terms, pricing and services.');
  return withScope(ctx, P.customerEstimate, async (s) => {
    const estimate = await lockedEstimate(s, estimateId);
    const problem = canSignEstimate(estimate.status, estimate.expiresAt, now);
    if (problem) throw new ValidationError(problem);
    const jobNow = await loadJob(s, estimate.jobId);
    if (jobNow.stage !== 'estimate_sent') throw new ValidationError('This estimate can no longer be signed. Please contact us.');
    const signed = await updateRecord(s, estimateEntity, estimateId, {
      status: 'signed',
      signedAt: now,
      viewedAt: estimate.viewedAt ?? now,
      valuationInitials: initials,
      signatureName: name,
      signedIp: (input.ip ?? '').slice(0, 100) || null,
      signedUserAgent: (input.userAgent ?? '').slice(0, 500) || null,
    });
    await cancelQueued(s, { triggers: ['estimate_sent'], jobId: estimate.jobId }, 'The estimate was signed.');
    await storeDocument(s, signed, 'signed');
    const job = await loadJob(s, estimate.jobId);
    await emailEstimate(s, signed, await loadCustomer(s, job.customerId), 'estimate_signed');
    return signed;
  });
}

/** The deposit the customer pays by card: deposit % × (subtotal + tax) + card fee (ref §4.2). */
export function depositDueByCard(estimate: typeof hhmcEstimates.$inferSelect) {
  return computeDeposit(
    { subtotalCents: estimate.subtotalCents, serviceTaxCents: estimate.serviceTaxCents },
    estimate.snapshot.depositBp,
    // The fee on a card deposit follows the estimate: with the card fee off, the deposit has none
    // either (otherwise the invoice would credit back a fee it never charged; review round 1).
    { byCard: estimate.snapshot.convenienceFeeOn, convenienceFeeBp: estimate.snapshot.convenienceFeeBp },
  );
}

/** Applies a deposit payment (card through a link, or cash/check/card taken by staff). */
async function takeDeposit(
  s: Scope,
  estimate: typeof hhmcEstimates.$inferSelect,
  input: { method: 'card' | 'cash' | 'check'; cardToken?: string; attemptKey: string },
) {
  if (estimate.status !== 'signed') throw new ValidationError('The estimate must be signed before the deposit is paid.');
  if (estimate.depositPaymentId || estimate.depositPaidCents > 0) throw new ValidationError('The deposit has already been paid.');
  const job = await loadJob(s, estimate.jobId);
  if (job.stage !== 'estimate_sent' && job.stage !== 'booked')
    throw new ValidationError('A deposit can no longer be taken for this move. Please contact us.');
  const [invoice] = await s.db
    .select({ id: hhmcInvoices.id })
    .from(hhmcInvoices)
    .where(and(s.where(hhmcInvoices, 'include'), eq(hhmcInvoices.jobId, job.id), ne(hhmcInvoices.status, 'void')))
    .limit(1);
  if (invoice) throw new ValidationError('This move has been invoiced: pay the invoice instead of a deposit.');
  const due =
    input.method === 'card'
      ? depositDueByCard(estimate)
      : computeDeposit(estimate, estimate.snapshot.depositBp, { byCard: false, convenienceFeeBp: 0 });
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.attemptKey)) throw new ValidationError('Reload the page and try again.');
  const payment = await takePayment(s, {
    amountCents: due.totalDueCents,
    description: `Deposit for ${job.jobNumber} (${estimate.estimateNumber} v${estimate.version})${due.cardFeeCents ? `, incl. card fee ${money(due.cardFeeCents)}` : ''}`,
    idempotencyKey: `hhmc-deposit:${estimate.id}:${input.attemptKey}`,
    customerId: job.customerId,
    method: input.method,
    paymentMethodToken: input.cardToken,
    subjectType: estimateEntity.key,
    subjectId: estimate.id,
  });
  if (payment.status !== 'succeeded')
    return { ok: false as const, message: payment.failureReason ?? 'The payment did not go through.' };
  await updateRecord(s, estimateEntity, estimate.id, { depositPaymentId: payment.id, depositPaidCents: payment.amountCents });
  const customer = await loadCustomer(s, job.customerId);
  await enqueue(s, 'payment_received', { jobId: job.id, paymentId: payment.id, recipient: customer.email, optIn: job.automationOptIn });
  return { ok: true as const, payment };
}

/** Pay Deposit on the customer's confirmation step (ref §7.3 step 4). */
export async function payDepositByLink(ctx: BusinessContext, input: { cardToken?: string; attemptKey: string }) {
  const estimateId = ctx.link?.subjectId ?? '';
  requireEstimateLink(ctx, estimateId);
  return withScope(ctx, P.customerEstimate, async (s) => {
    const estimate = await lockedEstimate(s, estimateId);
    return takeDeposit(s, estimate, { method: 'card', cardToken: input.cardToken, attemptKey: input.attemptKey });
  });
}

/** Staff record a deposit taken another way (Receive Payment, ref §7.2). */
export async function recordDeposit(
  ctx: BusinessContext,
  estimateId: string,
  input: { method: 'card' | 'cash' | 'check'; cardToken?: string; attemptKey: string },
) {
  if (ctx.link) throw new ForbiddenError(P.jobsWrite);
  return withScope(ctx, P.jobsWrite, async (s) => {
    // Everything the flow needs, before the card is charged (ARCHITECTURE rule 7).
    authorize(ctx, CORE.paymentsWrite);
    authorize(ctx, P.estimatesWrite);
    const estimate = await lockedEstimate(s, estimateId);
    return takeDeposit(s, estimate, input);
  });
}


