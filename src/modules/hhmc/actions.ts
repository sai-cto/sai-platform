'use server';

/**
 * HHMC server actions: what the portal's forms and buttons call.
 *
 * Staff actions build the context from the signed-in session (requireStaffPortalContext);
 * customer actions build it from the link token in the URL (requireLinkContext). Nothing the
 * browser sends is trusted: every check is in the services.
 */
import { isPaymentMethod } from './services/manual-payment';
import { uploadTermsPdf } from './services/terms-pdf';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ValidationError } from '@/core/errors';
import type { BusinessContext } from '@/core/tenancy/context';
import { act, text } from '@/server/actions';
import { parseMode, requireLinkContext, requireStaffPortalContext } from '@/server/session';
import type { ActionResult } from '@/ui/action-form';
import { processDueAutomations, updateRule } from './services/automations';
import {
  addJobDay,
  addTruck,
  bookJob,
  rescheduleJob,
  markSoldOut,
  releaseBooking,
  removeJobDay,
  setActualTime,
  unmarkSoldOut,
} from './services/booking';
import {
  customerLinkFor,
  payDepositByLink,
  recordDeposit,
  resendEstimate,
  sendEstimate,
  signEstimateByLink,
  voidEstimate,
} from './services/estimates';
import {
  addInvoiceLine,
  createInvoice,
  invoiceLinkFor,
  payInvoiceByLink,
  recordInvoicePayment,
  removeInvoiceLine,
  sendInvoice,
  updateInvoiceOptions,
  voidInvoice,
} from './services/invoices';
import {
  addNote,
  cancelJob,
  createJob,
  markLost,
  reopenJob,
  setAutomationOptIn,
  updateJob,
} from './services/jobs';
import {
  convertLead,
  createLead,
  disqualifyLead,
  reopenLead,
  startNoContactEmails,
  updateLead,
} from './services/leads';
import {
  addQuoteLine,
  applyDiscountToQuote,
  removeQuoteLine,
  setQuoteOptions,
  updateQuoteLine,
} from './services/quote';
import { applyBuilder, lookupMileage, refreshMileage, setMileageByHand } from './services/builder';
import { createCatalogItem, updateCatalogItem, updateTemplate } from './services/settings';

type Form = ActionResult | null;

function run(slug: string, mode: string, fn: (ctx: BusinessContext) => Promise<string | void>): Promise<ActionResult> {
  return act(async () => fn(await requireStaffPortalContext(slug, parseMode(mode))));
}

const ticked = (form: FormData, name: string) => form.get(name) === 'on';
const all = (form: FormData, name: string) =>
  form.getAll(name).filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
const portalPath = (ctx: BusinessContext) => `/console/${ctx.business.slug}/${ctx.environment}/app`;

// ---------------------------------------------------------------- leads

function leadFields(form: FormData) {
  return {
    firstName: text(form, 'firstName'),
    lastName: text(form, 'lastName'),
    email: text(form, 'email'),
    phone: text(form, 'phone'),
    source: text(form, 'source'),
    sourceDetail: text(form, 'sourceDetail'),
    moveDate: text(form, 'moveDate'),
    moveType: text(form, 'moveType') || 'residential',
    storage: ticked(form, 'storage'),
    bedrooms: text(form, 'bedrooms'),
    originAddress: text(form, 'originAddress'),
    destinationAddress: text(form, 'destinationAddress'),
    ownerName: text(form, 'ownerName'),
    rating: text(form, 'rating') || null,
    customerNote: text(form, 'customerNote'),
    internalNote: text(form, 'internalNote'),
    utmSource: text(form, 'utmSource'),
    utmMedium: text(form, 'utmMedium'),
    utmCampaign: text(form, 'utmCampaign'),
    gclid: text(form, 'gclid'),
    fbclid: text(form, 'fbclid'),
  };
}

export async function createLeadAction(slug: string, mode: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    const lead = await createLead(ctx, leadFields(form));
    redirect(`${portalPath(ctx)}/leads/${lead.id}`);
  });
}

export async function updateLeadAction(slug: string, mode: string, id: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await updateLead(ctx, id, leadFields(form));
    return 'Saved.';
  });
}

export async function disqualifyLeadAction(slug: string, mode: string, id: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await disqualifyLead(ctx, id, text(form, 'reason'));
    return 'Disqualified.';
  });
}

export async function reopenLeadAction(slug: string, mode: string, id: string) {
  return run(slug, mode, (ctx) => reopenLead(ctx, id));
}

