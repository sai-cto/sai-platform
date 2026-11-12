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
import { and, asc, eq, inArray, isNotNull, isNull, like, max, ne } from 'drizzle-orm';
import { logActivity } from '../../src/core/audit/log';
import { txOf, type Scope } from '../../src/core/db/scope';
import { appointments, customers } from '../../src/core/db/schema/tenant';
import { appointmentEntity, customerEntity, paymentEntity } from '../../src/core/records/core-entities';
import { bookAppointment, findConflicts } from '../../src/core/scheduling/scheduling';
import { localDate, localTime } from '../../src/modules/hhmc/rules';
import { trucksOf } from '../../src/modules/hhmc/services/common';
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
import { hhmcEstimates, hhmcImportRefs, hhmcInvoiceLines, hhmcJobDays, hhmcJobs, type EstimateSnapshot } from '../../src/modules/hhmc/schema';
import { SECTION_KEYS, sectionLabel, type SectionKey } from '../../src/modules/hhmc/services/pricing';
import { bp, loadSettings } from '../../src/modules/hhmc/settings';
import type { EntityDef } from '../../src/core/modules/contract';
import { hashOf, type NContact, type NEstimate, type NInvoice, type NJob, type NLead, type NPayment, type Normalized, type Raw } from './movegistics';

export type LoadStats = Record<string, { created: number; updated: number; unchanged: number; kept: number; linked: number }>;

