/**
 * One EntityDef per HHMC table, parents before children. Registering a table here puts it in
 * the Data tab (browse, search, export, archive, restore, permanent delete), in test-mode
 * resets, and in the automatic isolation and audit tests.
 */
import { and, eq, ne } from 'drizzle-orm';
import { updateRecord } from '@/core/records/records';
import { computeTotals } from './services/pricing';
import type { Scope } from '@/core/db/scope';
import type { EntityDef } from '@/core/modules/contract';
import { P } from './permissions';
import {
  hhmcAutomationQueue,
  hhmcAutomationRules,
  hhmcCatalogItems,
  hhmcDiscounts,
  hhmcEstimates,
  hhmcImportRefs,
  hhmcInvoiceLines,
  hhmcInvoices,
  hhmcJobDays,
  hhmcJobs,
  hhmcLeads,
  hhmcNotes,
  hhmcQuoteLines,
  hhmcQuotes,
  hhmcTemplates,
} from './schema';

async function jobOf(s: Scope, jobId: string) {
  const [job] = await s.db.select().from(hhmcJobs).where(and(s.where(hhmcJobs, 'include'), eq(hhmcJobs.id, jobId))).limit(1);
  return job ?? null;
}

async function quoteLineLocked(s: Scope, row: Record<string, unknown>): Promise<string | null> {
  const [quote] = await s.db.select().from(hhmcQuotes).where(and(s.where(hhmcQuotes, 'include'), eq(hhmcQuotes.id, String(row.quoteId)))).limit(1);
  if (!quote) return null;
  const job = await jobOf(s, quote.jobId);
  if (job && !['qualified', 'estimate_sent'].includes(job.stage)) return 'The quote is locked once the job is booked.';
  const [signed] = await s.db
    .select({ id: hhmcEstimates.id })
    .from(hhmcEstimates)
    .where(and(s.where(hhmcEstimates, 'include'), eq(hhmcEstimates.jobId, quote.jobId), eq(hhmcEstimates.status, 'signed')))
    .limit(1);
  return signed ? 'The customer has signed the estimate: the quote is locked.' : null;
}

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
const catalog = { readPermission: P.catalogRead, writePermission: P.catalogWrite };
const jobs = { readPermission: P.jobsRead, writePermission: P.jobsWrite };
const invoices = { readPermission: P.invoicesRead, writePermission: P.invoicesWrite };

export const catalogItemEntity: EntityDef<typeof hhmcCatalogItems> = {
  key: 'hhmc.catalog_item',
  label: 'catalog item',
  labelPlural: 'Catalog items',
  table: hhmcCatalogItems,
  ...catalog,
  titleOf: (row) => text(row.name),
  listColumns: [
    { key: 'name', label: 'Name' },
    { key: 'category', label: 'Category' },
    { key: 'unit', label: 'Unit' },
    { key: 'rateCents', label: 'Rate', format: 'money' },
    { key: 'isActive', label: 'Active', format: 'boolean' },
  ],
  searchColumns: ['name', 'category'],
};

export const discountEntity: EntityDef<typeof hhmcDiscounts> = {
  key: 'hhmc.discount',
  label: 'discount',
  labelPlural: 'Discounts',
  table: hhmcDiscounts,
  ...catalog,
  titleOf: (row) => text(row.name),
  listColumns: [
    { key: 'name', label: 'Name' },
    { key: 'percentBp', label: 'Basis points' },
    { key: 'isActive', label: 'Active', format: 'boolean' },
  ],
  searchColumns: ['name'],
};

export const templateEntity: EntityDef<typeof hhmcTemplates> = {
  key: 'hhmc.template',
  label: 'template',
  labelPlural: 'Templates',
  table: hhmcTemplates,
  ...catalog,
  titleOf: (row) => text(row.name),
  listColumns: [
    { key: 'name', label: 'Name' },
    { key: 'key', label: 'Key' },
    { key: 'kind', label: 'Kind' },
    { key: 'subject', label: 'Subject' },
  ],
  searchColumns: ['name', 'key', 'subject', 'body'],
  immutableFields: ['key', 'kind'],
};

export const automationRuleEntity: EntityDef<typeof hhmcAutomationRules> = {
  key: 'hhmc.automation_rule',
  label: 'automation rule',
  labelPlural: 'Automation rules',
  table: hhmcAutomationRules,
  ...catalog,
  titleOf: (row) => text(row.name),
  listColumns: [
    { key: 'name', label: 'Name' },
    { key: 'trigger', label: 'Trigger' },
    { key: 'delayMinutes', label: 'Delay (minutes)' },
    { key: 'isActive', label: 'Active', format: 'boolean' },
  ],
  searchColumns: ['name', 'key', 'trigger'],
  immutableFields: ['key', 'trigger'],
};

