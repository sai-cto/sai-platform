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
import type { NCompanies } from './companies';
import type { EstimateStatus, InvoiceStatus, LeadSource, LeadStatus, Rating, ServiceType, Stage } from '../../src/modules/hhmc/schema';

export type Files = {
  contacts: string;
  leads: string;
  workRequests: string;
  estimates: string;
  workOrders: string;
  invoices: string;
  payments: string;
  /** Optional (exports from 2026-11-12 on): mostly copies of contacts, see companies.ts. */
  companies?: string;
};

/** Read when present; an older export folder without them still imports. */
export const OPTIONAL_FILE_NAMES = { companies: 'movegistics-companies.csv' } as const;

export const FILE_NAMES: Record<Exclude<keyof Files, 'companies'>, string> = {
  contacts: 'movegistics-contacts.csv',
  leads: 'movegistics-leads.csv',
  workRequests: 'movegistics-work-requests.csv',
  estimates: 'movegistics-estimates.csv',
  workOrders: 'movegistics-work-orders.csv',
  invoices: 'movegistics-invoices.csv',
  payments: 'movegistics-payments.csv',
};

type Row = Record<string, string>;
/** An exported row as Movegistics gave it, blank columns left out (kept with the import link). */
export type Raw = Record<string, string>;

export type NContact = {
  sid: string; firstName: string; lastName: string; email: string | null; phone: string | null; createdOn: string | null; notes: string | null; raw: Raw;
  /** Movegistics contacts merged into this one (same email or phone): their own rows are kept too. */
  duplicates: { sid: string; raw: Raw }[];
};
export type NLead = {
  sid: string; contactSid: string | null; firstName: string; lastName: string; email: string | null; phone: string | null;
  source: LeadSource; sourceDetail: string | null; moveDate: string | null; origin: string | null; destination: string | null;
  createdOn: string | null; ownerName: string | null; customerNote: string | null; internalNote: string | null; bedrooms: string | null;
  status: LeadStatus; disqualifiedReason: string | null; disqualifiedOn: string | null; qualifiedOn: string | null;
  moveType: 'residential' | 'commercial'; storage: boolean; rating: Rating | null;
  utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; gclid: string | null; fbclid: string | null; raw: Raw;
};
export type NWorkOrder = { sid: string; days: string[]; note: string; cancelled: boolean; raw: Raw };
export type NJob = {
  sid: string; title: string; contactSid: string; moveDate: string | null; tentative: boolean; origin: string | null; destination: string | null;
  serviceType: ServiceType; jobType: string; stage: Stage; lostReason: string | null; source: LeadSource; sourceDetail: string | null;
  ownerName: string | null; createdOn: string | null; amountCents: number; sections: Record<string, number>;
  /** When the move was booked: its first work order's creation date (null: unknown). */
  bookedOn: string | null;
  days: string[]; workOrderSids: string[]; customerComments: string | null; internalNotes: string | null; placeholder: boolean;
  /** Work-order notes per move day (WO id, crew, vehicle), shown on the day. */
  dayNotes: Record<string, string>; workOrders: NWorkOrder[];
  bedrooms: string | null; companyName: string | null; rating: Rating | null; coordinators: string[]; raw: Raw;
};
export type NEstimate = { sid: string; jobSid: string; version: number; status: EstimateStatus; amountCents: number; createdByName: string | null; createdOn: string | null; expiresOn: string | null; voidReason: string | null; raw: Raw };
export type NInvoice = {
  sid: string; jobSid: string; contactSid: string; status: InvoiceStatus; amountCents: number; balanceCents: number; invoiceDate: string; dueDate: string; ownerName: string | null; poNumber: string | null;
  /** The work request's deposit credited to this invoice (Movegistics often leaves it unapplied). */
  depositCreditCents: number; raw: Raw;
};
export type NPayment = {
  sid: string; contactSid: string | null; invoiceSid: string | null; jobSid: string | null; isDeposit: boolean; amountCents: number;
  refundedCents: number; partialRefund: boolean; method: 'card' | 'cash' | 'check' | 'other'; paidOn: string; cardBrand: string | null; cardLast4: string | null; description: string; raw: Raw;
};