export async function noContactAction(slug: string, mode: string, id: string) {
  return run(slug, mode, async (ctx) => {
    const n = await startNoContactEmails(ctx, id);
    return `${n} emails queued.`;
  });
}

export async function convertLeadAction(slug: string, mode: string, id: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    const { job } = await convertLead(
      ctx,
      id,
      {
        serviceType: text(form, 'serviceType') || 'auto',
        jobType: text(form, 'jobType') || undefined,
        crewSize: text(form, 'crewSize') || 2,
        trucks: text(form, 'trucks') || 1,
        truckIds: all(form, 'truckIds'),
      },
      { confirmNewCustomer: ticked(form, 'confirmNewCustomer') },
    );
    await autoMileage(ctx, job.id);
    redirect(`${portalPath(ctx)}/jobs/${job.id}`);
  });
}

export async function addLeadNoteAction(slug: string, mode: string, leadId: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await addNote(ctx, { leadId }, { kind: text(form, 'kind') || 'note', callOutcome: text(form, 'callOutcome') || null, body: text(form, 'body') });
    return 'Saved.';
  });
}

// ---------------------------------------------------------------- jobs

/** After a work request is created or changed: fill an empty mileage from Google Maps (when a
 *  key is set). Best effort: the work request is already saved, so a maps problem never fails it. */
async function autoMileage(ctx: BusinessContext, jobId: string) {
  const result = await refreshMileage(ctx, jobId).catch(() => null);
  return result?.status ?? 'failed';
}

function jobFields(form: FormData) {
  return {
    companyName: text(form, 'companyName'),
    poNumber: text(form, 'poNumber'),
    originAddress: text(form, 'originAddress'),
    destinationAddress: text(form, 'destinationAddress'),
    extraStops: all(form, 'extraStops').flatMap((v) => v.split('\n')).map((v) => v.trim()).filter(Boolean),
    moveDate: text(form, 'moveDate'),
    tentative: ticked(form, 'tentative'),
    arrivalWindow: text(form, 'arrivalWindow'),
    serviceType: text(form, 'serviceType') || 'auto',
    jobType: text(form, 'jobType'),
    bedrooms: text(form, 'bedrooms'),
    crewSize: text(form, 'crewSize'),
    trucks: text(form, 'trucks'),
    truckIds: all(form, 'truckIds'),
    customerComments: text(form, 'customerComments'),
    scopeOfWork: text(form, 'scopeOfWork'),
    internalNotes: text(form, 'internalNotes'),
    ownerName: text(form, 'ownerName'),
    coordinators: text(form, 'coordinators').split(',').map((v) => v.trim()).filter(Boolean),
    rating: text(form, 'rating') || null,
    source: text(form, 'source') || 'Other',
    sourceDetail: text(form, 'sourceDetail'),
  };
}

export async function createJobAction(slug: string, mode: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    const job = await createJob(ctx, { ...jobFields(form), customerId: text(form, 'customerId') });
    await autoMileage(ctx, job.id);
    redirect(`${portalPath(ctx)}/jobs/${job.id}`);
  });
}

export async function updateJobAction(slug: string, mode: string, id: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await updateJob(ctx, id, jobFields(form));
    const mileage = await autoMileage(ctx, id);
    return mileage === 'updated' ? 'Saved. Mileage looked up from Google Maps.' : 'Saved.';
  });
}

export async function optInAction(slug: string, mode: string, id: string, on: boolean) {
  return run(slug, mode, (ctx) => setAutomationOptIn(ctx, id, on));
}

export async function markLostAction(slug: string, mode: string, id: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await markLost(ctx, id, text(form, 'reason'));
    return 'Marked lost.';
  });
}

export async function cancelJobAction(slug: string, mode: string, id: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    const deposit = text(form, 'deposit');
    await cancelJob(ctx, id, text(form, 'reason'), { deposit: deposit === 'kept' || deposit === 'refund' ? deposit : undefined });
    return 'Cancelled.';
  });
}

export async function reopenJobAction(slug: string, mode: string, id: string) {
  return run(slug, mode, async (ctx) => {
    await reopenJob(ctx, id);
  });
}

export async function addJobNoteAction(slug: string, mode: string, jobId: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await addNote(ctx, { jobId }, { kind: text(form, 'kind') || 'note', callOutcome: text(form, 'callOutcome') || null, body: text(form, 'body') });
    return text(form, 'kind') === 'call' ? 'Call logged.' : 'Note added.';
  });
}

// ---------------------------------------------------------------- quote