export const leadEntity: EntityDef<typeof hhmcLeads> = {
  key: 'hhmc.lead',
  label: 'lead',
  labelPlural: 'Leads',
  table: hhmcLeads,
  readPermission: P.leadsRead,
  writePermission: P.leadsWrite,
  titleOf: (row) => `${text(row.leadNumber)} ${text(row.firstName)} ${text(row.lastName)}`.trim(),
  listColumns: [
    { key: 'leadNumber', label: 'Lead' },
    { key: 'firstName', label: 'First name' },
    { key: 'lastName', label: 'Last name' },
    { key: 'email', label: 'Email' },
    { key: 'source', label: 'Source' },
    { key: 'status', label: 'Status' },
    { key: 'moveDate', label: 'Move date', format: 'date' },
    { key: 'createdAt', label: 'Created', format: 'date' },
  ],
  searchColumns: ['leadNumber', 'firstName', 'lastName', 'email', 'phone', 'sourceDetail'],
  immutableFields: ['leadNumber'],
};

export const jobEntity: EntityDef<typeof hhmcJobs> = {
  key: 'hhmc.job',
  label: 'job',
  labelPlural: 'Jobs',
  table: hhmcJobs,
  ...jobs,
  // A job in progress has a live estimate, a booking or an open invoice.
  archiveGuard: async (_s, row) =>
    ['qualified', 'lost', 'cancelled', 'closed'].includes(String(row.stage))
      ? null
      : 'Only a Qualified, Lost, Cancelled or Closed job can be archived. Release the booking, mark it lost or cancel it first.',
  titleOf: (row) => text(row.jobNumber),
  listColumns: [
    { key: 'jobNumber', label: 'Job' },
    { key: 'stage', label: 'Stage' },
    { key: 'serviceType', label: 'Service type' },
    { key: 'jobType', label: 'Job type' },
    { key: 'moveDate', label: 'Move date', format: 'date' },
    { key: 'source', label: 'Source' },
    { key: 'createdAt', label: 'Created', format: 'date' },
  ],
  searchColumns: ['jobNumber', 'originAddress', 'destinationAddress', 'companyName', 'poNumber'],
  immutableFields: ['jobNumber', 'leadId'],
};

export const jobDayEntity: EntityDef<typeof hhmcJobDays> = {
  key: 'hhmc.job_day',
  label: 'job day',
  labelPlural: 'Job days',
  table: hhmcJobDays,
  ...jobs,
  archiveGuard: async (s, row) => {
    const job = await jobOf(s, String(row.jobId));
    return job && !['qualified', 'estimate_sent'].includes(job.stage) ? 'Release the booking before removing a job day.' : null;
  },
  restoreGuard: async (s, row) => {
    const job = await jobOf(s, String(row.jobId));
    return job && !['qualified', 'estimate_sent'].includes(job.stage) ? 'A day cannot be brought back on a booked or finished job.' : null;
  },
  titleOf: (row) => text(row.dayDate),
  listColumns: [
    { key: 'dayDate', label: 'Day', format: 'date' },
    { key: 'startTime', label: 'Start' },
    { key: 'crewSize', label: 'Movers' },
    { key: 'trucks', label: 'Trucks' },
  ],
  searchColumns: ['notes'],
  immutableFields: ['jobId'],
};

export const quoteEntity: EntityDef<typeof hhmcQuotes> = {
  key: 'hhmc.quote',
  label: 'quote',
  labelPlural: 'Quotes',
  table: hhmcQuotes,
  ...jobs,
  titleOf: () => 'quote',
  listColumns: [
    { key: 'serviceTaxOn', label: 'Service tax', format: 'boolean' },
    { key: 'convenienceFeeOn', label: 'Card fee', format: 'boolean' },
    { key: 'updatedAt', label: 'Changed', format: 'datetime' },
  ],
  searchColumns: [],
  immutableFields: ['jobId'],
};

