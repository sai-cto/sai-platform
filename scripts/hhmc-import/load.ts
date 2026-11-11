/**
 * Writes a normalized Movegistics set into HHMC (Phase 5C), through the platform's own record
 * functions (createRecord / updateRecord), so every row is tenant-scoped, permission-checked and
 * in the activity log. Each imported record gets a row in hhmc_import_refs (Movegistics id →
 * local id + content hash): re-running the import updates what changed and skips the rest, never
 * creating duplicates.
 *
 * Nothing here sends an email, queues an automation or takes a payment: payments are recorded as
 * already received ("manual" provider), exactly as Movegistics shows them.
 */
import { and, eq, like, max } from 'drizzle-orm';
import { txOf, type Scope } from '../../src/core/db/scope';
import { customers } from '../../src/core/db/schema/tenant';
import { customerEntity, paymentEntity } from '../../src/core/records/core-entities';
import { createRecord, updateRecord } from '../../src/core/records/records';
import {
  estimateEntity,
  importRefEntity,
  invoiceEntity,
  invoiceLineEntity,
  jobDayEntity,
  jobEntity,
  leadEntity,
  quoteEntity,
  quoteLineEntity,
} from '../../src/modules/hhmc/entities';
import { hhmcEstimates, hhmcImportRefs, hhmcInvoiceLines, type EstimateSnapshot } from '../../src/modules/hhmc/schema';
import { SECTION_KEYS, sectionLabel, type SectionKey } from '../../src/modules/hhmc/services/pricing';
import { bp, loadSettings } from '../../src/modules/hhmc/settings';
import type { EntityDef } from '../../src/core/modules/contract';
import { hashOf, type NContact, type NEstimate, type NInvoice, type NJob, type NLead, type NPayment, type Normalized } from './movegistics';

export type LoadStats = Record<string, { created: number; updated: number; unchanged: number; kept: number; linked: number }>;

const TZ_NOON = 'T12:00:00-05:00';
/** A Movegistics date (no time) as a timestamp: noon in Ithaca, so it never slips a day. */
const at = (d: string | null | undefined) => (d ? new Date(`${d}${TZ_NOON}`) : null);

type Ref = typeof hhmcImportRefs.$inferSelect;

async function loadRefs(s: Scope): Promise<Map<string, Ref>> {
  const rows = await s.db.select().from(hhmcImportRefs).where(and(s.where(hhmcImportRefs), eq(hhmcImportRefs.source, 'movegistics')));
  return new Map(rows.map((r) => [`${r.sourceType}:${r.sourceId}`, r]));
}

/** Keeps the Movegistics creation date (record functions stamp "now"). Same scope, same RLS. */
async function backdate(s: Scope, entity: EntityDef, id: string, on: string | null | undefined) {
  const when = at(on);
  if (!when) return;
  await txOf(s).update(entity.table).set({ createdAt: when } as never).where(and(s.where(entity.table), eq(entity.table.id, id)));
}

/** Runs one batch in its own transaction (a whole import in one transaction runs out of locks). */
export type Batch = <T>(fn: (s: Scope) => Promise<T>) => Promise<T>;
const BATCH = 250;