/** Same keys and values, whatever the order (jsonb does not keep key order). */
const sameRaw = (a: Raw, b: Raw) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

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
// Smaller over the network (pilot): each batch's transaction holds the record-number locks, so
// short batches keep the live site responsive while the import runs.
const BATCH = Number(process.env.HHMC_IMPORT_BATCH) || 250;

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
  // A phone shared by several existing customers says nothing about who someone is: not used.
  const phoneOf = (p: { phone: string | null }) => p.phone!.replace(/\D/g, '').slice(-10);
  const phoneUses = new Map<string, number>();
  for (const p of people) if (p.phone) phoneUses.set(phoneOf(p), (phoneUses.get(phoneOf(p)) ?? 0) + 1);
  const customerByPhone = new Map(people.filter((p) => p.phone && phoneUses.get(phoneOf(p)) === 1).map((p) => [phoneOf(p), { id: p.id, email: p.email?.toLowerCase() ?? null }]));
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
      /** The exported row(s), kept with the import link. */
      raw?: Raw;
    } = {},
  ): Promise<{ id: string; created: boolean; updated: boolean; kept: boolean }> {
    const key = `${type}:${sid}`;
    const raw = options.raw ?? {};
    const hash = hashOf(values);
    const ref = refs.get(key);
    if (ref) {
      ids.set(key, ref.recordId);
      // The exported row is import metadata, not the record: it always follows the latest export,
      // even when staff changed the record itself in SAI.
      if (!sameRaw(ref.sourceData ?? {}, raw)) {
        const fresh = (await updateRecord(s, importRefEntity, ref.id, { sourceData: raw })) as Ref;
        refs.set(key, fresh);
      }
      if (ref.contentHash === hash) {
        tally(type, 'unchanged');
        return { id: ref.recordId, created: false, updated: false, kept: false };
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
      if (!current) throw new Error(`Refusing: an imported ${type} was permanently deleted in SAI; remove its import link (hhmc_import_refs) on purpose before re-importing it.`);
      if (current.updatedBy || current.archivedAt || new Date(current.updatedAt as Date).getTime() > ref.importedAt.getTime() + 1000) {
        tally(type, 'kept');
        return { id: ref.recordId, created: false, updated: false, kept: true };
      }
      const patch = options.updatable ? Object.fromEntries(options.updatable.map((k) => [k, values[k as string]])) : values;
      await updateRecord(s, entity, ref.recordId, patch as never);
      refs.set(key, (await updateRecord(s, importRefEntity, ref.id, { contentHash: hash, importedAt: new Date() })) as Ref);
      tally(type, 'updated');
      return { id: ref.recordId, created: false, updated: true, kept: false };
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
    const refRow = (await createRecord(s, importRefEntity, { source: 'movegistics', sourceType: type, sourceId: sid, entityKey: entity.key, recordId, contentHash: hash, sourceData: raw })) as Ref;
    ids.set(key, recordId);
    refs.set(key, refRow);
    return { id: recordId, created: !options.existing, updated: false, kept: false };
  }

  /** A Movegistics row merged into a record imported from another row (duplicate contacts): its own link, its own raw row. */
  async function linkAlso(type: string, sid: string, entity: EntityDef, recordId: string, raw: Raw) {
    const key = `${type}:${sid}`;
    const ref = refs.get(key);
    if (ref) {
      ids.set(key, ref.recordId);
      if (!sameRaw(ref.sourceData ?? {}, raw)) refs.set(key, (await updateRecord(s, importRefEntity, ref.id, { sourceData: raw })) as Ref);
      tally(type, 'unchanged');
      return;
    }
    refs.set(key, (await createRecord(s, importRefEntity, { source: 'movegistics', sourceType: type, sourceId: sid, entityKey: entity.key, recordId, contentHash: hashOf(raw), sourceData: raw })) as Ref);
    ids.set(key, recordId);
    tally(type, 'linked');
  }

  /**
   * Keeps a job's days equal to its Movegistics work-order days, as long as nobody changed them in
   * SAI (a day made or edited by a person stops the sync for that job). Days the import made and no
   * longer wanted are archived; the import never books appointments, so nothing else depends on them.
   */
  async function syncDays(jobId: string, jobNumber: string, dates: string[], notes: Record<string, string>, holdsTrucks: boolean, customerId: string) {
    const days = await s.db.select().from(hhmcJobDays).where(and(s.where(hhmcJobDays), eq(hhmcJobDays.jobId, jobId))).orderBy(asc(hhmcJobDays.dayDate));
    // Someone worked on this move in SAI (changed it, or booked it: booking makes appointments,
    // made by a person; the import's own appointments have no person).
    const [job] = await s.db.select({ updatedBy: hhmcJobs.updatedBy, archivedAt: hhmcJobs.archivedAt }).from(hhmcJobs).where(and(s.where(hhmcJobs, 'include'), eq(hhmcJobs.id, jobId))).limit(1);
    const booked = days.length
      ? await s.db.select({ id: appointments.id }).from(appointments).where(and(s.where(appointments, 'include'), eq(appointments.subjectType, jobDayEntity.key), inArray(appointments.subjectId, days.map((d) => d.id)), isNotNull(appointments.createdBy))).limit(1)
      : [];
    if (!job || job.updatedBy || job.archivedAt || booked.length || days.some((d) => d.createdBy || d.updatedBy)) {
      tally('job_day', 'kept');
      return;
    }
    const wanted = [...new Set(dates)].sort();
    const free = days.filter((d) => !wanted.includes(d.dayDate));
    for (const date of wanted) {
      const note = notes[date] ?? null;
      const same = days.find((d) => d.dayDate === date);
      if (same) {
        if ((same.notes ?? null) !== note) {
          await updateRecord(s, jobDayEntity, same.id, { notes: note });
          tally('job_day', 'updated');
        } else tally('job_day', 'unchanged');
        continue;
      }
      const reuse = free.shift();
      if (reuse) {
        await updateRecord(s, jobDayEntity, reuse.id, { dayDate: date, notes: note });
        tally('job_day', 'updated');
      } else {
        await createRecord(s, jobDayEntity, { jobId, dayDate: date, startTime: '08:00', durationMinutes: Math.round(settings.defaultJobHours * 60), crewSize: 2, trucks: 1, notes: note });
        tally('job_day', 'created');
      }
    }
    for (const d of free) {
      const now = new Date();
      await txOf(s).update(hhmcJobDays).set({ archivedAt: now }).where(and(s.where(hhmcJobDays), eq(hhmcJobDays.id, d.id), isNull(hhmcJobDays.archivedAt)));
      await logActivity(txOf(s), s.ctx, { action: 'archive', entityType: jobDayEntity.key, entityId: d.id, summary: `Archived job day "${d.dayDate}" (no longer a work-order day in Movegistics)`, before: { archivedAt: null }, after: { archivedAt: now.toISOString() } });
      tally('job_day', 'updated');
    }
    await syncAppointments(jobId, jobNumber, holdsTrucks, customerId);
  }

  /**
   * A move still to come that Movegistics has booked holds trucks here too, so a new booking can't
   * take them and the schedule shows the day as busy: one appointment per truck per day, a free
   * truck where there is one ("no truck yet" otherwise; Movegistics assigns none). Kept in step
   * with the days on every re-import; past days are history and left alone.
   */
  async function syncAppointments(jobId: string, jobNumber: string, holdsTrucks: boolean, customerId: string) {
    const tz = s.ctx.business.timeZone;
    const today = localDate(new Date(), tz);
    const allDays = await s.db.select().from(hhmcJobDays).where(and(s.where(hhmcJobDays, 'include'), eq(hhmcJobDays.jobId, jobId)));
    const dayById = new Map(allDays.map((d) => [d.id, d]));
    const existing = allDays.length
      ? await s.db
          .select()
          .from(appointments)
          .where(and(s.where(appointments), eq(appointments.subjectType, jobDayEntity.key), inArray(appointments.subjectId, allDays.map((d) => d.id)), ne(appointments.status, 'canceled')))
      : [];
    const startOf = (d: typeof hhmcJobDays.$inferSelect) => localTime(d.dayDate, d.startTime, tz);
    const covered = new Set<string>();
    for (const a of existing) {
      const day = dayById.get(a.subjectId ?? '');
      if (day && !day.archivedAt && day.dayDate < today) continue; // history
      if (holdsTrucks && day && !day.archivedAt && a.startsAt.getTime() === startOf(day).getTime()) {
        covered.add(day.id);
        tally('appointment', 'unchanged');
        continue;
      }
      await updateRecord(s, appointmentEntity, a.id, { status: 'canceled', notes: `${a.notes ?? ''} · changed in Movegistics`.trim() });
      tally('appointment', 'updated');
    }
    if (!holdsTrucks) return;
    const fleet = await trucksOf(s);
    for (const day of allDays.filter((d) => !d.archivedAt && d.dayDate >= today && !covered.has(d.id))) {
      const startsAt = startOf(day);
      const endsAt = new Date(startsAt.getTime() + day.durationMinutes * 60_000);
      const taken = new Set<string>();
      for (let i = 0; i < Math.max(1, day.trucks); i++) {
        let resourceId: string | null = null;
        for (const truck of fleet) {
          if (taken.has(truck.id)) continue;
          if ((await findConflicts(s, { startsAt, endsAt, resourceId: truck.id })).length === 0) {
            resourceId = truck.id;
            break;
          }
        }
        if (resourceId) taken.add(resourceId);
        // Movegistics already booked it: a sold-out mark made here does not undo that.
        await bookAppointment(s, { customerId, kind: 'hhmc.job_day', startsAt, endsAt, status: 'confirmed', resourceId, subjectType: jobDayEntity.key, subjectId: day.id, notes: `${jobNumber} · booked in Movegistics${resourceId ? '' : ' · no truck yet'}` }, { overrideBlocks: true });
        tally('appointment', 'created');
      }
    }
  }

  // ---- customers
  await each(n.contacts as NContact[], async (c) => {
    const existing = existingCustomer(c.email, c.phone);
    const { id, created } = await upsert('contact', c.sid, customerEntity, { kind: 'person', firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, notes: c.notes, externalRef: `movegistics:${c.sid}` }, { createdOn: c.createdOn, existing: refs.has(`contact:${c.sid}`) ? null : existing, raw: c.raw });
    for (const d of c.duplicates) await linkAlso('contact', d.sid, customerEntity, id, d.raw);
    if (created) {
      if (c.email) customerByEmail.set(c.email, id);
      // Not added to the phone map: within one run, normalize() has already decided who is the
      // same person; phone matching is only for customers that existed before this run.
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
        internalNote: l.internalNote, bedrooms: l.bedrooms, status: l.status, customerId: customerId(l.contactSid),
        disqualifiedReason: l.disqualifiedReason, disqualifiedAt: at(l.disqualifiedOn), convertedAt: at(l.qualifiedOn),
        moveType: l.moveType, storage: l.storage, rating: l.rating, utmSource: l.utmSource, utmMedium: l.utmMedium, utmCampaign: l.utmCampaign, gclid: l.gclid, fbclid: l.fbclid,
      },
      {
        createdOn: l.createdOn,
        raw: l.raw,
        updatable: ['firstName', 'lastName', 'email', 'phone', 'source', 'sourceDetail', 'moveDate', 'originAddress', 'destinationAddress', 'ownerName', 'customerNote', 'internalNote', 'customerId', 'status', 'disqualifiedReason', 'disqualifiedAt', 'convertedAt', 'moveType', 'storage', 'rating', 'utmSource', 'utmMedium', 'utmCampaign', 'gclid', 'fbclid', 'bedrooms'],
      },
    );
  });

  // ---- jobs (work requests), each with its quote (section totals), days
  const estimatesOf = new Map<string, NEstimate[]>();
  for (const e of n.estimates) estimatesOf.set(e.jobSid, [...(estimatesOf.get(e.jobSid) ?? []), e]);
  await each(n.jobs as NJob[], async (j) => {
    const cust = customerId(j.contactSid);
    if (!cust) throw new Error(`Work request without a customer (import bug): ${j.sid}`);
    const booked = j.stage === 'booked' || j.stage === 'completed' || j.stage === 'closed';
    const { id: jobId, created, kept } = await upsert(
      'work_request',
      j.sid,
      jobEntity,
      {
        jobNumber: j.sid, customerId: cust, originAddress: j.origin, destinationAddress: j.destination, moveDate: j.moveDate, tentative: j.tentative,
        serviceType: j.serviceType, jobType: j.jobType, customerComments: j.customerComments, internalNotes: j.internalNotes, ownerName: j.ownerName,
        source: j.source, sourceDetail: j.sourceDetail, stage: j.stage, lostReason: j.stage === 'lost' ? j.lostReason : null,
        cancelledReason: j.stage === 'cancelled' ? 'Work order cancelled in Movegistics' : null, automationOptIn: false,
        // Booked when its first work order was made (Movegistics' booking step), else on the move day.
        bookedAt: booked ? at(j.bookedOn ?? j.days[0] ?? j.moveDate ?? j.createdOn) : null,
        completedAt: j.stage === 'completed' || j.stage === 'closed' ? at(j.days.at(-1) ?? j.moveDate) : null,
        closedAt: j.stage === 'closed' ? at(j.days.at(-1) ?? j.moveDate) : null,
        companyName: j.companyName,
        scopeOfWork: j.placeholder ? (j.sid.startsWith('estimate-job:') ? 'Imported from a Movegistics estimate that named no work request.' : 'Imported from a Movegistics invoice that named no work request.') : null,
        bedrooms: j.bedrooms, rating: j.rating, coordinators: j.coordinators,
      },
      {
        createdOn: j.createdOn,
        raw: j.raw,
        updatable: ['customerId', 'originAddress', 'destinationAddress', 'moveDate', 'tentative', 'serviceType', 'jobType', 'customerComments', 'internalNotes', 'ownerName', 'source', 'sourceDetail', 'stage', 'lostReason', 'cancelledReason', 'bookedAt', 'completedAt', 'closedAt', 'companyName', 'bedrooms', 'rating', 'coordinators'],
      },
    );
    // Work orders: their own links (raw rows); the days follow them unless someone changed them in SAI.
    for (const w of j.workOrders) await linkAlso('work_order', w.sid, jobEntity, jobId, w.raw);
    const days = booked ? (j.days.length ? j.days : j.moveDate ? [j.moveDate] : []) : [];
    if (!kept) await syncDays(jobId, j.sid, days, j.dayNotes, j.stage === 'booked', cust);
    if (!created) return; // the quote is made once; later runs leave staff's changes alone
    const quote = (await createRecord(s, quoteEntity, { jobId, serviceTaxOn: false, convenienceFeeOn: false })) as { id: string };
    const sectionLines = (SECTION_KEYS as SectionKey[]).filter((k) => (j.sections[k] ?? 0) > 0);
    const lines = sectionLines.length ? sectionLines.map((k) => ({ section: k, cents: j.sections[k] })) : j.amountCents > 0 ? [{ section: 'transportation_labor' as SectionKey, cents: j.amountCents }] : [];
    for (const [i, l] of lines.entries()) {
      await createRecord(s, quoteLineEntity, { quoteId: quote.id, section: l.section, name: `${sectionLabel(l.section)} (Movegistics total)`, unit: 'each', qtyHundredths: 100, rateCents: l.cents, description: 'Imported: Movegistics exports totals by section, not line items.', sortOrder: i });
    }
  });

  // Deposits are paid on the work request's estimate in force; worked out first so they are part of
  // the estimate's own imported values (its hash, its "kept in SAI" check, one write).
  const inForce = new Map<string, string>(); // job sid → its estimate in force
  for (const e of n.estimates) if (e.status === 'signed' || ((e.status === 'sent' || e.status === 'viewed') && !inForce.has(e.jobSid))) inForce.set(e.jobSid, e.sid);
  const depositPaid = new Map<string, number>();
  for (const p of n.payments) {
    const estimateSid = !p.invoiceSid && p.jobSid ? inForce.get(p.jobSid) : undefined;
    if (estimateSid) depositPaid.set(estimateSid, (depositPaid.get(estimateSid) ?? 0) + p.amountCents - p.refundedCents);
  }

  // ---- estimates (frozen, versioned; Movegistics exports totals only)
  const depositBp = bp(settings.depositPercent);
  const jobBySid = new Map(n.jobs.map((j) => [j.sid, j]));
  const contactBySid = new Map(n.contacts.map((c) => [c.sid, c]));
  await each(n.estimates as NEstimate[], async (e) => {
    const jobId = ids.get(`work_request:${e.jobSid}`)!;
    const job = jobBySid.get(e.jobSid)!;
    const contact = contactBySid.get(job.contactSid);
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
        createdByName: e.createdByName, signatureName: e.status === 'signed' ? 'Signed in Movegistics' : null, depositPaidCents: depositPaid.get(e.sid) ?? 0,
      },
      {
        createdOn: e.createdOn,
        raw: e.raw,
        updatable: live ? ['status', 'viewedAt', 'signedAt', 'createdByName', 'depositPaidCents'] : ['status', 'voidedAt', 'voidReason', 'createdByName', 'depositPaidCents'],
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
    // What Movegistics counts as received, split into the work request's deposit credited to this
    // invoice and payments made on it; the balance stays exactly Movegistics' own.
    const paid = i.amountCents - i.balanceCents - i.depositCreditCents;
    const { id: invoiceId, created, updated } = await upsert(
      'invoice',
      i.sid,
      invoiceEntity,
      {
        invoiceNumber: i.sid, jobId, customerId: customerId(i.contactSid), status: i.status, terms: 'due_on_receipt', invoiceDate: i.invoiceDate, dueDate: i.dueDate,
        poNumber: i.poNumber, serviceTaxOn: false, convenienceFeeOn: false, serviceTaxBp: bp(settings.serviceTaxPercent), convenienceFeeBp: bp(settings.convenienceFeePercent),
        subtotalCents: i.amountCents, serviceTaxCents: 0, convenienceFeeCents: 0, totalCents: i.amountCents, depositReceivedCents: i.depositCreditCents, paidCents: paid,
        sentAt: i.status === 'draft' ? null : at(i.invoiceDate), paidAt: i.status === 'paid' ? at(i.invoiceDate) : null,
        remarks: `Imported from Movegistics (made by ${i.ownerName ?? 'unknown'}). Balance as Movegistics showed it on import.`,
      },
      { createdOn: i.invoiceDate, raw: i.raw, updatable: ['status', 'dueDate', 'paidCents', 'depositReceivedCents', 'paidAt', 'sentAt', 'subtotalCents', 'totalCents', 'poNumber'] },
    );
    if (updated) {
      const [line] = await s.db.select({ id: hhmcInvoiceLines.id, rateCents: hhmcInvoiceLines.rateCents }).from(hhmcInvoiceLines).where(and(s.where(hhmcInvoiceLines), eq(hhmcInvoiceLines.invoiceId, invoiceId), eq(hhmcInvoiceLines.sortOrder, 0), like(hhmcInvoiceLines.name, 'Movegistics invoice %'))).limit(1);
      if (line && line.rateCents !== i.amountCents) await updateRecord(s, invoiceLineEntity, line.id, { rateCents: i.amountCents });
    }
    if (created) await createRecord(s, invoiceLineEntity, { invoiceId, section: 'transportation_labor', name: `Movegistics invoice ${i.sid} total (line items were not in the export)`, unit: 'each', qtyHundredths: 100, rateCents: i.amountCents, serviceDate: i.invoiceDate, sortOrder: 0 });
  });

  // ---- payments (already received; recorded, never charged)
  await each(n.payments as NPayment[], async (p) => {
    const estimateSid = !p.invoiceSid && p.jobSid ? inForce.get(p.jobSid) : undefined;
    const subjectType = p.invoiceSid ? invoiceEntity.key : estimateSid ? estimateEntity.key : p.jobSid ? jobEntity.key : null;
    const subjectId = p.invoiceSid ? ids.get(`invoice:${p.invoiceSid}`)! : estimateSid ? ids.get(`estimate:${estimateSid}`)! : p.jobSid ? ids.get(`work_request:${p.jobSid}`)! : null;
    const contactSid = p.contactSid ?? (p.jobSid ? jobBySid.get(p.jobSid)?.contactSid ?? null : null);
    await upsert(
      'payment',
      p.sid,
      paymentEntity,
      {
        customerId: customerId(contactSid), kind: 'charge', amountCents: p.amountCents, currency: 'usd', status: 'succeeded', method: p.method, provider: 'manual',
        providerRef: `movegistics:${p.sid}`, cardBrand: p.cardBrand, cardLast4: p.cardLast4, refundedCents: p.refundedCents, description: p.description,
        subjectType, subjectId, paidAt: at(p.paidOn),
      },
      { createdOn: p.paidOn, raw: p.raw, updatable: ['refundedCents', 'description', 'subjectType', 'subjectId', 'customerId', 'amountCents', 'method', 'paidAt'] },
    );
  });



  return { stats, ids };
}