function lineFields(form: FormData) {
  return {
    section: text(form, 'section'),
    catalogItemId: text(form, 'catalogItemId'),
    name: text(form, 'name'),
    unit: text(form, 'unit'),
    qty: text(form, 'qty'),
    rate: text(form, 'rate'),
    discountType: text(form, 'discountType'),
    discount: text(form, 'discount'),
    description: text(form, 'description'),
  };
}

/** The estimate builder form (pages/estimate-builder.tsx). Materials are "m:<catalog id>" fields. */
export async function buildQuoteAction(slug: string, mode: string, jobId: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    const materials: Record<string, string> = {};
    for (const [key, value] of form.entries()) if (key.startsWith('m:') && typeof value === 'string') materials[key.slice(2)] = value;
    const result = await applyBuilder(ctx, jobId, {
      crewSize: text(form, 'crewSize'),
      hoursMode: text(form, 'hoursMode') || 'split',
      totalHours: text(form, 'totalHours'),
      loadHours: text(form, 'loadHours'),
      driveHours: text(form, 'driveHours'),
      unloadHours: text(form, 'unloadHours'),
      cornellian: ticked(form, 'cornellian'),
      ownTruck: ticked(form, 'ownTruck'),
      truckSize: text(form, 'truckSize') || '16',
      truckCount: text(form, 'truckCount') || '1',
      usePickedTrucks: ticked(form, 'usePickedTrucks'),
      truckDays: text(form, 'truckDays'),
      miles: text(form, 'miles'),
      driveMinutes: text(form, 'driveMinutes'),
      packingHours: text(form, 'packingHours'),
      valuation: ticked(form, 'valuation'),
      replace: ticked(form, 'replace'),
      materials,
      originAccess: all(form, 'originAccess'),
      destinationAccess: all(form, 'destinationAccess'),
      originNotes: text(form, 'originNotes'),
      destinationNotes: text(form, 'destinationNotes'),
    });
    const kind = result.truckPricing === 'long_distance' ? 'long-distance truck pricing' : result.truckPricing === 'local' ? 'local truck pricing' : 'labor only (customer\'s truck)';
    return [`Added ${result.lines.length} line${result.lines.length === 1 ? '' : 's'} with ${kind}.`, ...result.warnings].join(' ');
  });
}

export async function setMileageAction(slug: string, mode: string, jobId: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    const r = await setMileageByHand(ctx, jobId, { miles: text(form, 'miles') ?? '', driveMinutes: text(form, 'driveMinutes') ?? '' });
    return `Miles set to ${(r.distanceTenths / 10).toFixed(1)} and logged on the work request.`;
  });
}

export async function lookupMileageAction(slug: string, mode: string, jobId: string) {
  return run(slug, mode, async (ctx) => {
    const route = await lookupMileage(ctx, jobId);
    return `${(route.distanceTenths / 10).toFixed(1)} miles, about ${route.driveMinutes} minutes' drive.`;
  });
}

export async function addQuoteLineAction(slug: string, mode: string, jobId: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await addQuoteLine(ctx, jobId, lineFields(form));
    return 'Line added.';
  });
}

export async function updateQuoteLineAction(slug: string, mode: string, jobId: string, lineId: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await updateQuoteLine(ctx, jobId, lineId, lineFields(form));
    return 'Saved.';
  });
}

export async function removeQuoteLineAction(slug: string, mode: string, jobId: string, lineId: string) {
  return run(slug, mode, (ctx) => removeQuoteLine(ctx, jobId, lineId));
}

export async function quoteOptionsAction(slug: string, mode: string, jobId: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await setQuoteOptions(ctx, jobId, { serviceTaxOn: ticked(form, 'serviceTaxOn'), convenienceFeeOn: ticked(form, 'convenienceFeeOn') });
    return 'Saved.';
  });
}

export async function quoteDiscountAction(slug: string, mode: string, jobId: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    const name = await applyDiscountToQuote(ctx, jobId, text(form, 'discountId'));
    return `${name} applied to every line.`;
  });
}

// ---------------------------------------------------------------- estimates and booking

export async function sendEstimateAction(slug: string, mode: string, jobId: string) {
  return run(slug, mode, async (ctx) => {
    const e = await sendEstimate(ctx, jobId);
    return `Sent ${e.estimateNumber} v${e.version}.`;
  });
}

export async function resendEstimateAction(slug: string, mode: string, estimateId: string) {
  return run(slug, mode, async (ctx) => {
    await resendEstimate(ctx, estimateId);
    return 'Sent again.';
  });
}

