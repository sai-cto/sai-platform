/**
 * Movegistics CSV exports → one normalized set of HHMC records (Phase 5C).
 *
 * Pure: reads the seven list exports (Contacts, Leads, Work Requests, Estimates, Work Orders,
 * Invoices, Payments) as strings and returns plain objects. No database, no clock, no network.
 * The exports carry totals only (no estimate / invoice line items) and link records by title
 * and contact name rather than by id, so linking is done here, conservatively, and every record
 * that cannot be linked is counted in `issues` rather than guessed.
 *
 * Never log the values this returns: they are real customer data.
 */
import { createHash } from 'node:crypto';
import Papa from 'papaparse';
import type { EstimateStatus, InvoiceStatus, LeadSource, ServiceType, Stage } from '../../src/modules/hhmc/schema';

export type Files = {
  contacts: string;
  leads: string;
  workRequests: string;
  estimates: string;
  workOrders: string;
  invoices: string;
  payments: string;
};

export const FILE_NAMES: Record<keyof Files, string> = {
  contacts: 'movegistics-contacts.csv',
  leads: 'movegistics-leads.csv',
  workRequests: 'movegistics-work-requests.csv',
  estimates: 'movegistics-estimates.csv',
  workOrders: 'movegistics-work-orders.csv',
  invoices: 'movegistics-invoices.csv',
  payments: 'movegistics-payments.csv',
};

type Row = Record<string, string>;

export type NContact = { sid: string; firstName: string; lastName: string; email: string | null; phone: string | null; createdOn: string | null; notes: string | null };
export type NLead = {
  sid: string; contactSid: string | null; firstName: string; lastName: string; email: string | null; phone: string | null;
  source: LeadSource; sourceDetail: string | null; moveDate: string | null; origin: string | null; destination: string | null;
  createdOn: string | null; ownerName: string | null; customerNote: string | null; internalNote: string | null; bedrooms: string | null;
};
export type NJob = {
  sid: string; title: string; contactSid: string; moveDate: string | null; tentative: boolean; origin: string | null; destination: string | null;
  serviceType: ServiceType; jobType: string; stage: Stage; lostReason: string | null; source: LeadSource; sourceDetail: string | null;
  ownerName: string | null; createdOn: string | null; amountCents: number; sections: Record<string, number>;
  days: string[]; workOrderSids: string[]; customerComments: string | null; internalNotes: string | null; placeholder: boolean;
};
export type NEstimate = { sid: string; jobSid: string; version: number; status: EstimateStatus; amountCents: number; createdByName: string | null; createdOn: string | null; expiresOn: string | null; voidReason: string | null };
export type NInvoice = { sid: string; jobSid: string; contactSid: string; status: InvoiceStatus; amountCents: number; balanceCents: number; invoiceDate: string; dueDate: string; ownerName: string | null; poNumber: string | null };
export type NPayment = {
  sid: string; contactSid: string | null; invoiceSid: string | null; jobSid: string | null; isDeposit: boolean; amountCents: number;
  refundedCents: number; partialRefund: boolean; method: 'card' | 'cash' | 'check' | 'other'; paidOn: string; cardBrand: string | null; cardLast4: string | null; description: string;
};

export type Issues = Record<string, number>;
export type Normalized = { contacts: NContact[]; leads: NLead[]; jobs: NJob[]; estimates: NEstimate[]; invoices: NInvoice[]; payments: NPayment[]; issues: Issues };

// ---------------------------------------------------------------- parsing helpers

export function parseCsv(text: string): Row[] {
  const out = Papa.parse<Row>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy' });
  return out.data.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim(), (v ?? '').trim()])));
}

const blank = (v: string | undefined) => (v && v.trim() && v.trim() !== '-' ? v.trim() : null);

/** "1,234.5" / "$12" → cents, exactly (no floating point). Empty → 0. */
export function cents(v: string | undefined): number {
  const s = (v ?? '').replace(/[$,\s]/g, '');
  if (!s) return 0;
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error('Not an amount');
  // Movegistics sometimes exports float noise (12.999999999999998): round to the cent, half-up,
  // using the digits themselves rather than floating point.
  const fraction = (m[3] ?? '').padEnd(3, '0');
  const value = Number(m[2]) * 100 + Number(fraction.slice(0, 2)) + (Number(fraction[2]) >= 5 ? 1 : 0);
  return m[1] ? -value : value;
}