export const quoteLineEntity: EntityDef<typeof hhmcQuoteLines> = {
  key: 'hhmc.quote_line',
  label: 'quote line',
  labelPlural: 'Quote lines',
  table: hhmcQuoteLines,
  ...jobs,
  // Same rule as the quote editor: locked once an estimate is signed or the job is booked.
  archiveGuard: (s, row) => quoteLineLocked(s, row),
  restoreGuard: (s, row) => quoteLineLocked(s, row),
  titleOf: (row) => text(row.name),
  listColumns: [
    { key: 'section', label: 'Section' },
    { key: 'name', label: 'Item' },
    { key: 'qtyHundredths', label: 'Qty × 100' },
    { key: 'rateCents', label: 'Rate', format: 'money' },
  ],
  searchColumns: ['name', 'description'],
  immutableFields: ['quoteId'],
};

export const estimateEntity: EntityDef<typeof hhmcEstimates> = {
  key: 'hhmc.estimate',
  label: 'estimate',
  labelPlural: 'Estimates',
  table: hhmcEstimates,
  readPermission: P.jobsRead,
  writePermission: P.estimatesWrite,
  // What a customer saw or signed is kept: void it first (signed ones are never archived).
  archiveGuard: async (_s, row) =>
    row.status === 'void' || row.status === 'draft' ? null : 'Only a void estimate can be archived. A signed estimate is kept for good.',
  titleOf: (row) => `${text(row.estimateNumber)} v${text(row.version)}`,
  listColumns: [
    { key: 'estimateNumber', label: 'Estimate' },
    { key: 'version', label: 'Version' },
    { key: 'status', label: 'Status' },
    { key: 'totalCents', label: 'Total', format: 'money' },
    { key: 'sentAt', label: 'Sent', format: 'datetime' },
    { key: 'signedAt', label: 'Signed', format: 'datetime' },
  ],
  searchColumns: ['estimateNumber', 'signatureName'],
  // A sent estimate is a frozen snapshot: what the customer saw cannot be rewritten.
  immutableFields: ['jobId', 'estimateNumber', 'version', 'snapshot', 'subtotalCents', 'serviceTaxCents', 'convenienceFeeCents', 'totalCents', 'depositCents'],
};

export const invoiceEntity: EntityDef<typeof hhmcInvoices> = {
  key: 'hhmc.invoice',
  label: 'invoice',
  labelPlural: 'Invoices',
  table: hhmcInvoices,
  ...invoices,
  // Money: only a void invoice can be archived (void a draft first).
  archiveGuard: async (_s, row) => (row.status === 'void' ? null : 'Only a void invoice can be archived. Void it first.'),
  // Bringing one back must not give a job two invoices.
  restoreGuard: async (s, row) => {
    if (row.status === 'void') return null;
    const [other] = await s.db
      .select({ id: hhmcInvoices.id })
      .from(hhmcInvoices)
      .where(and(s.where(hhmcInvoices), eq(hhmcInvoices.jobId, String(row.jobId)), ne(hhmcInvoices.status, 'void')))
      .limit(1);
    return other ? 'This job already has another invoice.' : null;
  },
  titleOf: (row) => text(row.invoiceNumber),
  listColumns: [
    { key: 'invoiceNumber', label: 'Invoice' },
    { key: 'status', label: 'Status' },
    { key: 'invoiceDate', label: 'Date', format: 'date' },
    { key: 'dueDate', label: 'Due', format: 'date' },
    { key: 'totalCents', label: 'Total', format: 'money' },
    { key: 'paidCents', label: 'Paid', format: 'money' },
  ],
  searchColumns: ['invoiceNumber', 'poNumber'],
  immutableFields: ['invoiceNumber', 'jobId', 'customerId'],
};

export const invoiceLineEntity: EntityDef<typeof hhmcInvoiceLines> = {
  key: 'hhmc.invoice_line',
  label: 'invoice line',
  labelPlural: 'Invoice lines',
  table: hhmcInvoiceLines,
  ...invoices,
  // A void invoice's lines may be archived too (so a void invoice can be purged in the end).
  archiveGuard: (s, row) => invoiceLineLocked(s, row, ['draft', 'void']),
  restoreGuard: (s, row) => invoiceLineLocked(s, row, ['draft']),
  // Whatever path removed or restored the line, the draft's totals follow (review: no stale total).
  afterArchiveOrRestore: async (s, row) => {
    await repriceDraftInvoice(s, String(row.invoiceId));
  },
  titleOf: (row) => text(row.name),
  listColumns: [
    { key: 'section', label: 'Section' },
    { key: 'name', label: 'Item' },
    { key: 'qtyHundredths', label: 'Qty × 100' },
    { key: 'rateCents', label: 'Rate', format: 'money' },
  ],
  searchColumns: ['name'],
  immutableFields: ['invoiceId'],
};