export async function voidEstimateAction(slug: string, mode: string, estimateId: string) {
  return run(slug, mode, (ctx) => voidEstimate(ctx, estimateId, 'Voided by staff.'));
}

/** Returns the customer's link as the message, so the page can show and copy it. */
export async function estimateLinkAction(slug: string, mode: string, estimateId: string) {
  return run(slug, mode, (ctx) => customerLinkFor(ctx, estimateId));
}

export async function recordDepositAction(slug: string, mode: string, estimateId: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    const method = text(form, 'method');
    if (!isPaymentMethod(method)) throw new ValidationError('Choose how the deposit was paid.');
    const result = await recordDeposit(ctx, estimateId, { method, reference: text(form, 'reference'), paidOn: text(form, 'paidOn'), attemptKey: text(form, 'attemptKey') });
    if (!result.ok) throw new ValidationError(result.message);
    return 'Deposit recorded.';
  });
}

export async function bookJobAction(slug: string, mode: string, jobId: string, allowNoTruck = false) {
  return run(slug, mode, (ctx) => bookJob(ctx, jobId, new Date(), { allowNoTruck }));
}

export async function rescheduleJobAction(slug: string, mode: string, jobId: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await rescheduleJob(ctx, jobId, { date: text(form, 'date'), startTime: text(form, 'startTime'), reason: text(form, 'reason'), allowNoTruck: form.get('allowNoTruck') === 'on' });
    return 'Rescheduled.';
  });
}

export async function releaseBookingAction(slug: string, mode: string, jobId: string) {
  return run(slug, mode, (ctx) => releaseBooking(ctx, jobId));
}

export async function addJobDayAction(slug: string, mode: string, jobId: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await addJobDay(ctx, jobId, {
      dayDate: text(form, 'dayDate'),
      startTime: text(form, 'startTime'),
      hours: text(form, 'hours'),
      crewSize: text(form, 'crewSize'),
      trucks: text(form, 'trucks'),
      notes: text(form, 'notes'),
    });
    return 'Day added.';
  });
}

export async function removeJobDayAction(slug: string, mode: string, jobId: string, dayId: string) {
  return run(slug, mode, (ctx) => removeJobDay(ctx, jobId, dayId));
}

export async function actualTimeAction(slug: string, mode: string, jobId: string, dayId: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await setActualTime(ctx, jobId, dayId, text(form, 'hours'));
    return 'Saved.';
  });
}

export async function soldOutAction(slug: string, mode: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await markSoldOut(ctx, text(form, 'date'), text(form, 'reason'));
    return 'Marked sold out.';
  });
}

export async function unSoldOutAction(slug: string, mode: string, id: string) {
  return run(slug, mode, (ctx) => unmarkSoldOut(ctx, id));
}

export async function addTruckAction(slug: string, mode: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await addTruck(ctx, text(form, 'name'));
    return 'Truck added.';
  });
}

// ---------------------------------------------------------------- invoices

export async function createInvoiceAction(slug: string, mode: string, jobId: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    const invoice = await createInvoice(ctx, jobId, { terms: text(form, 'terms') });
    redirect(`${portalPath(ctx)}/invoices/${invoice.id}`);
  });
}

export async function invoiceOptionsAction(slug: string, mode: string, id: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await updateInvoiceOptions(ctx, id, {
      terms: text(form, 'terms'),
      invoiceDate: text(form, 'invoiceDate'),
      serviceTaxOn: ticked(form, 'serviceTaxOn'),
      convenienceFeeOn: ticked(form, 'convenienceFeeOn'),
      remarks: text(form, 'remarks'),
    });
    return 'Saved.';
  });
}

export async function addInvoiceLineAction(slug: string, mode: string, id: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await addInvoiceLine(ctx, id, { section: text(form, 'section'), name: text(form, 'name'), unit: text(form, 'unit'), qty: text(form, 'qty'), rate: text(form, 'rate') });
    return 'Line added.';
  });
}

export async function removeInvoiceLineAction(slug: string, mode: string, id: string, lineId: string) {
  return run(slug, mode, async (ctx) => {
    await removeInvoiceLine(ctx, id, lineId);
  });
}

export async function sendInvoiceAction(slug: string, mode: string, id: string) {
  return run(slug, mode, async (ctx) => {
    await sendInvoice(ctx, id);
    return 'Sent.';
  });
}