export type Issues = Record<string, number>;
/** Movegistics ids (never names) the report lists so a manager can look each one up. */
export type Followups = { partialRefundsWithoutAmount: string[]; paidInvoicesNotCovered: string[]; estimatesOnPlaceholder: string[]; staleOpenInvoices?: string[] };
export type Normalized = {
  contacts: NContact[]; leads: NLead[]; jobs: NJob[]; estimates: NEstimate[]; invoices: NInvoice[]; payments: NPayment[]; issues: Issues; followups: Followups;
  /** Invoice id → work-request deposit credited to it while it was still open (the reconciliation applies the same). */
  openDepositCredits?: Map<string, number>;
  /** From the optional Companies export (normalizeCompanies). */
  companies?: NCompanies;
};

/** Hand-entered corrections (data/movegistics/refund-amounts.csv): Payment ID → refunded cents. */
export type Overrides = { refunds?: Map<string, number>; /** Today (YYYY-MM-DD), for the list of long-overdue invoices. */ today?: string };

/** Reads refund-amounts.csv ("Payment ID","Refunded Amount"). Every row must be valid. */
export function parseRefundOverrides(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [i, r] of parseCsv(text).entries()) {
    const sid = blank(r['Payment ID']);
    const amount = blank(r['Refunded Amount']);
    if (!sid || !amount) throw new Error(`Refusing: refund-amounts.csv row ${i + 2} needs both "Payment ID" and "Refunded Amount".`);
    let value: number;
    try {
      value = cents(amount);
    } catch {
      throw new Error(`Refusing: refund-amounts.csv row ${i + 2}: "Refunded Amount" is not an amount.`);
    }
    if (value <= 0) throw new Error(`Refusing: refund-amounts.csv row ${i + 2}: the refunded amount must be more than zero.`);
    out.set(sid, value);
  }
  return out;
}

// ---------------------------------------------------------------- parsing helpers

export function parseCsv(text: string): Row[] {
  const out = Papa.parse<Row>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy' });
  return out.data.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim(), (v ?? '').trim()])));
}

const blank = (v: string | undefined) => (v && v.trim() && v.trim() !== '-' ? v.trim() : null);
/** The row with blank columns left out (what the "From Movegistics" panel shows). */
export const rawOf = (r: Row): Raw => Object.fromEntries(Object.entries(r).filter(([k, v]) => k && blank(v) !== null));
const yes = (v: string | undefined) => /^(yes|y|true|1)$/i.test((v ?? '').trim());
export function rating(v: string | undefined): Rating | null {
  const t = (v ?? '').trim().toLowerCase();
  return t === 'hot' || t === 'warm' || t === 'cold' ? t : null;
}
/** Movegistics lead status → ours. Labels only (no money): an unknown one is kept as New and counted. */
const LEAD_STATUS: Record<string, LeadStatus> = { NEW: 'new', OPEN: 'new', CONTACTED: 'new', DISQUALIFIED: 'disqualified', QUALIFIED: 'converted', CONVERTED: 'converted' };
/** Every day from start to end (inclusive), at most 14: a work order's activity dates. */
export function daysBetween(start: string | null, end: string | null): string[] {
  if (!start) return [];
  const out: string[] = [];
  const last = end && end > start ? end : start;
  for (let d = new Date(`${start}T12:00:00Z`); out.length < 14; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > last) break;
    out.push(iso);
  }
  return out;
}

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
  if (/^\d{12,14}$/.test(s)) return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Number(s)));
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

/** Movegistics status values we know. Anything else stops the import: nothing is guessed. */
export const ESTIMATE_STATUS: Record<string, EstimateStatus> = { SIGNED: 'signed', VIEWED: 'viewed', SENT: 'sent', VOID: 'void', DRAFT: 'draft' };
export const INVOICE_STATUS: Record<string, InvoiceStatus> = { PAID: 'paid', SENT: 'sent', PARTIAL_PAID: 'partially_paid', DRAFT: 'draft', CREATED: 'draft', VOID: 'void', VOIDED: 'void', CANCELLED: 'void', CANCELED: 'void' };
/** Payment "Transaction Status": money received, refunded, or never received (not imported). */
export const PAYMENT_STATUS: Record<string, 'received' | 'refunded' | 'partial_refund' | 'not_received'> = {
  SUCCESSFUL: 'received', RECORDED: 'received', REFUNDED: 'refunded', PARTIAL_REFUNDED: 'partial_refund',
  REQUESTED: 'not_received', FAILED: 'not_received', DECLINED: 'not_received', VOIDED: 'not_received', CANCELLED: 'not_received', CANCELED: 'not_received',
};
export class UnknownValues extends Error {
  override name = 'UnknownValues';
}
function strict<T>(map: Record<string, T>, raw: string | undefined, what: string, unknown: Map<string, Set<string>>): T | undefined {
  const key = (raw ?? '').trim().toUpperCase().replace(/\s+/g, '_');
  if (key in map) return map[key];
  // The value is printed: mask anything that could be personal data (shifted columns).
  const shown = !key ? '(blank)' : /@|\d{4,}/.test(key) || key.length > 30 ? '(a value that looks like personal data: columns shifted?)' : key;
  unknown.set(what, (unknown.get(what) ?? new Set()).add(shown));
  return undefined;
}