/** "MM/DD/YYYY" (optionally with a time) or epoch milliseconds → "YYYY-MM-DD". */
export function day(v: string | undefined): string | null {
  const s = blank(v);
  if (!s) return null;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  if (/^\d{12,14}$/.test(s)) return new Date(Number(s)).toISOString().slice(0, 10);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

export const normEmail = (v: string | undefined) => blank(v)?.toLowerCase() ?? null;
/** Phone digits, last 10 (US numbers with or without +1). */
export const normPhone = (v: string | undefined) => {
  const d = (v ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
};
const normName = (v: string | undefined) => (v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const nameOf = (first: string, last: string) => normName(`${first} ${last}`);

function address(r: Row, prefix: 'Origin' | 'Destination'): string | null {
  const zip = r[`${prefix} Zip Code/ Postal Code`] ?? '';
  const parts = [r[`${prefix} Address Line 1`], r[`${prefix} Address Unit Number`], r[`${prefix} Address Line 2`], r[`${prefix} City`], [r[`${prefix} State`], zip].filter(Boolean).join(' ')]
    .map((p) => blank(p))
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** The managers' fixed lead-source list from Movegistics' free text (kept as the detail). */
export function leadSource(raw: string | undefined): { source: LeadSource; detail: string | null } {
  const s = blank(raw);
  if (!s) return { source: 'Other', detail: null };
  const t = s.toLowerCase();
  if (/^[0-9a-f]{24}$/.test(t)) return { source: 'Other', detail: `Movegistics referral source id ${s}` };
  if (/google/.test(t)) return { source: 'Google', detail: s };
  if (/cornell/.test(t)) return { source: 'Cornellian', detail: s };
  if (/(used|return|repeat|before|past|again|previous)/.test(t)) return { source: 'Repeat Customer', detail: s };
  if (/(friend|referr|recommend|realtor|agent|family|word of mouth|neighbo|colleague|coworker|daughter|son\b|mother|father)/.test(t)) return { source: 'Referral', detail: s };
  if (/(instagram|facebook|tiktok|social|reddit|twitter)/.test(t)) return { source: 'Social', detail: s };
  if (/(homeadvisor|thumbtack|yelp|angi|movebuddha|third)/.test(t)) return { source: 'Third-party', detail: s };
  if (/(website|^web$|online|internet|search|ai\b)/.test(t)) return { source: 'Website', detail: s };
  return { source: 'Other', detail: s };
}

const SERVICE: Record<string, { serviceType: ServiceType; jobType: string }> = {
  local: { serviceType: 'local', jobType: 'Local Full Service Move' },
  commercial: { serviceType: 'local', jobType: 'Commercial Move' },
  intrastate: { serviceType: 'intrastate', jobType: 'Intrastate Move' },
  interstate: { serviceType: 'interstate', jobType: 'Interstate Move' },
  international: { serviceType: 'interstate', jobType: 'Interstate Move' },
};

const OWNER: Record<string, string> = { hired: 'Hired Hands', general: 'General Manager', admin: 'Admin', dhivya: 'Movegistics support' };
/** Movegistics owner → a name ("Hired  Hands" → "Hired Hands"; the estimates export truncates to the first word). */
export function ownerName(raw: string | undefined): string | null {
  const s = blank(raw)?.replace(/\s+/g, ' ');
  if (!s) return null;
  const first = s.split(' ')[0].toLowerCase();
  return OWNER[first] && (s.split(' ').length === 1 || first === 'dhivya' || first === 'admin') ? OWNER[first] : s;
}

const SECTION_COLUMNS: Record<string, string> = {
  transportation_labor: 'Transportation Labor Amount',
  packing_labor: 'Packing labor Amount',
  packing_materials: 'Packing Material Amount',
  crating: 'Crating Amount',
  additional_services: 'Additional Services Amount',
  storage: 'Storage Amount',
};

export const hashOf = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);

// ---------------------------------------------------------------- normalize

export function normalize(files: Files): Normalized {
  const issues: Issues = {};
  const issue = (key: string) => (issues[key] = (issues[key] ?? 0) + 1);

  // ---- contacts: deduplicated by email, then phone (the first one wins; later ones point to it)
  const contacts: NContact[] = [];
  const byEmail = new Map<string, NContact>();
  const byPhone = new Map<string, NContact>();
  const byName = new Map<string, NContact[]>();
  const alias = new Map<string, NContact>(); // Movegistics contact id → kept contact
  const keep = (c: NContact) => {
    contacts.push(c);
    if (c.email) byEmail.set(c.email, c);
    if (c.phone && !byPhone.has(c.phone)) byPhone.set(c.phone, c);
    const n = nameOf(c.firstName, c.lastName);
    if (n) byName.set(n, [...(byName.get(n) ?? []), c]);
  };
  for (const r of parseCsv(files.contacts)) {
    const email = normEmail(r['Email Address']);
    const phone = normPhone(r['Contact Number - Mobile']) ?? normPhone(r['Contact Number - Home']);
    const existing = (email && byEmail.get(email)) || (!email && phone && byPhone.get(phone)) || null;
    if (existing) {
      alias.set(r['Contact ID'], existing);
      issue('contacts merged as duplicates (same email or phone)');
      continue;
    }
    const c: NContact = { sid: r['Contact ID'], firstName: r['First Name'] ?? '', lastName: r['Last Name'] ?? '', email, phone, createdOn: day(r['Contact Created Date']), notes: blank(r['Internal Note']) };
    if (!c.firstName && !c.lastName && !email && !phone) {
      issue('contacts skipped (no name, email or phone)');
      continue;
    }
    alias.set(c.sid, c);
    keep(c);
  }
  /** Finds (or creates, from a work request / lead) the contact for this person. */
  const contactFor = (p: { email: string | null; phone: string | null; first: string; last: string; sid: string; createdOn: string | null }, source: string): NContact => {
    const found = (p.email && byEmail.get(p.email)) || (p.phone && byPhone.get(p.phone)) || null;
    if (found) return found;
    const named = byName.get(nameOf(p.first, p.last)) ?? [];
    if (!p.email && !p.phone && named.length === 1) return named[0];
    const c: NContact = { sid: `${source}:${p.sid}`, firstName: p.first, lastName: p.last, email: p.email, phone: p.phone, createdOn: p.createdOn, notes: null };
    issue(`contacts created from ${source}s (not in the contacts export)`);
    keep(c);
    return c;
  };
  const splitName = (full: string) => {
    const parts = full.replace(/\s+/g, ' ').trim().split(' ');
    return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
  };

  // ---- leads (the export holds only leads that were never converted)
  const leads: NLead[] = [];
  for (const r of parseCsv(files.leads)) {
    const email = normEmail(r['Email Address']);
    const phone = normPhone(r['Contact Number - Mobile']) ?? normPhone(r['Contact Number - Home']);
    const src = leadSource(r['Referral Source']);
    const createdOn = day(r['Lead Created Date']);
    // A lead becomes a contact only when it is converted (as in Movegistics): link an existing
    // contact if there is one, never create one.
    const contact = (email && byEmail.get(email)) || (phone && byPhone.get(phone)) || null;
    leads.push({
      sid: r['Lead ID'], contactSid: contact?.sid ?? null, firstName: r['First Name'] ?? '', lastName: r['Last Name'] ?? '', email, phone,
      source: src.source, sourceDetail: src.detail, moveDate: day(r['Move Date']),
      origin: [r['Origin Address Line 1'], r['Origin City'], [r['Origin State'], r['Origin Zip Code/ Postal Code']].filter(Boolean).join(' ')].map((v) => blank(v)).filter(Boolean).join(', ') || null,
      destination: [r['Destination Address Line 1'], r['Destination City'], [r['Destination State'], r['Destination Zip Code/ Postal Code']].filter(Boolean).join(' ')].map((v) => blank(v)).filter(Boolean).join(', ') || null,
      createdOn, ownerName: ownerName(r['Lead Owner']), customerNote: blank(r['Customer Note']), internalNote: blank(r['Internal Note']), bedrooms: blank(r['Number Of Bedrooms']),
    });
  }

  // ---- work orders, grouped by (work request title, contact name)
  const woRows = parseCsv(files.workOrders);
  const titleKey = (title: string, contactName: string) => `${normName(title)}|${normName(contactName)}`;
  const woByKey = new Map<string, Row[]>();
  for (const r of woRows) {
    const k = titleKey(r['Work Request'] ?? '', r['Contact Name'] ?? '');
    woByKey.set(k, [...(woByKey.get(k) ?? []), r]);
  }

  // ---- invoices, grouped the same way (filled after jobs exist)
  const invRows = parseCsv(files.invoices);

  // ---- work requests → jobs
  const jobs: NJob[] = [];
  const jobByKey = new Map<string, NJob[]>();
  const jobByTitle = new Map<string, NJob[]>();
  for (const r of parseCsv(files.workRequests)) {
    const email = normEmail(r['Email Address']);
    const phone = normPhone(r['Phone Number']);
    const contactName = r['Contact Name'] ?? '';
    const { first, last } = splitName(contactName);
    const createdOn = day(r['Work Request Created Date']);
    const contact = contactFor({ email, phone, first, last, sid: r['Work Request ID'], createdOn }, 'work request');
    const service = SERVICE[(r['Service Type'] ?? 'local').toLowerCase()] ?? SERVICE.local;
    const stageRaw = (r['Pipeline Stage'] ?? '').toLowerCase();
    const k = titleKey(r['Work Request Title'] ?? '', contactName);
    const wos = woByKey.get(k) ?? [];
    const src = leadSource(r['Work Request Source']);
    const sections = Object.fromEntries(Object.entries(SECTION_COLUMNS).map(([key, col]) => [key, cents(r[col])]));
    const job: NJob = {
      sid: r['Work Request ID'], title: r['Work Request Title'] ?? '', contactSid: contact.sid,
      moveDate: day(r['Move Date']), tentative: (r['Tentative'] ?? '').toLowerCase() === 'yes',
      origin: address(r, 'Origin'), destination: address(r, 'Destination'),
      serviceType: service.serviceType, jobType: (r['Service Type'] ?? '').toLowerCase() === 'commercial' ? 'Commercial Move' : service.jobType,
      stage: stageRaw === 'closed lost' ? 'lost' : stageRaw === 'lead qualified' ? 'qualified' : stageRaw === 'closed won' ? 'booked' : 'estimate_sent',
      lostReason: blank(r['Closed Lost Reason']), source: src.source, sourceDetail: src.detail,
      ownerName: ownerName(r['Work Request Owner']), createdOn, amountCents: cents(r['Work Request Amount']), sections,
      days: [...new Set(wos.filter((w) => (w['Pipeline Stage'] ?? '') !== 'Cancelled Out').map((w) => day(w['Start Date'])).filter((d): d is string => !!d))].sort(),
      workOrderSids: wos.map((w) => w['WO ID']), customerComments: blank(r['Customer Comments']), internalNotes: blank(r['Internal Note']), placeholder: false,
    };
    if (job.stage === 'lost' && !job.lostReason) job.lostReason = 'Closed lost in Movegistics';
    if (job.stage === 'booked' && wos.length > 0 && wos.every((w) => (w['Pipeline Stage'] ?? '') === 'Cancelled Out')) job.stage = 'cancelled';
    if (!wos.length && stageRaw === 'closed won') issue('closed-won work requests with no work order found');
    jobs.push(job);
    jobByKey.set(k, [...(jobByKey.get(k) ?? []), job]);
    jobByTitle.set(normName(job.title), [...(jobByTitle.get(normName(job.title)) ?? []), job]);
  }
  const findJob = (title: string, contactName: string, onDate?: string | null): NJob | null => {
    const exact = jobByKey.get(titleKey(title, contactName)) ?? [];
    const pool = exact.length ? exact : (jobByTitle.get(normName(title)) ?? []);
    if (!pool.length) return null;
    if (pool.length === 1 || !onDate) return pool[pool.length - 1];
    // Several work requests with the same title (repeat customers): the latest created on or before the date.
    const before = pool.filter((j) => !j.createdOn || j.createdOn <= onDate).sort((a, b) => (a.createdOn ?? '').localeCompare(b.createdOn ?? ''));
    return before.at(-1) ?? pool[0];
  };

  // ---- estimates: versions per job; at most one in force (the platform allows only one)
  const estimates: NEstimate[] = [];
  const estimateRows = parseCsv(files.estimates).map((r) => ({ r, createdOn: day(r['Created Date']) }));
  estimateRows.sort((a, b) => (a.createdOn ?? '').localeCompare(b.createdOn ?? '') || a.r['Estimate ID'].localeCompare(b.r['Estimate ID']));
  const perJob = new Map<string, NEstimate[]>();
  const STATUS: Record<string, EstimateStatus> = { signed: 'signed', viewed: 'viewed', sent: 'sent', void: 'void', draft: 'draft' };
  for (const { r, createdOn } of estimateRows) {
    const job = findJob(r['Work Request Title'] ?? '', r['Contacts'] ?? '', createdOn);
    if (!job) {
      issue('estimates with no matching work request (not imported)');
      continue;
    }
    const list = perJob.get(job.sid) ?? [];
    const e: NEstimate = {
      sid: r['Estimate ID'], jobSid: job.sid, version: list.length + 1, status: STATUS[(r['Status'] ?? '').toLowerCase()] ?? 'sent',
      amountCents: cents(r['Estimate Amount']), createdByName: ownerName(r['Estimate Owner']), createdOn, expiresOn: day(r['Expiration Date']), voidReason: null,
    };
    list.push(e);
    perJob.set(job.sid, list);
    estimates.push(e);
  }
  for (const list of perJob.values()) {
    const live = list.filter((e) => e.status === 'sent' || e.status === 'viewed' || e.status === 'signed');
    if (live.length <= 1) continue;
    const keepOne = [...live].reverse().find((e) => e.status === 'signed') ?? live[live.length - 1];
    for (const e of live) {
      if (e === keepOne) continue;
      e.voidReason = `Imported: Movegistics showed this as ${e.status}, but a later estimate for the same work request is the one in force.`;
      e.status = 'void';
      issue('older open estimates voided (Movegistics allowed several per work request)');
    }
  }

  // ---- invoices
  const invoices: NInvoice[] = [];
  const INV: Record<string, InvoiceStatus> = { paid: 'paid', sent: 'sent', partial_paid: 'partially_paid', draft: 'draft', created: 'draft' };
  for (const r of invRows) {
    const invoiceDate = day(r['Invoice Date']) ?? day(r['Created Date'])!;
    const email = normEmail(r['Contact Email']);
    const phone = normPhone(r['Contact Phone']);
    let job = findJob(r['Work Request Title'] ?? '', r['Contact Name'] ?? '', invoiceDate);
    if (!job) {
      const { first, last } = splitName(r['Contact Name'] ?? '');
      const contact = contactFor({ email, phone, first, last, sid: r['Invoice ID'], createdOn: invoiceDate }, 'invoice');
      job = {
        sid: `invoice-job:${r['Invoice ID']}`, title: r['Work Request Title'] || `Invoice ${r['Invoice ID']}`, contactSid: contact.sid, moveDate: invoiceDate, tentative: false,
        origin: null, destination: null, serviceType: 'local', jobType: 'Local Full Service Move', stage: 'booked', lostReason: null, source: 'Other',
        sourceDetail: 'Imported invoice without a matching work request', ownerName: ownerName(r['Invoice Owner']), createdOn: invoiceDate, amountCents: cents(r['Invoice Amount']),
        sections: {}, days: [], workOrderSids: [], customerComments: null, internalNotes: null, placeholder: true,
      };
      jobs.push(job);
      issue('invoices with no matching work request (a placeholder work request was made)');
    }
    const amount = cents(r['Invoice Amount']);
    // Movegistics leaves "Balance Due" at the full amount on many invoices it marks PAID (281 in
    // 2025, nearly all fully covered by payments in its own payments export): PAID means $0 due.
    const status = INV[(r['Status'] ?? '').toLowerCase()] ?? 'sent';
    const exported = Math.max(0, Math.min(cents(r['Balance Due']), amount));
    if (status === 'paid' && exported > 0) issue('PAID invoices whose exported "Balance Due" was not zero (treated as fully paid)');
    const balance = status === 'paid' ? 0 : exported;
    invoices.push({
      sid: r['Invoice ID'], jobSid: job.sid, contactSid: job.contactSid, status, amountCents: amount, balanceCents: balance,
      invoiceDate, dueDate: day(r['Due Date']) ?? invoiceDate, ownerName: ownerName(r['Invoice Owner']), poNumber: blank(r['PO Number']),
    });
  }
  // Job stages from what happened after booking.
  const invoicesOf = new Map<string, NInvoice[]>();
  for (const i of invoices) invoicesOf.set(i.jobSid, [...(invoicesOf.get(i.jobSid) ?? []), i]);
  for (const job of jobs) {
    const list = invoicesOf.get(job.sid);
    if (!list?.length || job.stage === 'lost' || job.stage === 'cancelled') continue;
    job.stage = list.every((i) => i.status === 'paid') ? 'closed' : 'completed';
  }

  // ---- payments (REQUESTED = asked for, never received: not money, not imported)
  const payments: NPayment[] = [];
  const invoiceBySid = new Map(invoices.map((i) => [i.sid, i]));
  const contactByName = (full: string) => {
    const list = byName.get(normName(full)) ?? [];
    return list.length === 1 ? list[0] : null;
  };
  const jobsOfContact = new Map<string, NJob[]>();
  for (const j of jobs) jobsOfContact.set(j.contactSid, [...(jobsOfContact.get(j.contactSid) ?? []), j]);
  for (const r of parseCsv(files.payments)) {
    const tx = (r['Transaction Status'] ?? '').toUpperCase();
    if (tx === 'REQUESTED' || tx === '') {
      issue('payment requests never paid (not imported: no money moved)');
      continue;
    }
    const paidOn = day(r['Payment Date']) ?? day(r['Created At'])!;
    const amount = cents(r['Amount Recd']);
    const invoice = blank(r['Invoice No.']) ? (invoiceBySid.get(r['Invoice No.']) ?? null) : null;
    if (blank(r['Invoice No.']) && !invoice) issue('payments naming an invoice that is not in the invoices export');
    const contactSid = invoice?.contactSid ?? contactByName(r['Contact Name'] ?? '')?.sid ?? null;
    let jobSid = invoice?.jobSid ?? null;
    if (!jobSid && contactSid) {
      // A deposit: the customer's work request with the nearest move on or after the payment.
      const candidates = (jobsOfContact.get(contactSid) ?? []).filter((j) => !j.placeholder);
      const upcoming = candidates.filter((j) => (j.moveDate ?? '9999') >= paidOn).sort((a, b) => (a.moveDate ?? '').localeCompare(b.moveDate ?? ''));
      jobSid = (upcoming[0] ?? candidates.sort((a, b) => (b.createdOn ?? '').localeCompare(a.createdOn ?? ''))[0])?.sid ?? null;
    }
    if (!contactSid) issue('payments whose contact name matches no single contact (imported without a customer)');
    else if (!jobSid) issue('payments not linked to any work request');
    const mode = (r['Payment Mode'] ?? '').toLowerCase();
    payments.push({
      sid: r['Payment ID'], contactSid, invoiceSid: invoice?.sid ?? null, jobSid, isDeposit: !invoice && (r['Deposit'] ?? '').toLowerCase() === 'yes',
      amountCents: amount, refundedCents: tx === 'REFUNDED' ? amount : 0, partialRefund: tx === 'PARTIAL_REFUNDED',
      method: mode.startsWith('card') ? 'card' : mode === 'cash' ? 'cash' : mode === 'check' ? 'check' : 'other', paidOn,
      cardBrand: blank(r['Card Type']), cardLast4: blank(r['Last 4 Digits Of Card']), description: blank(r['Description']) ?? (invoice ? `Payment on ${invoice.sid}` : 'Deposit'),
    });
    if (tx === 'PARTIAL_REFUNDED') issue('partially refunded payments (refund amount not in the export: recorded as not refunded)');

  }
  return { contacts, leads, jobs, estimates, invoices, payments, issues };
}