/** Returns the customer's payment link as the message, so the page can show and copy it. */
export async function invoiceLinkAction(slug: string, mode: string, id: string) {
  return run(slug, mode, (ctx) => invoiceLinkFor(ctx, id));
}

export async function voidInvoiceAction(slug: string, mode: string, id: string) {
  return run(slug, mode, (ctx) => voidInvoice(ctx, id));
}

export async function invoicePaymentAction(slug: string, mode: string, id: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    const method = text(form, 'method');
    if (!isPaymentMethod(method)) throw new ValidationError('Choose how it was paid.');
    const result = await recordInvoicePayment(ctx, id, { amount: text(form, 'amount'), method, reference: text(form, 'reference'), paidOn: text(form, 'paidOn'), attemptKey: text(form, 'attemptKey') });
    if (!result.ok) throw new ValidationError(result.message);
    return 'Payment recorded.';
  });
}

// ---------------------------------------------------------------- settings and automations

export async function runDueEmailsAction(slug: string, mode: string) {
  return run(slug, mode, async (ctx) => {
    const r = await processDueAutomations(ctx);
    return `Sent ${r.sent}, cancelled ${r.cancelled}, failed ${r.failed}.`;
  });
}

export async function ruleAction(slug: string, mode: string, id: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    // "2 days" / "3 hours" from the Settings page; plain minutes still accepted.
    const unit = text(form, 'delayUnit');
    const amount = Number(text(form, unit ? 'delay' : 'delayMinutes'));
    const minutes = unit === 'days' ? amount * 1440 : unit === 'hours' ? amount * 60 : amount;
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 60 * 24 * 60) throw new ValidationError('Enter the wait as a whole number (up to 60 days).');
    // Move reminders are stored as minutes before the move's start (a negative delay).
    const before = text(form, 'before') === '1';
    await updateRule(ctx, id, { isActive: ticked(form, 'isActive'), delayMinutes: before ? -minutes : minutes });
    return 'Saved.';
  });
}

export async function newCatalogItemAction(slug: string, mode: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    const item = await createCatalogItem(ctx, { name: text(form, 'name'), category: text(form, 'category'), unit: text(form, 'unit'), rate: text(form, 'rate') });
    return `Added "${item.name}".`;
  });
}

export async function catalogItemAction(slug: string, mode: string, id: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await updateCatalogItem(ctx, id, { rate: text(form, 'rate'), isActive: ticked(form, 'isActive') });
    return 'Saved.';
  });
}

export async function templateAction(slug: string, mode: string, id: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    await updateTemplate(ctx, id, { subject: text(form, 'subject'), body: text(form, 'body') });
    return 'Saved.';
  });
}

export async function termsPdfAction(slug: string, mode: string, _p: Form, form: FormData) {
  return run(slug, mode, async (ctx) => {
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) throw new ValidationError('Choose the Terms & Conditions PDF.');
    const pdf = await uploadTermsPdf(ctx, { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return `Uploaded. Estimates sent from now on link to version ${pdf.version}.`;
  });
}

// ---------------------------------------------------------------- customer link pages

async function linkRequestFacts() {
  const h = await headers();
  return {
    ip: (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || null,
    userAgent: h.get('user-agent'),
  };
}

export async function signEstimateLinkAction(token: string, _p: Form, form: FormData) {
  return act(async () => {
    const ctx = await requireLinkContext(token);
    await signEstimateByLink(ctx, {
      valuationInitials: text(form, 'valuationInitials'),
      signatureName: text(form, 'signatureName'),
      agree: form.get('agree') === 'on',
      ...(await linkRequestFacts()),
    });
    redirect(`/l/${token}?step=confirm`);
  });
}

export async function payDepositLinkAction(token: string, _p: Form, form: FormData) {
  return act(async () => {
    const ctx = await requireLinkContext(token);
    const result = await payDepositByLink(ctx, { cardToken: text(form, 'cardToken') || undefined, attemptKey: text(form, 'attemptKey') });
    if (!result.ok) throw new ValidationError(result.message);
    return 'Thank you! Your deposit is paid. A receipt is on its way.';
  });
}

export async function payInvoiceLinkAction(token: string, _p: Form, form: FormData) {
  return act(async () => {
    const ctx = await requireLinkContext(token);
    const result = await payInvoiceByLink(ctx, { cardToken: text(form, 'cardToken') || undefined, attemptKey: text(form, 'attemptKey') });
    if (!result.ok) throw new ValidationError(result.message);
    return 'Thank you! Your invoice is paid. A receipt is on its way.';
  });
}