export const hashOf = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);

// ---------------------------------------------------------------- normalize

export function normalize(files: Files, overrides: Overrides = {}): Normalized {
  const issues: Issues = {};
  const followups: Followups = { partialRefundsWithoutAmount: [], paidInvoicesNotCovered: [], estimatesOnPlaceholder: [] };
  const unknown = new Map<string, Set<string>>();
  const issue = (key: string) => (issues[key] = (issues[key] ?? 0) + 1);

  // ---- contacts: deduplicated by email, then phone (the first one wins; later ones point to it)
  const contacts: NContact[] = [];
  const byEmail = new Map<string, NContact>();
  const byPhone = new Map<string, NContact>();
  const byName = new Map<string, NContact[]>();
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
      issue('contacts merged as duplicates (same email or phone)');
      existing.duplicates.push({ sid: r['Contact ID'], raw: rawOf(r) });
      continue;
    }
    const c: NContact = { sid: r['Contact ID'], firstName: r['First Name'] ?? '', lastName: r['Last Name'] ?? '', email, phone, createdOn: day(r['Contact Created Date']), notes: blank(r['Internal Note']), raw: rawOf(r), duplicates: [] };
    if (!c.firstName && !c.lastName && !email && !phone) {
      issue('contacts skipped (no name, email or phone)');
      continue;
    }
    keep(c);
  }
  /** Finds (or creates, from a work request / lead) the contact for this person. */
  const contactFor = (p: { email: string | null; phone: string | null; first: string; last: string; sid: string; createdOn: string | null }, source: string): NContact => {
    const byPhoneMatch = p.phone ? byPhone.get(p.phone) : undefined;
    const found = (p.email && byEmail.get(p.email)) || (byPhoneMatch && (!byPhoneMatch.email || !p.email || byPhoneMatch.email === p.email) ? byPhoneMatch : null) || null;
    if (found) return found;
    const named = byName.get(nameOf(p.first, p.last)) ?? [];
    if (!p.email && !p.phone && named.length === 1) return named[0];
    const c: NContact = { sid: `${source}:${p.sid}`, firstName: p.first, lastName: p.last, email: p.email, phone: p.phone, createdOn: p.createdOn, notes: null, raw: {}, duplicates: [] };
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
    const statusKey = (r['Lead Status'] ?? '').trim().toUpperCase().replace(/\s+/g, '_');
    let status: LeadStatus = LEAD_STATUS[statusKey] ?? 'new';
    if (!(statusKey in LEAD_STATUS)) issue('leads with a status the importer does not know (kept as New; the original is on the lead)');
    // Converted needs the person it became; without one, a "qualified" lead stays open.
    if (status === 'converted' && !contact) status = 'new';
    leads.push({
      sid: r['Lead ID'], contactSid: contact?.sid ?? null, firstName: r['First Name'] ?? '', lastName: r['Last Name'] ?? '', email, phone,
      source: src.source, sourceDetail: src.detail, moveDate: day(r['Move Date']),
      origin: [r['Origin Address Line 1'], r['Origin City'], [r['Origin State'], r['Origin Zip Code/ Postal Code']].filter(Boolean).join(' ')].map((v) => blank(v)).filter(Boolean).join(', ') || null,
      destination: [r['Destination Address Line 1'], r['Destination City'], [r['Destination State'], r['Destination Zip Code/ Postal Code']].filter(Boolean).join(' ')].map((v) => blank(v)).filter(Boolean).join(', ') || null,
      createdOn, ownerName: ownerName(r['Lead Owner']), customerNote: blank(r['Customer Note']), internalNote: blank(r['Internal Note']), bedrooms: blank(r['Number Of Bedrooms']),
      status, disqualifiedReason: status === 'disqualified' ? (blank(r['Lead Disqualified Reason']) ?? 'Disqualified in Movegistics') : null,
      disqualifiedOn: status === 'disqualified' ? (day(r['Lead Disqualified Date']) ?? day(r['Lead Modified Date']) ?? createdOn) : null,
      qualifiedOn: status === 'converted' ? (day(r['Lead Qualified Date']) ?? day(r['Lead Modified Date']) ?? createdOn) : null,
      moveType: /commercial/i.test(r['Move Type'] ?? '') ? 'commercial' : 'residential', storage: yes(r['Storage']), rating: rating(r['Lead Rating']),
      utmSource: blank(r['UTM Source']), utmMedium: blank(r['UTM Medium']), utmCampaign: blank(r['UTM Campaign']), gclid: blank(r['GCLID']), fbclid: blank(r['FBCLID']),
      raw: rawOf(r),
    });
  }

  // ---- work orders (assigned to their work request once the work requests are read)
  const woRows = parseCsv(files.workOrders);
  const titleKey = (title: string, contactName: string) => `${normName(title)}|${normName(contactName)}`;
  const workOrderOf = (w: Row): NWorkOrder => {
    const days = daysBetween(day(w['Start Date']), day(w['End Date']));
    const note = [`WO ${w['WO ID']}`, blank(w['Crew']) ? `crew: ${blank(w['Crew'])}` : null, blank(w['Assigned vehicle']) ? `vehicle: ${blank(w['Assigned vehicle'])}` : null].filter(Boolean).join(', ');
    return { sid: w['WO ID'], days, note, cancelled: (w['Pipeline Stage'] ?? '') === 'Cancelled Out', raw: rawOf(w) };
  };

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
      bookedOn: null, days: [], dayNotes: {}, workOrders: [], workOrderSids: [], customerComments: blank(r['Customer Comments']),
      internalNotes: [blank(r['Internal Note']), blank(r['Notes']) ? `Notes (Movegistics): ${blank(r['Notes'])}` : null].filter(Boolean).join('\n\n') || null,
      placeholder: false, bedrooms: blank(r['Number Of Bedrooms']), companyName: blank(r['Company Name']), rating: rating(r['Work Request Rating']),
      coordinators: (r['Work Request Move Coordinators'] ?? '').split(/[,;]/).map((v) => v.trim()).filter(Boolean), raw: rawOf(r),
    };
    if (job.stage === 'lost' && !job.lostReason) job.lostReason = 'Closed lost in Movegistics';
    jobs.push(job);
    jobByKey.set(k, [...(jobByKey.get(k) ?? []), job]);
    jobByTitle.set(normName(job.title), [...(jobByTitle.get(normName(job.title)) ?? []), job]);
  }
  const dayNumber = (d: string) => Date.parse(`${d}T12:00:00Z`) / 86_400_000;
  /**
   * The work request a record names (by title and contact). Several with the same title (a repeat
   * customer): for a work order or an invoice (`moveNear` = its start or invoice date), the booked
   * one whose move date is nearest; otherwise the latest created on or before the date.
   */
  const findJob = (title: string, contactName: string, onDate?: string | null, moveNear?: string | null): NJob | null => {
    const exact = jobByKey.get(titleKey(title, contactName)) ?? [];
    let pool = exact;
    if (!pool.length) {
      const byTitle = jobByTitle.get(normName(title)) ?? [];
      if (byTitle.length !== 1) return null;
      issue('records linked by work request title alone (contact name differs)');
      pool = byTitle;
    }
    if (!pool.length) return null;
    if (pool.length === 1) return pool[0];
    if (moveNear) {
      const booked = pool.filter((j) => (j.stage === 'booked' || j.stage === 'cancelled') && j.moveDate);
      const near = (booked.length ? booked : pool.filter((j) => j.moveDate)).sort((a, b) => Math.abs(dayNumber(a.moveDate!) - dayNumber(moveNear)) - Math.abs(dayNumber(b.moveDate!) - dayNumber(moveNear)));
      if (near.length) return near[0];
    }
    if (!onDate) return pool[pool.length - 1];
    // Several work requests with the same title (repeat customers): the latest created on or before the date.
    const before = pool.filter((j) => !j.createdOn || j.createdOn <= onDate).sort((a, b) => (a.createdOn ?? '').localeCompare(b.createdOn ?? ''));
    return before.at(-1) ?? pool[0];
  };

  // Each work order belongs to exactly ONE work request: a repeat customer's work requests often
  // share a title, so the booked one whose move date is nearest the work order's start is the one.
  for (const r of woRows) {
    const job = findJob(r['Work Request'] ?? '', r['Contact Name'] ?? '', day(r['Created At']) ?? day(r['Start Date']), day(r['Start Date']));
    if (!job) {
      issue('work orders with no matching work request (their row is in the report only)');
      continue;
    }
    job.workOrders.push(workOrderOf(r));
    job.workOrderSids.push(r['WO ID']);
    const created = day(r['Created At']);
    if (created && (!job.bookedOn || created < job.bookedOn)) job.bookedOn = created;
  }
  for (const job of jobs) {
    for (const w of job.workOrders.filter((w) => !w.cancelled)) {
      for (const d of w.days) job.dayNotes[d] = [job.dayNotes[d], w.note].filter(Boolean).join(' · ');
    }
    job.days = Object.keys(job.dayNotes).sort();
    // A booked move's date is its first work-order day (the calendar and lists must agree).
    if (job.days.length) job.moveDate = job.days[0];
    if (job.stage === 'booked' && job.workOrders.length > 0 && job.workOrders.every((w) => w.cancelled)) job.stage = 'cancelled';
    if (!job.workOrders.length && job.stage === 'booked') issue('closed-won work requests with no work order found');
  }

  /**
   * An estimate whose work request title matches nothing (Movegistics renamed the work request, or
   * the estimate was made from the contact): the contact's own work request (the latest made on or
   * before the estimate, else the earliest), else a placeholder work request so it is never dropped.
   */
  const estimateFallbackJob = (r: Row, createdOn: string | null): NJob => {
    const named = byName.get(normName(r['Contacts'] ?? '')) ?? [];
    const contactJobs = named.length === 1 ? jobs.filter((j) => j.contactSid === named[0].sid && !j.placeholder) : [];
    if (contactJobs.length) {
      issue('estimates linked to their contact\'s work request (the work request title did not match)');
      const before = contactJobs.filter((j) => !createdOn || !j.createdOn || j.createdOn <= createdOn).sort((a, b) => (a.createdOn ?? '').localeCompare(b.createdOn ?? ''));
      return before.at(-1) ?? [...contactJobs].sort((a, b) => (a.createdOn ?? '').localeCompare(b.createdOn ?? ''))[0];
    }
    const { first, last } = splitName(r['Contacts'] ?? '');
    const contact = contactFor({ email: null, phone: null, first, last, sid: r['Estimate ID'], createdOn }, 'estimate');
    const service = SERVICE[(r['Service Type'] ?? 'local').toLowerCase()] ?? SERVICE.local;
    const job: NJob = {
      sid: `estimate-job:${r['Estimate ID']}`, title: r['Work Request Title'] || `Estimate ${r['Estimate ID']}`, contactSid: contact.sid, moveDate: day(r['Move Date']), tentative: false,
      origin: null, destination: null, serviceType: service.serviceType, jobType: (r['Service Type'] ?? '').toLowerCase() === 'commercial' ? 'Commercial Move' : service.jobType,
      stage: 'estimate_sent', lostReason: null, source: 'Other', sourceDetail: 'Imported estimate without a matching work request', ownerName: ownerName(r['Estimate Owner']),
      createdOn, amountCents: cents(r['Estimate Amount']), sections: {}, bookedOn: null, days: [], workOrderSids: [], customerComments: null, internalNotes: null, placeholder: true,
      dayNotes: {}, workOrders: [], bedrooms: null, companyName: blank(r['Company Name']), rating: null, coordinators: [], raw: {},
    };
    jobs.push(job);
    jobByTitle.set(normName(job.title), [...(jobByTitle.get(normName(job.title)) ?? []), job]);
    issue('estimates with no work request for their contact (a placeholder work request was made)');
    followups.estimatesOnPlaceholder.push(r['Estimate ID']);
    return job;
  };

  // ---- estimates: versions per job; at most one in force (the platform allows only one)
  const estimates: NEstimate[] = [];
  const estimateRows = parseCsv(files.estimates).map((r) => ({ r, createdOn: day(r['Created Date']) }));
  estimateRows.sort((a, b) => (a.createdOn ?? '').localeCompare(b.createdOn ?? '') || a.r['Estimate ID'].localeCompare(b.r['Estimate ID'], 'en', { numeric: true }));
  const perJob = new Map<string, NEstimate[]>();
  const seenEstimates = new Set<string>();
  for (const { r, createdOn } of estimateRows) {
    if (seenEstimates.has(r['Estimate ID'])) {
      issue('duplicate estimate ids in the export (second copy skipped)');
      continue;
    }
    seenEstimates.add(r['Estimate ID']);
    const estimateStatus = strict(ESTIMATE_STATUS, r['Status'], 'estimate Status', unknown);
    if (!estimateStatus) continue;
    let job = findJob(r['Work Request Title'] ?? '', r['Contacts'] ?? '', createdOn);
    if (!job) job = estimateFallbackJob(r, createdOn);
    const list = perJob.get(job.sid) ?? [];
    const e: NEstimate = {
      sid: r['Estimate ID'], jobSid: job.sid, version: list.length + 1, status: estimateStatus,
      amountCents: cents(r['Estimate Amount']), createdByName: ownerName(r['Estimate Owner']), createdOn, expiresOn: day(r['Expiration Date']), voidReason: null, raw: rawOf(r),
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

  // A placeholder made for estimates is open while one is in force, otherwise lost.
  for (const job of jobs.filter((j) => j.sid.startsWith('estimate-job:'))) {
    const live = (perJob.get(job.sid) ?? []).some((e) => e.status === 'sent' || e.status === 'viewed' || e.status === 'signed');
    if (!live) {
      job.stage = 'lost';
      job.lostReason = 'Imported: the estimate was not in force and Movegistics named no work request for it';
    }
  }

  // ---- invoices
  const invoices: NInvoice[] = [];
  const seenInvoices = new Set<string>();
  for (const r of invRows) {
    if (seenInvoices.has(r['Invoice ID'])) {
      issue('duplicate invoice ids in the export (second copy skipped)');
      continue;
    }
    seenInvoices.add(r['Invoice ID']);
    const invoiceStatus = strict(INVOICE_STATUS, r['Status'], 'invoice Status', unknown);
    if (!invoiceStatus) continue;
    const invoiceDate = day(r['Invoice Date']) ?? day(r['Created Date'])!;
    const email = normEmail(r['Contact Email']);
    const phone = normPhone(r['Contact Phone']);
    let job = findJob(r['Work Request Title'] ?? '', r['Contact Name'] ?? '', invoiceDate, invoiceDate);
    if (!job) {
      const { first, last } = splitName(r['Contact Name'] ?? '');
      const contact = contactFor({ email, phone, first, last, sid: r['Invoice ID'], createdOn: invoiceDate }, 'invoice');
      job = {
        sid: `invoice-job:${r['Invoice ID']}`, title: r['Work Request Title'] || `Invoice ${r['Invoice ID']}`, contactSid: contact.sid, moveDate: invoiceDate, tentative: false,
        origin: null, destination: null, serviceType: 'local', jobType: 'Local Full Service Move', stage: 'booked', lostReason: null, source: 'Other',
        sourceDetail: 'Imported invoice without a matching work request', ownerName: ownerName(r['Invoice Owner']), createdOn: invoiceDate, amountCents: cents(r['Invoice Amount']),
        sections: {}, bookedOn: null, days: [], workOrderSids: [], customerComments: null, internalNotes: null, placeholder: true,
        dayNotes: {}, workOrders: [], bedrooms: null, companyName: blank(r['Company Name']), rating: null, coordinators: [], raw: {},
      };
      jobs.push(job);
      issue('invoices with no matching work request (a placeholder work request was made)');
    }
    const amount = cents(r['Invoice Amount']);
    // Movegistics leaves "Balance Due" at the full amount on many invoices it marks PAID (281 in
    // 2025, nearly all fully covered by payments in its own payments export): PAID means $0 due.
    const status = invoiceStatus;
    const exported = Math.max(0, Math.min(cents(r['Balance Due']), amount));
    if (status === 'paid' && exported > 0) issue('PAID invoices whose exported "Balance Due" was not zero (treated as fully paid)');
    const balance = status === 'paid' || status === 'void' ? 0 : exported;
    invoices.push({
      sid: r['Invoice ID'], jobSid: job.sid, contactSid: job.contactSid, status, amountCents: amount, balanceCents: balance,
      invoiceDate, dueDate: day(r['Due Date']) ?? invoiceDate, ownerName: ownerName(r['Invoice Owner']), poNumber: blank(r['PO Number']),
      depositCreditCents: 0, raw: rawOf(r),
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
  const seenPayments = new Set<string>();
  for (const r of parseCsv(files.payments)) {
    if (seenPayments.has(r['Payment ID'])) {
      issue('duplicate payment ids in the export (second copy skipped)');
      continue;
    }
    seenPayments.add(r['Payment ID']);
    const tx = strict(PAYMENT_STATUS, r['Transaction Status'], 'payment Transaction Status', unknown);
    if (!tx) continue;
    if (tx === 'not_received') {
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
      // A deposit is paid on a move that went ahead: prefer the customer's booked work requests.
      const all = (jobsOfContact.get(contactSid) ?? []).filter((j) => !j.placeholder);
      const went = all.filter((j) => ['booked', 'completed', 'closed', 'cancelled'].includes(j.stage));
      const candidates = went.length ? went : all;
      // The move still ahead whose work request was made most recently before the payment (two
      // moves weeks apart: each deposit follows its own request); else the nearest move ahead.
      const upcoming = candidates.filter((j) => (j.moveDate ?? '9999') >= paidOn);
      const madeBefore = upcoming.filter((j) => j.createdOn && j.createdOn <= paidOn).sort((a, b) => (b.createdOn ?? '').localeCompare(a.createdOn ?? ''));
      const nearest = [...upcoming].sort((a, b) => (a.moveDate ?? '').localeCompare(b.moveDate ?? ''));
      jobSid = (madeBefore[0] ?? nearest[0] ?? candidates.sort((a, b) => (b.createdOn ?? '').localeCompare(a.createdOn ?? ''))[0])?.sid ?? null;
    }
    if (!contactSid) issue('payments whose contact name matches no single contact (imported without a customer)');
    else if (!jobSid) issue('payments not linked to any work request');
    const mode = (r['Payment Mode'] ?? '').toLowerCase();
    const override = overrides.refunds?.get(r['Payment ID']);
    let refundedCents = tx === 'refunded' ? amount : 0;
    if (tx === 'partial_refund') {
      if (override !== undefined && override <= amount) {
        refundedCents = override;
        issue('partially refunded payments with the amount from refund-amounts.csv');
      } else {
        if (override !== undefined) issue('refund-amounts.csv amounts larger than the payment (ignored)');
        issue('partially refunded payments (refund amount not in the export: recorded as not refunded)');
        followups.partialRefundsWithoutAmount.push(r['Payment ID']);
      }
    }
    const fee = cents(r['Convenience Fee']);
    const base = blank(r['Description']) ?? (invoice ? `Payment on ${invoice.sid}` : 'Deposit');
    payments.push({
      sid: r['Payment ID'], contactSid, invoiceSid: invoice?.sid ?? null, jobSid, isDeposit: !invoice && (r['Deposit'] ?? '').toLowerCase() === 'yes',
      amountCents: amount, refundedCents, partialRefund: tx === 'partial_refund',
      method: mode.startsWith('card') || mode.includes('shopify') ? 'card' : mode === 'cash' ? 'cash' : mode.startsWith('check') || mode.startsWith('cheque') ? 'check' : 'other', paidOn,
      cardBrand: blank(r['Card Type']), cardLast4: blank(r['Last 4 Digits Of Card']),
      description: [base, fee > 0 ? `incl. convenience fee $${(fee / 100).toFixed(2)}` : null, blank(r['Refund Reason']) ? `refund reason: ${blank(r['Refund Reason'])}` : null].filter(Boolean).join(' · '),
      raw: rawOf(r),
    });

  }
  if (unknown.size) {
    throw new UnknownValues(
      `Movegistics values this importer does not know (nothing was imported; add them to the maps in movegistics.ts on purpose): ${[...unknown].map(([k, v]) => `${k}: ${[...v].join(', ')}`).join('; ')}`,
    );
  }
  // ---- deposits: credited to the work request's invoices where Movegistics counts them as paid
  // (it often leaves the deposit "Unapplied" and still marks the invoice PAID).
  const netOf = (p: NPayment) => p.amountCents - p.refundedCents;
  const depositsLeft = new Map<string, number>();
  for (const p of payments) if (!p.invoiceSid && p.jobSid) depositsLeft.set(p.jobSid, (depositsLeft.get(p.jobSid) ?? 0) + netOf(p));
  const paidAgainst = new Map<string, number>();
  for (const p of payments) if (p.invoiceSid) paidAgainst.set(p.invoiceSid, (paidAgainst.get(p.invoiceSid) ?? 0) + netOf(p));
  // Movegistics often leaves an invoice "Sent" / "Partially paid", its Balance Due untouched, after
  // the payments recorded AGAINST THAT INVOICE (by invoice number) already cover it. The money is
  // the truth: covered in full = paid; partly covered = the balance those payments leave.
  for (const inv of invoices) {
    if (inv.status === 'paid' || inv.status === 'void') continue;
    const paidOn = paidAgainst.get(inv.sid) ?? 0;
    const left = Math.max(0, inv.amountCents - paidOn);
    if (left <= 1) {
      inv.status = 'paid';
      inv.balanceCents = 0;
      issue('open invoices whose own payments cover them in full (imported as paid)');
    } else if (inv.balanceCents > left) {
      inv.balanceCents = left;
      if (inv.status !== 'draft') inv.status = 'partially_paid';
      issue('open invoices whose Balance Due ignored payments recorded against them (balance lowered to what is left)');
    }
  }
  for (const inv of [...invoices].sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.sid.localeCompare(b.sid))) {
    if (inv.status === 'void') continue;
    const received = inv.amountCents - inv.balanceCents; // what Movegistics counts as paid
    const shortfall = Math.max(0, received - (paidAgainst.get(inv.sid) ?? 0));
    const credit = Math.min(shortfall, depositsLeft.get(inv.jobSid) ?? 0);
    if (credit > 0) {
      inv.depositCreditCents = credit;
      depositsLeft.set(inv.jobSid, (depositsLeft.get(inv.jobSid) ?? 0) - credit);
      if (inv.status === 'paid') issue('PAID invoices covered by their work request\'s deposit (credited to the invoice)');
    }
    if (inv.status === 'paid' && shortfall - credit > 1) {
      issue('PAID invoices still not covered by any payment in the export (listed by id below)');
      followups.paidInvoicesNotCovered.push(inv.sid);
    }
  }

  // Deposits still left on a work request after that go to its OPEN invoices, oldest first:
  // Movegistics leaves them "Unapplied" and its Balance Due ignores them, so the customer would be
  // shown owing money they already paid. Covered in full = paid.
  const openDepositCredits = new Map<string, number>();
  for (const inv of [...invoices].sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.sid.localeCompare(b.sid))) {
    if (inv.status === 'paid' || inv.status === 'void' || inv.balanceCents <= 0) continue;
    const credit = Math.min(inv.balanceCents, depositsLeft.get(inv.jobSid) ?? 0);
    if (credit <= 0) continue;
    depositsLeft.set(inv.jobSid, (depositsLeft.get(inv.jobSid) ?? 0) - credit);
    inv.depositCreditCents += credit;
    inv.balanceCents -= credit;
    openDepositCredits.set(inv.sid, credit);
    if (inv.balanceCents <= 1) {
      inv.balanceCents = 0;
      inv.status = 'paid';
      issue("open invoices paid off by their work request's unapplied deposit (imported as paid)");
    } else {
      if (inv.status === 'sent') inv.status = 'partially_paid';
      issue("open invoices lowered by their work request's unapplied deposit");
    }
  }
  // Still open more than a year after it was due: almost certainly settled outside Movegistics (or
  // written off). Never guessed: listed by id for a manager to check, and counted as open.
  if (overrides.today) {
    const yearAgo = `${Number(overrides.today.slice(0, 4)) - 1}${overrides.today.slice(4)}`;
    followups.staleOpenInvoices = invoices.filter((i) => i.status !== 'paid' && i.status !== 'void' && i.balanceCents > 0 && i.dueDate < yearAgo).map((i) => i.sid);
    if (followups.staleOpenInvoices.length) issues['open invoices more than a year past due (listed by id: check in Movegistics whether they were paid)'] = followups.staleOpenInvoices.length;
  }
  // ...and a work request whose invoices are now all paid is closed.
  for (const job of jobs) {
    const list = invoicesOf.get(job.sid);
    if (!list?.length || job.stage === 'lost' || job.stage === 'cancelled') continue;
    job.stage = list.every((i) => i.status === 'paid') ? 'closed' : 'completed';
  }
  return { contacts, leads, jobs, estimates, invoices, payments, issues, followups, openDepositCredits };
}