async function invoiceLineLocked(s: Scope, row: Record<string, unknown>, allowed: string[]): Promise<string | null> {
  const [invoice] = await s.db.select({ status: hhmcInvoices.status }).from(hhmcInvoices).where(and(s.where(hhmcInvoices, 'include'), eq(hhmcInvoices.id, String(row.invoiceId)))).limit(1);
  return invoice && !allowed.includes(invoice.status) ? 'Only the lines of a draft invoice can be changed.' : null;
}

/**
 * Re-prices a DRAFT invoice from its current lines (sent invoices never change). Used after any
 * line change, whatever the path, and before an invoice is sent.
 */
export async function repriceDraftInvoice(s: Scope, invoiceId: string) {
  const [invoice] = await s.db.select().from(hhmcInvoices).where(and(s.where(hhmcInvoices), eq(hhmcInvoices.id, invoiceId))).limit(1);
  if (!invoice || invoice.status !== 'draft') return invoice ?? null;
  const lines = await s.db.select().from(hhmcInvoiceLines).where(and(s.where(hhmcInvoiceLines), eq(hhmcInvoiceLines.invoiceId, invoiceId)));
  const totals = computeTotals(lines, invoice);
  return updateRecord(s, invoiceEntity, invoiceId, {
    subtotalCents: totals.subtotalCents,
    serviceTaxCents: totals.serviceTaxCents,
    convenienceFeeCents: totals.convenienceFeeCents,
    totalCents: totals.totalCents,
  });
}

export const noteEntity: EntityDef<typeof hhmcNotes> = {
  key: 'hhmc.note',
  label: 'note',
  labelPlural: 'Notes and calls',
  table: hhmcNotes,
  ...jobs,
  titleOf: (row) => (row.kind === 'call' ? 'call' : 'note'),
  listColumns: [
    { key: 'kind', label: 'Kind' },
    { key: 'callOutcome', label: 'Call outcome' },
    { key: 'body', label: 'Note' },
    { key: 'authorName', label: 'By' },
    { key: 'createdAt', label: 'When', format: 'datetime' },
  ],
  searchColumns: ['body', 'authorName'],
  immutableFields: ['jobId', 'leadId', 'kind'],
};

export const queueEntity: EntityDef<typeof hhmcAutomationQueue> = {
  key: 'hhmc.automation_queue',
  label: 'queued email',
  labelPlural: 'Queued emails',
  table: hhmcAutomationQueue,
  // Queued by whatever event triggers it (sending an estimate, a payment …), so it follows the
  // job permissions. SENDING still needs notifications.write (sendNotification checks it).
  ...jobs,
  titleOf: (row) => `email to ${text(row.recipient)}`,
  listColumns: [
    { key: 'recipient', label: 'To' },
    { key: 'dueAt', label: 'Due', format: 'datetime' },
    { key: 'status', label: 'Status' },
    { key: 'sentAt', label: 'Sent', format: 'datetime' },
    { key: 'cancelledReason', label: 'Why cancelled' },
  ],
  searchColumns: ['recipient', 'status'],
  immutableFields: ['ruleId'],
};

/** Which local record each imported Movegistics record became (ids and a hash only). */
export const importRefEntity: EntityDef<typeof hhmcImportRefs> = {
  key: 'hhmc.import_ref',
  label: 'import link',
  labelPlural: 'Import links',
  table: hhmcImportRefs,
  readPermission: P.catalogRead,
  writePermission: P.importRun,
  titleOf: (row) => `${text(row.source)} ${text(row.sourceType)} ${text(row.sourceId)}`,
  listColumns: [
    { key: 'sourceType', label: 'Movegistics record' },
    { key: 'sourceId', label: 'Movegistics id' },
    { key: 'entityKey', label: 'Became' },
    { key: 'importedAt', label: 'Imported', format: 'datetime' },
  ],
  searchColumns: ['sourceType', 'sourceId', 'entityKey'],
  immutableFields: ['source', 'sourceType', 'sourceId'],
};

/** Parents before children: a sandbox reset fills them in this order. */
export const entities: EntityDef[] = [
  catalogItemEntity,
  discountEntity,
  templateEntity,
  automationRuleEntity,
  leadEntity,
  jobEntity,
  jobDayEntity,
  quoteEntity,
  quoteLineEntity,
  estimateEntity,
  invoiceEntity,
  invoiceLineEntity,
  noteEntity,
  queueEntity,
  importRefEntity,
] as EntityDef[];
