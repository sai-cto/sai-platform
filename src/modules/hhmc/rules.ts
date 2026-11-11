/**
 * HHMC business rules as plain functions (no database). Each cites the part of
 * docs/hhmc-analysis/movegistics-reference.md ("ref") or the Phase 5 build prompt ("prompt")
 * it implements. Money rules live in services/pricing.ts.
 */
import type {
  EstimateStatus,
  InvoiceStatus,
  InvoiceTerms,
  LeadStatus,
  ServiceType,
  Stage,
} from './schema';

// ---------------------------------------------------------------- labels

export const STAGE_LABELS: Record<Stage, string> = {
  qualified: 'Qualified',
  estimate_sent: 'Estimate Sent',
  booked: 'Booked',
  completed: 'Completed',
  closed: 'Closed',
  lost: 'Lost',
  cancelled: 'Cancelled',
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  disqualified: 'Disqualified',
  converted: 'Converted',
};

export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  signed: 'Signed',
  void: 'Void',
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Partially Paid',
  paid: 'Paid',
  void: 'Void',
};

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  local: 'Local',
  intrastate: 'Intrastate',
  interstate: 'Interstate',
};

export const TERMS_LABELS: Record<InvoiceTerms, string> = {
  due_on_receipt: 'Due On Receipt',
  net_7: 'Net 7',
  net_15: 'Net 15',
  net_30: 'Net 30',
  net_60: 'Net 60',
};

/** R-JOB-TYPES — job types by service type (ref §9.1). */
export const JOB_TYPES: Record<ServiceType, string[]> = {
  local: [
    'Local Full Service Move',
    'Local with Storage',
    'Onsite Labor Only',
    'Commercial Move',
    'Junk Removal',
    'Packing',
  ],
  intrastate: ['Intrastate Move'],
  interstate: ['Interstate Move'],
};

export function isJobTypeFor(serviceType: ServiceType, jobType: string): boolean {
  return JOB_TYPES[serviceType].includes(jobType);
}

/** Bedrooms picklist (ref §3.2). */
export const BEDROOMS = [
  'None',
  'Studio',
  '1 bedroom',
  '2 bedrooms',
  '3 bedrooms',
  '4 bedrooms',
  '5+ bedrooms',
];

export const CALL_OUTCOME_LABELS = {
  spoke: 'Spoke to customer',
  voicemail: 'Left voicemail',
  ringcentral: 'RingCentral call',
} as const;

// ---------------------------------------------------------------- job stage (one function)

/**
 * R-STAGE — every allowed move of a job's stage (prompt "Stage is a single field"; ref §2.1
 * steps 2–14 collapsed into one record). Anything not listed is refused.
 *
 *   Qualified → Estimate Sent          an estimate is sent
 *   Estimate Sent → Qualified          the only live estimate is voided
 *   Estimate Sent → Booked             staff book (needs a signed estimate)
 *   Booked → Estimate Sent             Release Booking
 *   Booked → Completed                 the invoice is created from actual hours
 *   Completed → Closed                 the invoice is paid in full
 *   Qualified | Estimate Sent → Lost   with a reason
 *   Qualified | Estimate Sent | Booked → Cancelled   with a reason
 *   Lost → Qualified                   reopen
 */
const STAGE_MOVES: Record<Stage, Stage[]> = {
  qualified: ['estimate_sent', 'lost', 'cancelled'],
  estimate_sent: ['qualified', 'booked', 'lost', 'cancelled'],
  booked: ['estimate_sent', 'completed', 'cancelled'],
  completed: ['closed'],
  closed: [],
  lost: ['qualified'],
  cancelled: [],
};

export function canMoveStage(from: Stage, to: Stage): boolean {
  return STAGE_MOVES[from].includes(to);
}

export function stageMoveProblem(from: Stage, to: Stage): string | null {
  if (from === to) return null;
  return canMoveStage(from, to)
    ? null
    : `A job that is ${STAGE_LABELS[from]} cannot become ${STAGE_LABELS[to]}.`;
}

/** Stages where the quote can still change (once booked, the signed estimate is the price). */
export function quoteEditable(stage: Stage): boolean {
  return stage === 'qualified' || stage === 'estimate_sent';
}

// ---------------------------------------------------------------- leads

/** R-LEAD — New → Disqualified | Converted; Disqualified → New (ref §2.2, prompt "Statuses"). */
export function leadMoveProblem(from: LeadStatus, to: LeadStatus): string | null {
  const allowed: Record<LeadStatus, LeadStatus[]> = {
    new: ['disqualified', 'converted'],
    disqualified: ['new'],
    converted: [],
  };
  if (from === to) return null;
  return allowed[from].includes(to)
    ? null
    : `A ${LEAD_STATUS_LABELS[from].toLowerCase()} lead cannot become ${LEAD_STATUS_LABELS[to].toLowerCase()}.`;
}

export function normalizePhone(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

type Person = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
};

/**
 * R-DUP — a lead reuses an existing customer when email or phone matches (prompt; ref §10
 * "duplicate contacts"). Returns the matching customer, preferring an email match.
 */
export function findMatchingCustomer<T extends Person & { id: string }>(
  lead: Person,
  customers: T[],
): T | null {
  const email = normalizeEmail(lead.email);
  const phone = normalizePhone(lead.phone);
  if (email) {
    const byEmail = customers.find((c) => normalizeEmail(c.email) === email);
    if (byEmail) return byEmail;
  }
  if (phone.length >= 7) {
    const byPhone = customers.find((c) => normalizePhone(c.phone) === phone);
    if (byPhone) return byPhone;
  }
  return null;
}

