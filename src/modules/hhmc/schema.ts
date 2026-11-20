/**
 * HHMC tables. Only what the core lacks (docs/hhmc-analysis/PLAN.md §1): customers, payments,
 * appointments, trucks (resources), sold-out dates (unavailability), emails (notifications)
 * and documents (files) are the core's own tables. Every table is a tenantTable(); links
 * between tenant tables use sameTenant().
 */
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { customers, files, notifications, payments } from '@/core/db/schema/tenant';
import { sameTenant, tenantTable } from '@/core/db/tenant-table';
import type { SectionKey } from './services/pricing';

// ---------------------------------------------------------------- settings data

export type CatalogCategory =
  | 'Move Charges'
  | 'Equipment'
  | 'Packing Materials'
  | 'Packing Labor'
  | 'Storage Charges'
  | 'Additional Services'
  | 'Valuation'
  | 'Crating';

/** The line-item catalog and its rates (ref §4.1). One list replaces Line Items + Packing Materials. */
export const hhmcCatalogItems = tenantTable('hhmc_catalog_items', {
  name: text('name').notNull(),
  category: text('category').$type<CatalogCategory>().notNull(),
  /** The quote section this item lands in (ref §4.1 "Categories → pricing section"). */
  section: text('section').$type<SectionKey>().notNull(),
  /** "hour", "day", "mile", "each", "lb" … */
  unit: text('unit').notNull(),
  rateCents: integer('rate_cents').notNull(),
  /** Added automatically to a new Local job's quote (ref §4.1: 16' Truck Local). */
  isDefaultForLocal: boolean('is_default_for_local').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

/** Discounts staff can pick on a line (ref §4.3: 3 × 5%). */
export const hhmcDiscounts = tenantTable('hhmc_discounts', {
  name: text('name').notNull(),
  /** Basis points: 5% = 500. */
  percentBp: integer('percent_bp').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export type TemplateKind = 'terms' | 'email';

/** Terms & Conditions per service type, and the email templates (ref §9.1, §7.3). */
export const hhmcTemplates = tenantTable(
  'hhmc_templates',
  {
    key: text('key').notNull(),
    kind: text('kind').$type<TemplateKind>().notNull(),
    name: text('name').notNull(),
    subject: text('subject').notNull().default(''),
    body: text('body').notNull(),
  },
  (t) => [
    uniqueIndex('hhmc_templates_key')
      .on(t.businessId, t.environment, t.key)
      .where(sql`${t.archivedAt} is null`),
  ],
);

// ---------------------------------------------------------------- leads

export const LEAD_SOURCES = [
  'Google',
  'Website',
  'Referral',
  'Repeat Customer',
  'Cornellian',
  'Social',
  'Third-party',
  'Other',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export type LeadStatus = 'new' | 'disqualified' | 'converted';
export type Rating = 'hot' | 'warm' | 'cold';

export const hhmcLeads = tenantTable(
  'hhmc_leads',
  {
    leadNumber: text('lead_number').notNull(),
    firstName: text('first_name').notNull().default(''),
    lastName: text('last_name').notNull().default(''),
    email: text('email'),
    phone: text('phone'),
    source: text('source').$type<LeadSource>().notNull().default('Other'),
    sourceDetail: text('source_detail'),
    moveDate: date('move_date'),
    moveType: text('move_type').$type<'residential' | 'commercial'>().notNull().default('residential'),
    storage: boolean('storage').notNull().default(false),
    bedrooms: text('bedrooms'),
    originAddress: text('origin_address'),
    destinationAddress: text('destination_address'),
    ownerName: text('owner_name'),
    rating: text('rating').$type<Rating>(),
    customerNote: text('customer_note'),
    internalNote: text('internal_note'),
    status: text('status').$type<LeadStatus>().notNull().default('new'),
    disqualifiedReason: text('disqualified_reason'),
    disqualifiedAt: timestamp('disqualified_at', { withTimezone: true }),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    /** The customer this lead became (set on conversion). */
    customerId: uuid('customer_id'),
    /** When staff started the "couldn't reach you" emails (ref §9.2). */
    noContactStartedAt: timestamp('no_contact_started_at', { withTimezone: true }),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    gclid: text('gclid'),
    fbclid: text('fbclid'),
  },
  (t) => [
    sameTenant('hhmc_leads_customer_fk', t, t.customerId, customers),
    uniqueIndex('hhmc_leads_number').on(t.businessId, t.environment, t.leadNumber),
    // Lookups by a parent id lead with business_id only: under row-level security the environment
    // (an enum) cannot be an index condition, so (business, environment, x) indexes scan a whole business.
    index('hhmc_leads_customer_idx').on(t.businessId, t.customerId),
  ],
);

// ---------------------------------------------------------------- jobs

export const STAGES = [
  'qualified',
  'estimate_sent',
  'booked',
  'completed',
  'closed',
  'lost',
  'cancelled',
] as const;
export type Stage = (typeof STAGES)[number];
export const SERVICE_TYPES = ['local', 'intrastate', 'interstate'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const ACCESS_FLAGS = ['stairs', 'elevator', 'long_carry', 'split_load', 'fragile', 'unusual_items'] as const;
export type AccessFlag = (typeof ACCESS_FLAGS)[number];

/** The one record per move: replaces Movegistics' Work Request AND Work Order (ref §10). */
export const hhmcJobs = tenantTable(
  'hhmc_jobs',
  {
    jobNumber: text('job_number').notNull(),
    customerId: uuid('customer_id').notNull(),
    leadId: uuid('lead_id'),
    companyName: text('company_name'),
    poNumber: text('po_number'),
    originAddress: text('origin_address'),
    destinationAddress: text('destination_address'),
    extraStops: text('extra_stops').array().$type<string[]>().notNull().default(sql`'{}'::text[]`),
    moveDate: date('move_date'),
    tentative: boolean('tentative').notNull().default(false),
    arrivalWindow: text('arrival_window'),
    serviceType: text('service_type').$type<ServiceType>().notNull().default('local'),
    jobType: text('job_type').notNull(),
    bedrooms: text('bedrooms'),
    crewSize: integer('crew_size').notNull().default(2),
    trucks: integer('trucks').notNull().default(1),
    /** Specific trucks picked for this move (core resources of kind "truck"). Booking takes these
     *  first; the truck lines on a new quote follow their sizes. Empty = any free truck. */
    truckIds: uuid('truck_ids').array().$type<string[]>().notNull().default(sql`'{}'::uuid[]`),
    customerComments: text('customer_comments'),
    scopeOfWork: text('scope_of_work'),
    internalNotes: text('internal_notes'),
    ownerName: text('owner_name'),
    coordinators: text('coordinators').array().$type<string[]>().notNull().default(sql`'{}'::text[]`),
    rating: text('rating').$type<Rating>(),
    automationOptIn: boolean('automation_opt_in').notNull().default(true),
    /** Copied from the lead (or set by staff) so revenue can be counted by source. */
    source: text('source').$type<LeadSource>().notNull().default('Other'),
    sourceDetail: text('source_detail'),
    stage: text('stage').$type<Stage>().notNull().default('qualified'),
    lostReason: text('lost_reason'),
    cancelledReason: text('cancelled_reason'),
    bookedAt: timestamp('booked_at', { withTimezone: true }),
    // ---- Estimate builder inputs (managers' requirements, Nov 2026) ----
    /** Road distance origin → destination, in tenths of a mile (283.4 mi = 2834). */
    distanceTenths: integer('distance_tenths'),
    /** Drive time origin → destination, minutes. */
    driveMinutes: integer('drive_minutes'),
    /** Where the distance came from: the maps adapter, or typed in by staff. */
    distanceSource: text('distance_source').$type<'maps' | 'manual'>(),
    /** The customer brings their own truck: labor only, no truck fee. */
    ownTruck: boolean('own_truck').notNull().default(false),
    /** Cornellian: the per-hour labor discount applies (setting, $20/hr). */
    cornellian: boolean('cornellian').notNull().default(false),
    /** Access at each end: stairs, elevator, split load, fragile or unusual items. */
    originAccess: text('origin_access').array().$type<AccessFlag[]>().notNull().default(sql`'{}'::text[]`),
    destinationAccess: text('destination_access').array().$type<AccessFlag[]>().notNull().default(sql`'{}'::text[]`),
    originNotes: text('origin_notes'),
    destinationNotes: text('destination_notes'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    // ---- Service type from the addresses (managers' feedback round 1, Nov 2026) ----
    /** 'auto': the service type follows the addresses; 'manual': a manager chose it (logged). */
    serviceTypeSource: text('service_type_source').$type<'auto' | 'manual'>().notNull().default('auto'),
    /** What the addresses (and the route, when checked) say the service type is. */
    suggestedServiceType: text('suggested_service_type').$type<ServiceType>(),
    /** The states the driving route passes through (two-letter codes), when it was checked. */
    routeStates: text('route_states').array().$type<string[]>().notNull().default(sql`'{}'::text[]`),
    /** False: the route was not checked with Google Maps (decided by the addresses' states only). */
    routeChecked: boolean('route_checked').notNull().default(false),
  },
  (t) => [
    sameTenant('hhmc_jobs_customer_fk', t, t.customerId, customers),
    sameTenant('hhmc_jobs_lead_fk', t, t.leadId, hhmcLeads),
    uniqueIndex('hhmc_jobs_number').on(t.businessId, t.environment, t.jobNumber),
    index('hhmc_jobs_stage_idx').on(t.businessId, t.environment, t.stage),
    index('hhmc_jobs_customer_idx').on(t.businessId, t.customerId),
    index('hhmc_jobs_lead_idx').on(t.businessId, t.leadId),
    index('hhmc_jobs_move_date_idx').on(t.businessId, t.moveDate),
  ],
);

/**
 * One day of a move. When the job is booked, each day books core appointments (one per
 * truck, subject "hhmc.job_day"); releasing the booking cancels them.
 */
export const hhmcJobDays = tenantTable(
  'hhmc_job_days',
  {
    jobId: uuid('job_id').notNull(),
    dayDate: date('day_date').notNull(),
    /** "08:00" in the business's time zone. */
    startTime: text('start_time').notNull().default('08:00'),
    durationMinutes: integer('duration_minutes').notNull().default(240),
    crewSize: integer('crew_size').notNull(),
    trucks: integer('trucks').notNull(),
    notes: text('notes'),
    /** Actual time worked, entered after the job (feeds the invoice). */
    actualMinutes: integer('actual_minutes'),
  },
  (t) => [sameTenant('hhmc_job_days_job_fk', t, t.jobId, hhmcJobs), index('hhmc_job_days_job_idx').on(t.businessId, t.jobId), index('hhmc_job_days_day_idx').on(t.businessId, t.dayDate)],
);

// ---------------------------------------------------------------- quote

/** Exactly one per job (unique index). Its lines are the only editable copy of the price. */
export const hhmcQuotes = tenantTable(
  'hhmc_quotes',
  {
    jobId: uuid('job_id').notNull(),
    serviceTaxOn: boolean('service_tax_on').notNull().default(false),
    convenienceFeeOn: boolean('convenience_fee_on').notNull().default(true),
  },
  (t) => [
    sameTenant('hhmc_quotes_job_fk', t, t.jobId, hhmcJobs),
    uniqueIndex('hhmc_quotes_one_per_job').on(t.businessId, t.environment, t.jobId),
    index('hhmc_quotes_job_idx').on(t.businessId, t.jobId),
  ],
);

export type DiscountType = 'percent' | 'amount';

export const hhmcQuoteLines = tenantTable(
  'hhmc_quote_lines',
  {
    quoteId: uuid('quote_id').notNull(),
    section: text('section').$type<SectionKey>().notNull(),
    catalogItemId: uuid('catalog_item_id'),
    name: text('name').notNull(),
    unit: text('unit').notNull().default('each'),
    /** Quantity × 100 (2.5 hours = 250). */
    qtyHundredths: integer('qty_hundredths').notNull(),
    rateCents: integer('rate_cents').notNull(),
    discountType: text('discount_type').$type<DiscountType>(),
    /** Basis points for a %, cents for a $ discount. */
    discountValue: integer('discount_value'),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    sameTenant('hhmc_quote_lines_quote_fk', t, t.quoteId, hhmcQuotes),
    sameTenant('hhmc_quote_lines_item_fk', t, t.catalogItemId, hhmcCatalogItems),
    index('hhmc_quote_lines_quote_idx').on(t.businessId, t.quoteId),
  ],
);

// ---------------------------------------------------------------- estimates

export type EstimateStatus = 'draft' | 'sent' | 'viewed' | 'signed' | 'void';

/** What the customer saw and signed: frozen when the estimate is sent. */
export type EstimateSnapshot = {
  title: string;
  customerName: string;
  customerEmail: string | null;
  originAddress: string | null;
  destinationAddress: string | null;
  extraStops: string[];
  moveDate: string | null;
  arrivalWindow: string | null;
  serviceType: ServiceType;
  jobType: string;
  crewSize: number;
  trucks: number;
  scopeOfWork: string | null;
  lines: {
    section: SectionKey;
    name: string;
    unit: string;
    qtyHundredths: number;
    rateCents: number;
    discountType: DiscountType | null;
    discountValue: number | null;
    totalCents: number;
    description: string | null;
  }[];
  sections: Record<SectionKey, number>;
  serviceTaxOn: boolean;
  convenienceFeeOn: boolean;
  serviceTaxBp: number;
  convenienceFeeBp: number;
  depositBp: number;
  termsTitle: string;
  termsBody: string;
  /** The full Terms & Conditions PDF shown with this estimate (Settings › Documents), if one was on file. */
  termsPdf?: { fileId: string; filename: string; version: string } | null;
  valuation: string;
};

/** An immutable, versioned snapshot of the quote (ref §10: "one quote with versioned estimates"). */
export const hhmcEstimates = tenantTable(
  'hhmc_estimates',
  {
    jobId: uuid('job_id').notNull(),
    estimateNumber: text('estimate_number').notNull(),
    version: integer('version').notNull(),
    status: text('status').$type<EstimateStatus>().notNull(),
    snapshot: jsonb('snapshot').$type<EstimateSnapshot>().notNull(),
    subtotalCents: integer('subtotal_cents').notNull(),
    serviceTaxCents: integer('service_tax_cents').notNull(),
    convenienceFeeCents: integer('convenience_fee_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    /** deposit % × (subtotal + tax), before any card fee. */
    depositCents: integer('deposit_cents').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    valuationInitials: text('valuation_initials'),
    signatureName: text('signature_name'),
    signedIp: text('signed_ip'),
    signedUserAgent: text('signed_user_agent'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
    /** The deposit payment (core payments), once paid. */
    depositPaymentId: uuid('deposit_payment_id'),
    /** Deposit plus the card fee paid on it. */
    depositPaidCents: integer('deposit_paid_cents').notNull().default(0),
    /** The estimate document stored through the core's files. */
    documentFileId: uuid('document_file_id'),
    /** Who made this estimate, by name (managers: "you can always tell who made which estimate").
     *  The signed-in staff member when sent here; the Movegistics creator when imported. */
    createdByName: text('created_by_name'),
    /** The Terms & Conditions version shown when the customer signed (PDF version, or "no PDF on file"). */
    signedTermsVersion: text('signed_terms_version'),
  },
  (t) => [
    sameTenant('hhmc_estimates_job_fk', t, t.jobId, hhmcJobs),
    sameTenant('hhmc_estimates_payment_fk', t, t.depositPaymentId, payments),
    sameTenant('hhmc_estimates_file_fk', t, t.documentFileId, files),
    uniqueIndex('hhmc_estimates_number').on(t.businessId, t.environment, t.estimateNumber, t.version),
    uniqueIndex('hhmc_estimates_version').on(t.businessId, t.environment, t.jobId, t.version),
    // Never two live estimates for one job (ref §10 "duplicate estimates per WR").
    uniqueIndex('hhmc_estimates_one_live')
      .on(t.businessId, t.environment, t.jobId)
      .where(sql`${t.status} in ('sent', 'viewed', 'signed') and ${t.archivedAt} is null`),
    index('hhmc_estimates_job_idx').on(t.businessId, t.jobId),
    index('hhmc_estimates_sent_idx').on(t.businessId, t.sentAt),
  ],
);

// ---------------------------------------------------------------- invoices

export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'void';
export const INVOICE_TERMS = ['due_on_receipt', 'net_7', 'net_15', 'net_30', 'net_60'] as const;
export type InvoiceTerms = (typeof INVOICE_TERMS)[number];

export const hhmcInvoices = tenantTable(
  'hhmc_invoices',
  {
    invoiceNumber: text('invoice_number').notNull(),
    jobId: uuid('job_id').notNull(),
    estimateId: uuid('estimate_id'),
    customerId: uuid('customer_id').notNull(),
    status: text('status').$type<InvoiceStatus>().notNull().default('draft'),
    terms: text('terms').$type<InvoiceTerms>().notNull().default('due_on_receipt'),
    invoiceDate: date('invoice_date').notNull(),
    dueDate: date('due_date').notNull(),
    poNumber: text('po_number'),
    serviceTaxOn: boolean('service_tax_on').notNull().default(false),
    convenienceFeeOn: boolean('convenience_fee_on').notNull().default(false),
    serviceTaxBp: integer('service_tax_bp').notNull(),
    convenienceFeeBp: integer('convenience_fee_bp').notNull(),
    subtotalCents: integer('subtotal_cents').notNull().default(0),
    serviceTaxCents: integer('service_tax_cents').notNull().default(0),
    convenienceFeeCents: integer('convenience_fee_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull().default(0),
    /** Deposit received on the signed estimate, including its card fee. */
    depositReceivedCents: integer('deposit_received_cents').notNull().default(0),
    /** Payments received against this invoice (core payments with subject hhmc.invoice). */
    paidCents: integer('paid_cents').notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    remarks: text('remarks'),
  },
  (t) => [
    sameTenant('hhmc_invoices_job_fk', t, t.jobId, hhmcJobs),
    sameTenant('hhmc_invoices_estimate_fk', t, t.estimateId, hhmcEstimates),
    sameTenant('hhmc_invoices_customer_fk', t, t.customerId, customers),
    uniqueIndex('hhmc_invoices_number').on(t.businessId, t.environment, t.invoiceNumber),
    index('hhmc_invoices_job_idx').on(t.businessId, t.jobId),
    index('hhmc_invoices_customer_idx').on(t.businessId, t.customerId),
  ],
);

export const hhmcInvoiceLines = tenantTable(
  'hhmc_invoice_lines',
  {
    invoiceId: uuid('invoice_id').notNull(),
    section: text('section').$type<SectionKey>().notNull(),
    name: text('name').notNull(),
    unit: text('unit').notNull().default('each'),
    qtyHundredths: integer('qty_hundredths').notNull(),
    rateCents: integer('rate_cents').notNull(),
    discountType: text('discount_type').$type<DiscountType>(),
    discountValue: integer('discount_value'),
    serviceDate: date('service_date'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [sameTenant('hhmc_invoice_lines_invoice_fk', t, t.invoiceId, hhmcInvoices), index('hhmc_invoice_lines_invoice_idx').on(t.businessId, t.invoiceId)],
);

// ---------------------------------------------------------------- notes and calls

export type CallOutcome = 'spoke' | 'voicemail' | 'ringcentral';

/** Notes and logged calls on a job or a lead (ref §3.3 "Log a Call"). */
export const hhmcNotes = tenantTable(
  'hhmc_notes',
  {
    jobId: uuid('job_id'),
    leadId: uuid('lead_id'),
    kind: text('kind').$type<'note' | 'call'>().notNull(),
    callOutcome: text('call_outcome').$type<CallOutcome>(),
    body: text('body').notNull().default(''),
    authorName: text('author_name').notNull().default(''),
  },
  (t) => [
    sameTenant('hhmc_notes_job_fk', t, t.jobId, hhmcJobs),
    sameTenant('hhmc_notes_lead_fk', t, t.leadId, hhmcLeads),
    index('hhmc_notes_job_idx').on(t.businessId, t.jobId),
    index('hhmc_notes_lead_idx').on(t.businessId, t.leadId),
  ],
);

// ---------------------------------------------------------------- automations

export const AUTOMATION_TRIGGERS = [
  'estimate_sent',
  'lead_no_contact',
  'payment_received',
  'job_booked',
  'invoice_paid',
  'invoice_sent',
  /** Before the move date: the rule's delay is negative, counted from the first day's start. */
  'move_reminder',
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

/** Automation rules are data (ref §9.2). */
export const hhmcAutomationRules = tenantTable(
  'hhmc_automation_rules',
  {
    key: text('key').notNull(),
    name: text('name').notNull(),
    trigger: text('trigger').$type<AutomationTrigger>().notNull(),
    delayMinutes: integer('delay_minutes').notNull().default(0),
    templateKey: text('template_key').notNull(),
    /** Marketing emails respect the job's "automation opt-in"; receipts and notices do not. */
    respectsOptIn: boolean('respects_opt_in').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('hhmc_automation_rules_key')
      .on(t.businessId, t.environment, t.key)
      .where(sql`${t.archivedAt} is null`),
  ],
);

/** "sending": claimed by one run of the scheduler, so no other run sends it too. */
export type QueueStatus = 'queued' | 'sending' | 'sent' | 'cancelled' | 'failed';

/** Emails waiting to go out. processDueAutomations(now) sends the due ones. */
export const hhmcAutomationQueue = tenantTable(
  'hhmc_automation_queue',
  {
    ruleId: uuid('rule_id').notNull(),
    leadId: uuid('lead_id'),
    jobId: uuid('job_id'),
    estimateId: uuid('estimate_id'),
    invoiceId: uuid('invoice_id'),
    paymentId: uuid('payment_id'),
    recipient: text('recipient').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    status: text('status').$type<QueueStatus>().notNull().default('queued'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    notificationId: uuid('notification_id'),
    /**
     * The same email about the same records (rule + lead/job/estimate/invoice/payment, and the
     * move date for reminders) is queued or sent once: see the unique index below.
     */
    dedupeKey: text('dedupe_key'),
  },
  (t) => [
    uniqueIndex('hhmc_queue_dedupe')
      .on(t.businessId, t.environment, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null and ${t.status} in ('queued', 'sending', 'sent')`),
    sameTenant('hhmc_queue_rule_fk', t, t.ruleId, hhmcAutomationRules),
    sameTenant('hhmc_queue_lead_fk', t, t.leadId, hhmcLeads),
    sameTenant('hhmc_queue_job_fk', t, t.jobId, hhmcJobs),
    sameTenant('hhmc_queue_estimate_fk', t, t.estimateId, hhmcEstimates),
    sameTenant('hhmc_queue_invoice_fk', t, t.invoiceId, hhmcInvoices),
    sameTenant('hhmc_queue_payment_fk', t, t.paymentId, payments),
    sameTenant('hhmc_queue_notification_fk', t, t.notificationId, notifications),
    index('hhmc_queue_due_idx').on(t.businessId, t.environment, t.status, t.dueAt),
    index('hhmc_queue_job_idx').on(t.businessId, t.jobId),
    index('hhmc_queue_lead_idx').on(t.businessId, t.leadId),
  ],
);

// ---------------------------------------------------------------- import from Movegistics

export const IMPORT_SOURCES = ['movegistics'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

/**
 * Which local record an imported outside record became (Phase 5C). Re-running the import looks
 * the outside id up here and updates that record instead of creating a duplicate. Since the
 * parity work it also keeps the outside row exactly as exported (`sourceData`, every column), so
 * nothing Movegistics showed is lost: real customer data, scoped like every tenant row.
 */
export const hhmcImportRefs = tenantTable(
  'hhmc_import_refs',
  {
    source: text('source').$type<ImportSource>().notNull(),
    /** The outside record type: contact, lead, work_request, estimate, invoice, payment, … */
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    /** The local entity key (e.g. "core.customer", "hhmc.job") and record id. */
    entityKey: text('entity_key').notNull(),
    recordId: uuid('record_id').notNull(),
    /** Hash of the imported fields: unchanged rows are skipped on a re-run. */
    contentHash: text('content_hash').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
    /** The exported row(s) as Movegistics gave them: column name → value (blank columns left out). */
    sourceData: jsonb('source_data').$type<Record<string, string>>().notNull().default({}),
  },
  (t) => [
    uniqueIndex('hhmc_import_refs_source')
      .on(t.businessId, t.environment, t.source, t.sourceType, t.sourceId)
      .where(sql`${t.archivedAt} is null`),
    index('hhmc_import_refs_record_idx').on(t.businessId, t.environment, t.recordId),
  ],
);