export async function loadIntoHhmc(batch: Batch, n: Normalized): Promise<{ stats: LoadStats; ids: Map<string, string> }> {
  let s!: Scope; // the current batch's scope (every helper below uses it)
  const { settings, refs, people } = await batch(async (scope) => ({
    settings: await loadSettings(scope.ctx),
    refs: await loadRefs(scope),
    // Customers already in HHMC live, by email and phone: a person the import has not linked yet
    // (a new export order, a merged Movegistics duplicate) is linked, never created twice.
    // Archived customers too: re-importing must never make a second copy of someone archived.
    people: await scope.db.select({ id: customers.id, email: customers.email, phone: customers.phone }).from(customers).where(scope.where(customers, 'include')),
  }));
  const customerByEmail = new Map(people.filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p.id]));
  const customerByPhone = new Map(people.filter((p) => p.phone).map((p) => [p.phone!.replace(/\D/g, '').slice(-10), { id: p.id, email: p.email?.toLowerCase() ?? null }]));
  /** Same person? Email first; a phone only when the emails don't disagree (a shared household or
   *  business line is not the same person). Mirrors contactFor() in movegistics.ts. */
  const existingCustomer = (email: string | null, phone: string | null): string | null => {
    if (email && customerByEmail.has(email)) return customerByEmail.get(email)!;
    const byPhone = phone ? customerByPhone.get(phone) : undefined;
    return byPhone && (!byPhone.email || !email || byPhone.email === email) ? byPhone.id : null;
  };
  /** Each item, BATCH at a time, each batch committed on its own. */
  async function each<T>(items: T[], fn: (item: T) => Promise<void>) {
    for (let i = 0; i < items.length; i += BATCH) {
      await batch(async (scope) => {
        s = scope;
        for (const item of items.slice(i, i + BATCH)) await fn(item);
      });
    }
  }
  const ids = new Map<string, string>(); // "<type>:<sid>" → local id
  const stats: LoadStats = {};
  const tally = (type: string, what: 'created' | 'updated' | 'unchanged' | 'kept' | 'linked') => {
    stats[type] ??= { created: 0, updated: 0, unchanged: 0, kept: 0, linked: 0 };
    stats[type][what]++;
  };

  /** Create, update or skip one record, keyed by its Movegistics id. */
  async function upsert<T extends EntityDef>(
    type: string,
    sid: string,
    entity: T,
    values: Record<string, unknown>,
    options: {
      createdOn?: string | null;
      updatable?: (keyof typeof values)[];
      /** An existing record to link instead of creating one (customers matched by email/phone). */
      existing?: string | null;
      /** Last adjustments right before creating (e.g. the next free estimate version). */
      beforeCreate?: (values: Record<string, unknown>) => Promise<void>;
    } = {},
  ): Promise<{ id: string; created: boolean; updated: boolean }> {
    const key = `${type}:${sid}`;
    const hash = hashOf(values);
    const ref = refs.get(key);
    if (ref) {
      ids.set(key, ref.recordId);
      if (ref.contentHash === hash) {
        tally(type, 'unchanged');
        return { id: ref.recordId, created: false, updated: false };
      }
      // A record someone changed in SAI after the import (updated_by = a person; the import
      // runs as the system actor) is never overwritten from Movegistics.
      // Kept as it is in SAI when: a person changed it (updated_by), anything changed it after the
      // last import (a customer link writes with no user id), or someone archived it.
      const [current] = await s.db
        .select({ updatedBy: entity.table.updatedBy, updatedAt: entity.table.updatedAt, archivedAt: entity.table.archivedAt })
        .from(entity.table)
        .where(and(s.where(entity.table, 'include'), eq(entity.table.id, ref.recordId)))
        .limit(1);
      if (!current || current.updatedBy || current.archivedAt || new Date(current.updatedAt as Date).getTime() > ref.importedAt.getTime() + 1000) {
        tally(type, 'kept');
        return { id: ref.recordId, created: false, updated: false };
      }
      const patch = options.updatable ? Object.fromEntries(options.updatable.map((k) => [k, values[k as string]])) : values;
      await updateRecord(s, entity, ref.recordId, patch as never);
      await updateRecord(s, importRefEntity, ref.id, { contentHash: hash, importedAt: new Date() });
      tally(type, 'updated');
      return { id: ref.recordId, created: false, updated: true };
    }
    let recordId: string;
    if (options.existing) {
      recordId = options.existing;
      tally(type, 'linked');
    } else {
      if (options.beforeCreate) await options.beforeCreate(values);
      recordId = ((await createRecord(s, entity, values as never)) as { id: string }).id;
      await backdate(s, entity, recordId, options.createdOn);
      tally(type, 'created');
    }
    const refRow = (await createRecord(s, importRefEntity, { source: 'movegistics', sourceType: type, sourceId: sid, entityKey: entity.key, recordId, contentHash: hash })) as Ref;
    ids.set(key, recordId);
    refs.set(key, refRow);
    return { id: recordId, created: !options.existing, updated: false };
  }

  // ---- customers
  await each(n.contacts as NContact[], async (c) => {
    const existing = existingCustomer(c.email, c.phone);
    const { id, created } = await upsert('contact', c.sid, customerEntity, { kind: 'person', firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, notes: c.notes, externalRef: `movegistics:${c.sid}` }, { createdOn: c.createdOn, existing: refs.has(`contact:${c.sid}`) ? null : existing });
    if (created) {
      if (c.email) customerByEmail.set(c.email, id);
      if (c.phone && !customerByPhone.has(c.phone)) customerByPhone.set(c.phone, { id, email: c.email });
    }
  });
  const customerId = (sid: string | null) => (sid ? (ids.get(`contact:${sid}`) ?? null) : null);

  // ---- leads (never converted in Movegistics: status New)
  await each(n.leads as NLead[], async (l) => {
    await upsert(
      'lead',
      l.sid,
      leadEntity,
      {
        leadNumber: l.sid, firstName: l.firstName, lastName: l.lastName, email: l.email, phone: l.phone, source: l.source, sourceDetail: l.sourceDetail,
        moveDate: l.moveDate, originAddress: l.origin, destinationAddress: l.destination, ownerName: l.ownerName, customerNote: l.customerNote,
        internalNote: l.internalNote, bedrooms: l.bedrooms, status: 'new', customerId: customerId(l.contactSid),
      },
      { createdOn: l.createdOn, updatable: ['firstName', 'lastName', 'email', 'phone', 'source', 'sourceDetail', 'moveDate', 'originAddress', 'destinationAddress', 'ownerName', 'customerNote', 'internalNote', 'customerId'] },
    );
  });

  // ---- jobs (work requests), each with its quote (section totals), days
  const estimatesOf = new Map<string, NEstimate[]>();
  for (const e of n.estimates) estimatesOf.set(e.jobSid, [...(estimatesOf.get(e.jobSid) ?? []), e]);
  await each(n.jobs as NJob[], async (j) => {
    const cust = customerId(j.contactSid);
    if (!cust) throw new Error(`Work request without a customer (import bug): ${j.sid}`);
    const booked = j.stage === 'booked' || j.stage === 'completed' || j.stage === 'closed';
    const { id: jobId, created } = await upsert(
      'work_request',
      j.sid,
      jobEntity,
      {
        jobNumber: j.sid, customerId: cust, originAddress: j.origin, destinationAddress: j.destination, moveDate: j.moveDate, tentative: j.tentative,
        serviceType: j.serviceType, jobType: j.jobType, customerComments: j.customerComments, internalNotes: j.internalNotes, ownerName: j.ownerName,
        source: j.source, sourceDetail: j.sourceDetail, stage: j.stage, lostReason: j.stage === 'lost' ? j.lostReason : null,
        cancelledReason: j.stage === 'cancelled' ? 'Work order cancelled in Movegistics' : null, automationOptIn: false,
        bookedAt: booked ? at(j.days[0] ?? j.moveDate ?? j.createdOn) : null,
        completedAt: j.stage === 'completed' || j.stage === 'closed' ? at(j.days.at(-1) ?? j.moveDate) : null,
        closedAt: j.stage === 'closed' ? at(j.days.at(-1) ?? j.moveDate) : null,
        companyName: null, scopeOfWork: j.placeholder ? 'Imported from a Movegistics invoice that named no work request.' : null,
      },
      { createdOn: j.createdOn, updatable: ['customerId', 'originAddress', 'destinationAddress', 'moveDate', 'tentative', 'serviceType', 'jobType', 'customerComments', 'internalNotes', 'ownerName', 'source', 'sourceDetail', 'stage', 'lostReason', 'cancelledReason', 'bookedAt', 'completedAt', 'closedAt'] },
    );
    if (!created) return; // quote and days are made once; later runs leave staff's changes alone
    const quote = (await createRecord(s, quoteEntity, { jobId, serviceTaxOn: false, convenienceFeeOn: false })) as { id: string };
    const sectionLines = (SECTION_KEYS as SectionKey[]).filter((k) => (j.sections[k] ?? 0) > 0);
    const lines = sectionLines.length ? sectionLines.map((k) => ({ section: k, cents: j.sections[k] })) : j.amountCents > 0 ? [{ section: 'transportation_labor' as SectionKey, cents: j.amountCents }] : [];
    for (const [i, l] of lines.entries()) {
      await createRecord(s, quoteLineEntity, { quoteId: quote.id, section: l.section, name: `${sectionLabel(l.section)} (Movegistics total)`, unit: 'each', qtyHundredths: 100, rateCents: l.cents, description: 'Imported: Movegistics exports totals by section, not line items.', sortOrder: i });
    }
    const days = booked ? (j.days.length ? j.days : j.moveDate ? [j.moveDate] : []) : [];
    for (const d of days) await createRecord(s, jobDayEntity, { jobId, dayDate: d, startTime: '08:00', durationMinutes: Math.round(settings.defaultJobHours * 60), crewSize: 2, trucks: 1 });
  });

  // ---- estimates (frozen, versioned; Movegistics exports totals only)
  const depositBp = bp(settings.depositPercent);
  await each(n.estimates as NEstimate[], async (e) => {
    const jobId = ids.get(`work_request:${e.jobSid}`)!;
    const job = n.jobs.find((x) => x.sid === e.jobSid)!;
    const contact = n.contacts.find((c) => c.sid === job.contactSid);
    const sent = at(e.createdOn);
    const total = e.amountCents;
    const snapshot: EstimateSnapshot = {
      title: `Estimate ${e.sid} (imported from Movegistics)`,
      customerName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : '',
      customerEmail: contact?.email ?? null, originAddress: job.origin, destinationAddress: job.destination, extraStops: [], moveDate: job.moveDate,
      arrivalWindow: null, serviceType: job.serviceType, jobType: job.jobType, crewSize: 2, trucks: 1, scopeOfWork: null,
      lines: [{ section: 'transportation_labor', name: 'Movegistics estimate total (line items were not in the export)', unit: 'each', qtyHundredths: 100, rateCents: total, discountType: null, discountValue: null, totalCents: total, description: null }],
      sections: { ...Object.fromEntries(SECTION_KEYS.map((k) => [k, 0])), transportation_labor: total } as Record<SectionKey, number>,
      serviceTaxOn: false, convenienceFeeOn: false, serviceTaxBp: bp(settings.serviceTaxPercent), convenienceFeeBp: bp(settings.convenienceFeePercent), depositBp,
      termsTitle: 'Terms & Conditions (as sent from Movegistics)', termsBody: '', valuation: 'Basic Coverage: $0.60 per pound per article.',
    };
    const live = e.status === 'sent' || e.status === 'viewed' || e.status === 'signed';
    await upsert(
      'estimate',
      e.sid,
      estimateEntity,
      {
        jobId, estimateNumber: e.sid, version: e.version, status: e.status, snapshot, subtotalCents: total, serviceTaxCents: 0, convenienceFeeCents: 0, totalCents: total,
        depositCents: Math.round((total * depositBp) / 10_000), sentAt: e.status === 'draft' ? null : sent, expiresAt: at(e.expiresOn),
        viewedAt: e.status === 'viewed' || e.status === 'signed' ? sent : null, signedAt: e.status === 'signed' ? sent : null,
        voidedAt: e.status === 'void' ? sent : null, voidReason: e.status === 'void' ? (e.voidReason ?? 'Void in Movegistics') : null,
        createdByName: e.createdByName, signatureName: e.status === 'signed' ? 'Signed in Movegistics' : null,
      },
      {
        createdOn: e.createdOn,
        updatable: live ? ['status', 'viewedAt', 'signedAt', 'createdByName'] : ['status', 'voidedAt', 'voidReason', 'createdByName'],
        // A later export can hold an earlier-dated or a deleted estimate: never collide on a version.
        beforeCreate: async (v) => {
          const [{ top }] = await s.db.select({ top: max(hhmcEstimates.version) }).from(hhmcEstimates).where(and(s.where(hhmcEstimates, 'include'), eq(hhmcEstimates.jobId, jobId)));
          if (top !== null && Number(v.version) <= top) v.version = top + 1;
        },
      },
    );
  });

  // ---- invoices (one line: Movegistics exports invoice totals only)
  await each(n.invoices as NInvoice[], async (i) => {
    const jobId = ids.get(`work_request:${i.jobSid}`)!;
    const paid = i.amountCents - i.balanceCents;
    const { id: invoiceId, created, updated } = await upsert(
      'invoice',
      i.sid,
      invoiceEntity,
      {
        invoiceNumber: i.sid, jobId, customerId: customerId(i.contactSid), status: i.status, terms: 'due_on_receipt', invoiceDate: i.invoiceDate, dueDate: i.dueDate,
        poNumber: i.poNumber, serviceTaxOn: false, convenienceFeeOn: false, serviceTaxBp: bp(settings.serviceTaxPercent), convenienceFeeBp: bp(settings.convenienceFeePercent),
        subtotalCents: i.amountCents, serviceTaxCents: 0, convenienceFeeCents: 0, totalCents: i.amountCents, depositReceivedCents: 0, paidCents: paid,
        sentAt: i.status === 'draft' ? null : at(i.invoiceDate), paidAt: i.status === 'paid' ? at(i.invoiceDate) : null,
        remarks: `Imported from Movegistics (made by ${i.ownerName ?? 'unknown'}). Balance as Movegistics showed it on import.`,
      },
      { createdOn: i.invoiceDate, updatable: ['status', 'dueDate', 'paidCents', 'paidAt', 'sentAt', 'subtotalCents', 'totalCents'] },
    );
    if (updated) {
      const [line] = await s.db.select({ id: hhmcInvoiceLines.id, rateCents: hhmcInvoiceLines.rateCents }).from(hhmcInvoiceLines).where(and(s.where(hhmcInvoiceLines), eq(hhmcInvoiceLines.invoiceId, invoiceId), eq(hhmcInvoiceLines.sortOrder, 0), like(hhmcInvoiceLines.name, 'Movegistics invoice %'))).limit(1);
      if (line && line.rateCents !== i.amountCents) await updateRecord(s, invoiceLineEntity, line.id, { rateCents: i.amountCents });
    }
    if (created) await createRecord(s, invoiceLineEntity, { invoiceId, section: 'transportation_labor', name: `Movegistics invoice ${i.sid} total (line items were not in the export)`, unit: 'each', qtyHundredths: 100, rateCents: i.amountCents, serviceDate: i.invoiceDate, sortOrder: 0 });
  });

  // ---- payments (already received; recorded, never charged)
  const inForce = new Map<string, string>(); // job sid → its estimate in force (deposits are paid on it)
  for (const e of n.estimates) if (e.status === 'signed' || ((e.status === 'sent' || e.status === 'viewed') && !inForce.has(e.jobSid))) inForce.set(e.jobSid, e.sid);
  const depositPaid = new Map<string, number>();
  await each(n.payments as NPayment[], async (p) => {
    const estimateSid = !p.invoiceSid && p.jobSid ? inForce.get(p.jobSid) : undefined;
    const subjectType = p.invoiceSid ? invoiceEntity.key : estimateSid ? estimateEntity.key : p.jobSid ? jobEntity.key : null;
    const subjectId = p.invoiceSid ? ids.get(`invoice:${p.invoiceSid}`)! : estimateSid ? ids.get(`estimate:${estimateSid}`)! : p.jobSid ? ids.get(`work_request:${p.jobSid}`)! : null;
    const contactSid = p.contactSid ?? (p.jobSid ? n.jobs.find((j) => j.sid === p.jobSid)?.contactSid ?? null : null);
    await upsert(
      'payment',
      p.sid,
      paymentEntity,
      {
        customerId: customerId(contactSid), kind: 'charge', amountCents: p.amountCents, currency: 'usd', status: 'succeeded', method: p.method, provider: 'manual',
        providerRef: `movegistics:${p.sid}`, cardBrand: p.cardBrand, cardLast4: p.cardLast4, refundedCents: p.refundedCents, description: p.description,
        subjectType, subjectId, paidAt: at(p.paidOn),
      },
      { createdOn: p.paidOn, updatable: ['refundedCents', 'description', 'subjectType', 'subjectId', 'customerId'] },
    );
    if (estimateSid) depositPaid.set(estimateSid, (depositPaid.get(estimateSid) ?? 0) + p.amountCents - p.refundedCents);
  });
  await each([...depositPaid], async ([sid, paid]) => {
    const id = ids.get(`estimate:${sid}`)!;
    await updateRecord(s, estimateEntity, id, { depositPaidCents: paid });
  });



  return { stats, ids };
}