/** R-DUP — a probable duplicate: same first and last name, but neither email nor phone matched. */
export function probableDuplicates<T extends Person & { id: string }>(
  lead: Person,
  customers: T[],
): T[] {
  const name = (p: Person) => `${p.firstName} ${p.lastName}`.trim().toLowerCase();
  const target = name(lead);
  if (!target) return [];
  return customers.filter((c) => name(c) === target);
}

// ---------------------------------------------------------------- estimates

/** R-EST — estimates still in force (never two at once per job, prompt "Quote"). */
export function isLiveEstimate(status: EstimateStatus): boolean {
  return status === 'sent' || status === 'viewed' || status === 'signed';
}

/** R-EST — only an unsigned live estimate may be voided (ref §2.2 statuses). */
export function canVoidEstimate(status: EstimateStatus): boolean {
  return status === 'sent' || status === 'viewed' || status === 'draft';
}

export function canSignEstimate(status: EstimateStatus, expiresAt: Date | null, now: Date): string | null {
  if (status === 'signed') return 'This estimate is already signed.';
  if (status !== 'sent' && status !== 'viewed') return 'This estimate can no longer be signed.';
  if (expiresAt && expiresAt.getTime() <= now.getTime())
    return 'This estimate has expired. Ask us for a new one.';
  return null;
}

/** R-READY — signed AND deposit paid shows "Ready to book"; booking stays manual (ref §11 Q3). */
export function isReadyToBook(stage: Stage, estimate: { status: EstimateStatus; depositPaidCents: number } | null): boolean {
  return stage === 'estimate_sent' && estimate?.status === 'signed' && estimate.depositPaidCents > 0;
}

// ---------------------------------------------------------------- invoices

/** R-INV-DUE — due date from terms (ref §7.1). Dates are "yyyy-mm-dd". */
export function dueDateFor(invoiceDate: string, terms: InvoiceTerms): string {
  const days = { due_on_receipt: 0, net_7: 7, net_15: 15, net_30: 30, net_60: 60 }[terms];
  return addDays(invoiceDate, days);
}

/** R-INV-STATUS — the status a sent invoice has after payments (ref §2.2: Partially Paid → Paid). */
export function invoiceStatusAfterPayment(balanceCents: number, paidAnything: boolean): InvoiceStatus {
  if (balanceCents <= 0) return 'paid';
  return paidAnything ? 'partially_paid' : 'sent';
}

export function isPastDue(status: InvoiceStatus, dueDate: string, today: string): boolean {
  return (status === 'sent' || status === 'partially_paid') && dueDate < today;
}

// ---------------------------------------------------------------- dates

export function isDateText(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today's date in a time zone, "yyyy-mm-dd". */
export function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** The instant of a local wall-clock time ("2026-11-12", "08:30") in a time zone. */
export function localTime(day: string, time: string, timeZone: string): Date {
  const [h, m] = time.split(':').map(Number);
  const guess = new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  // Find the zone's offset at that moment and correct for it (twice, for clock changes).
  let result = guess;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(result);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    result = new Date(guess.getTime() - (asUtc - result.getTime()));
  }
  return result;
}

export function isTimeText(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

// ---------------------------------------------------------------- templates

/** Fills {{name}} placeholders (ref §9.1 "merge fields"). Unknown names are left empty. */
export function renderTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => values[key] ?? '');
}

// ---------------------------------------------------------------- automations

/**
 * R-AUTO-CANCEL — should a queued email still go out? Checked when it is due (prompt
 * "Automations": a drip is cancelled when the job leaves Estimate Sent, when the estimate is
 * signed, or when opt-in is off).
 */
export function automationStillWanted(input: {
  trigger: string;
  respectsOptIn: boolean;
  jobStage?: Stage | null;
  jobOptIn?: boolean | null;
  estimateStatus?: EstimateStatus | null;
  leadStatus?: LeadStatus | null;
  invoiceStatus?: InvoiceStatus | null;
}): { ok: true } | { ok: false; reason: string } {
  if (input.respectsOptIn && input.jobOptIn === false)
    return { ok: false, reason: 'Automation opt-in is off for this job.' };
  switch (input.trigger) {
    case 'estimate_sent':
      if (input.jobStage !== 'estimate_sent') return { ok: false, reason: 'The job left Estimate Sent.' };
      if (input.estimateStatus !== 'sent' && input.estimateStatus !== 'viewed')
        return { ok: false, reason: `The estimate is ${input.estimateStatus ?? 'gone'}.` };
      return { ok: true };
    case 'lead_no_contact':
      return input.leadStatus === 'new' ? { ok: true } : { ok: false, reason: `The lead is ${input.leadStatus ?? 'gone'}.` };
    case 'job_booked':
      return input.jobStage === 'booked' || input.jobStage === 'completed' || input.jobStage === 'closed'
        ? { ok: true }
        : { ok: false, reason: 'The booking was released.' };
    case 'invoice_sent':
      return input.invoiceStatus === 'sent' || input.invoiceStatus === 'partially_paid'
        ? { ok: true }
        : { ok: false, reason: `The invoice is ${input.invoiceStatus ?? 'gone'}.` };
    default:
      return { ok: true };
  }
}
