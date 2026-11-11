/**
 * FAKE data for HHMC: fills the sandbox (test mode) and the local demo database.
 *
 * Nothing here is real: customers come from the core's fake-person helper, addresses are
 * invented. The catalog rates are the ones in ref §4.1. Every total is worked out by the same
 * pricing engine the app uses (services/pricing.ts), so the demo moves add up.
 */
import type { Scope } from '@/core/db/scope';
import {
  appointmentEntity,
  customerEntity,
  paymentEntity,
  resourceEntity,
} from '@/core/records/core-entities';
import { fakePerson, pick, seedRecords, seededRandom } from '@/core/sandbox/seeding';
import {
  automationRuleEntity,
  catalogItemEntity,
  discountEntity,
  estimateEntity,
  invoiceEntity,
  invoiceLineEntity,
  jobDayEntity,
  jobEntity,
  leadEntity,
  noteEntity,
  queueEntity,
  quoteEntity,
  quoteLineEntity,
  templateEntity,
} from './entities';
import { addDays, dueDateFor, localDate, localTime } from './rules';
import type { EstimateSnapshot, LeadSource, ServiceType, Stage } from './schema';
import { CATALOG, DISCOUNTS, RULES, TEMPLATES } from './seed-data';
import { bp, settingsDefaults } from './settings';
import { computeDeposit, computeTotals, lineTotalCents, type PriceLine } from './services/pricing';

const DAY = 24 * 60 * 60 * 1000;
const STREETS = ['Maple Ave', 'College Ave', 'Dryden Rd', 'Stewart Ave', 'Buffalo St', 'Cayuga St', 'Linden Ave', 'Elm St', 'Hudson St', 'Aurora St'];
const TOWNS = ['Ithaca, NY 14850', 'Lansing, NY 14882', 'Dryden, NY 13053', 'Trumansburg, NY 14886'];
const FAR = ['Syracuse, NY 13210', 'Albany, NY 12203', 'Rochester, NY 14607', 'Boston, MA 02134', 'Philadelphia, PA 19104'];

type DemoJob = { stage: Stage; service: ServiceType; daysFromNow: number; crew: 2 | 3 | 4; hours: number; source: LeadSource; fromLead: boolean };

// prettier-ignore
const JOBS: DemoJob[] = [
  { stage: 'qualified', service: 'local', daysFromNow: 21, crew: 2, hours: 3, source: 'Google', fromLead: true },
  { stage: 'qualified', service: 'local', daysFromNow: 30, crew: 3, hours: 4, source: 'Website', fromLead: true },
  { stage: 'qualified', service: 'intrastate', daysFromNow: 40, crew: 2, hours: 10, source: 'Referral', fromLead: false },
  { stage: 'estimate_sent', service: 'local', daysFromNow: 12, crew: 2, hours: 2.5, source: 'Google', fromLead: true },
  { stage: 'estimate_sent', service: 'local', daysFromNow: 16, crew: 3, hours: 5, source: 'Cornellian', fromLead: true },
  { stage: 'estimate_sent', service: 'local', daysFromNow: 9, crew: 2, hours: 3, source: 'Repeat Customer', fromLead: false },
  { stage: 'estimate_sent', service: 'intrastate', daysFromNow: 25, crew: 2, hours: 10, source: 'Website', fromLead: true },
  { stage: 'booked', service: 'local', daysFromNow: 3, crew: 3, hours: 4, source: 'Google', fromLead: true },
  { stage: 'booked', service: 'local', daysFromNow: 5, crew: 2, hours: 3, source: 'Social', fromLead: true },
  { stage: 'booked', service: 'interstate', daysFromNow: 7, crew: 4, hours: 12, source: 'Referral', fromLead: false },
  { stage: 'completed', service: 'local', daysFromNow: -6, crew: 2, hours: 3, source: 'Website', fromLead: true },
  { stage: 'completed', service: 'local', daysFromNow: -15, crew: 3, hours: 5, source: 'Google', fromLead: true },
  { stage: 'closed', service: 'local', daysFromNow: -30, crew: 2, hours: 2, source: 'Cornellian', fromLead: true },
  { stage: 'closed', service: 'intrastate', daysFromNow: -55, crew: 2, hours: 9, source: 'Third-party', fromLead: true },
  { stage: 'closed', service: 'local', daysFromNow: -80, crew: 3, hours: 4, source: 'Repeat Customer', fromLead: false },
  { stage: 'lost', service: 'local', daysFromNow: 14, crew: 2, hours: 3, source: 'Google', fromLead: true },
  { stage: 'cancelled', service: 'local', daysFromNow: 10, crew: 2, hours: 3, source: 'Social', fromLead: true },
];

const JOB_TYPE: Record<ServiceType, string> = { local: 'Local Full Service Move', intrastate: 'Intrastate Move', interstate: 'Interstate Move' };

export async function seedDemoData(s: Scope): Promise<void> {
  const random = seededRandom(`hhmc:${s.ctx.environment}`);
  const now = new Date();
  const tz = s.ctx.business.timeZone;
  const settings = settingsDefaults;
  const options = { serviceTaxBp: bp(settings.serviceTaxPercent), convenienceFeeBp: bp(settings.convenienceFeePercent) };
  const depositBp = bp(settings.depositPercent);
  const today = localDate(now, tz);

  // ---- settings data
  const catalog = await seedRecords(s, catalogItemEntity, CATALOG.map((item, i) => ({ ...item, isDefaultForLocal: item.isDefaultForLocal ?? false, sortOrder: i })));
  const item = (name: string) => catalog.find((c) => c.name === name)!;
  await seedRecords(s, discountEntity, DISCOUNTS);
  const templates = await seedRecords(s, templateEntity, TEMPLATES);
  const rules = await seedRecords(s, automationRuleEntity, RULES.map((r) => ({ ...r, isActive: true })));
  const rule = (key: string) => rules.find((r) => r.key === key)!;
  const terms = (service: ServiceType) => templates.find((t) => t.key === `terms_${service}`)!;
  const valuation = templates.find((t) => t.key === 'valuation_basic')!;

  // ---- trucks (core resources)
  const trucks = await seedRecords(s, resourceEntity, [
    { kind: 'truck', name: "Truck 1 · 16'", isActive: true },
    { kind: 'truck', name: "Truck 2 · 26'", isActive: true },
    { kind: 'truck', name: 'Van', isActive: true },
  ]);

  // ---- customers (one per job) and the open leads
  const people = Array.from({ length: JOBS.length + 12 }, (_, i) => fakePerson(random, i + 1));
  const jobCustomers = await seedRecords(
    s,
    customerEntity,
    JOBS.map((_, i) => ({ ...people[i], kind: 'person' as const, notes: 'Fake demo customer', createdAt: new Date(now.getTime() - (100 - i * 4) * DAY) })),
  );
  const address = () => `${10 + Math.floor(random() * 480)} ${pick(random, STREETS)}, ${pick(random, TOWNS)}`;

  // Leads: converted ones (for jobs that came from a lead), new ones, disqualified ones.
  const leadRows = [
    ...JOBS.map((job, i) => ({ job, i })).filter(({ job }) => job.fromLead).map(({ job, i }) => {
      const createdAt = new Date(now.getTime() - (Math.max(-job.daysFromNow, 0) + 20 + Math.floor(random() * 10)) * DAY);
      return {
        leadNumber: `L-${String(i + 1).padStart(6, '0')}`,
        ...people[i],
        source: job.source,
        sourceDetail: job.source === 'Google' ? 'Search ad' : null,
        moveDate: addDays(today, job.daysFromNow),
        bedrooms: pick(random, ['Studio', '1 bedroom', '2 bedrooms', '3 bedrooms']),
        originAddress: address(),
        destinationAddress: job.service === 'local' ? address() : `${10 + Math.floor(random() * 400)} Main St, ${pick(random, FAR)}`,
        status: 'converted' as const,
        convertedAt: new Date(createdAt.getTime() + 3 * 3600 * 1000),
        customerId: jobCustomers[i].id,
        utmSource: job.source === 'Google' ? 'google' : null,
        utmMedium: job.source === 'Google' ? 'cpc' : null,
        gclid: job.source === 'Google' ? `fake-gclid-${i}` : null,
        createdAt,
      };
    }),
    ...Array.from({ length: 12 }, (_, k) => {
      const i = JOBS.length + k;
      const disqualified = k >= 9;
      const createdAt = new Date(now.getTime() - (k * 2 + 1) * DAY - Math.floor(random() * 12) * 3600 * 1000);
      return {
        leadNumber: `L-${String(i + 1).padStart(6, '0')}`,
        ...people[i],
        source: pick(random, ['Google', 'Website', 'Referral', 'Social', 'Cornellian', 'Other'] as const),
        sourceDetail: k === 4 ? 'Flyer at the library' : null,
        moveDate: addDays(today, 10 + k * 3),
        bedrooms: pick(random, ['Studio', '1 bedroom', '2 bedrooms']),
        originAddress: address(),
        destinationAddress: address(),
        customerNote: k % 3 === 0 ? 'Couch, bed, desk, about 20 boxes. Third floor, no elevator.' : null,
        status: disqualified ? ('disqualified' as const) : ('new' as const),
        disqualifiedReason: disqualified ? pick(random, ['Outside our area', 'Went with another mover', 'Wrong number']) : null,
        disqualifiedAt: disqualified ? new Date(createdAt.getTime() + DAY) : null,
        noContactStartedAt: k === 1 ? new Date(createdAt.getTime() + 2 * 3600 * 1000) : null,
        createdAt,
      };
    }),
  ];
  const leads = await seedRecords(s, leadEntity, leadRows);
  const leadOf = (i: number) => leads.find((l) => l.customerId === jobCustomers[i].id) ?? null;

  // ---- jobs, quotes, lines, job days
  const jobs = await seedRecords(
    s,
    jobEntity,
    JOBS.map((job, i) => {
      const lead = leadOf(i);
      const createdAt = lead ? new Date(lead.createdAt.getTime() + 3 * 3600 * 1000) : new Date(now.getTime() - (Math.max(-job.daysFromNow, 0) + 15) * DAY);
      const bookedAt = ['booked', 'completed', 'closed'].includes(job.stage) ? new Date(createdAt.getTime() + 4 * DAY) : null;
      return {
        jobNumber: `J-${String(i + 1).padStart(6, '0')}`,
        customerId: jobCustomers[i].id,
        leadId: lead?.id ?? null,
        originAddress: lead?.originAddress ?? address(),
        destinationAddress: lead?.destinationAddress ?? (job.service === 'local' ? address() : `${10 + Math.floor(random() * 400)} Main St, ${pick(random, FAR)}`),
        extraStops: i === 4 ? ['Storage unit, 5 Elm St, Ithaca, NY 14850'] : [],
        moveDate: addDays(today, job.daysFromNow),
        tentative: job.stage === 'qualified' && i % 2 === 0,
        arrivalWindow: settings.defaultArrivalWindow,
        serviceType: job.service,
        jobType: JOB_TYPE[job.service],
        bedrooms: lead?.bedrooms ?? '2 bedrooms',
        crewSize: job.crew,
        trucks: job.service === 'interstate' ? 2 : 1,
        customerComments: lead?.customerNote ?? null,
        scopeOfWork: 'Bed, dresser, couch, desk, about 25 boxes (mostly packed). Second floor walk-up at pickup; elevator at drop-off.',
        ownerName: 'HHMC Admin',
        coordinators: i % 3 === 0 ? ['HHMC Staff'] : [],
        rating: pick(random, ['hot', 'warm', 'cold'] as const),
        automationOptIn: i !== 5,
        source: job.source,
        stage: job.stage,
        lostReason: job.stage === 'lost' ? 'Price: went with a cheaper quote' : null,
        cancelledReason: job.stage === 'cancelled' ? 'Customer postponed the move indefinitely' : null,
        bookedAt,
        completedAt: ['completed', 'closed'].includes(job.stage) ? new Date(now.getTime() + job.daysFromNow * DAY + 6 * 3600 * 1000) : null,
        closedAt: job.stage === 'closed' ? new Date(now.getTime() + (job.daysFromNow + 3) * DAY) : null,
        createdAt,
      };
    }),
  );

  const quotes = await seedRecords(s, quoteEntity, jobs.map((job, i) => ({ jobId: job.id, serviceTaxOn: JOBS[i].service !== 'local', convenienceFeeOn: JOBS[i].service === 'local' })));

  const linesFor = (i: number): (PriceLine & { name: string; unit: string; catalogItemId: string })[] => {
    const job = JOBS[i];
    const men = item(`${job.crew} Men`);
    const lines = [{ section: men.section, name: men.name, unit: men.unit, catalogItemId: men.id, qtyHundredths: Math.round(job.hours * 100), rateCents: men.rateCents }];
    if (job.service === 'local') {
      const truck = item("16' Truck Local");
      lines.push({ section: truck.section, name: truck.name, unit: truck.unit, catalogItemId: truck.id, qtyHundredths: 100, rateCents: truck.rateCents });
    } else {
      const day = item("16' Truck Long Distance – Day");
      const miles = item("16' Truck Long Distance – Mileage");
      lines.push({ section: day.section, name: day.name, unit: day.unit, catalogItemId: day.id, qtyHundredths: 100, rateCents: day.rateCents });
      lines.push({ section: miles.section, name: miles.name, unit: miles.unit, catalogItemId: miles.id, qtyHundredths: (120 + i * 17) * 100, rateCents: miles.rateCents });
    }
    if (i % 4 === 1) {
      const box = item('Medium Box');
      lines.push({ section: box.section, name: box.name, unit: box.unit, catalogItemId: box.id, qtyHundredths: 1000, rateCents: box.rateCents });
    }
    return lines;
  };
  await seedRecords(
    s,
    quoteLineEntity,
    jobs.flatMap((_, i) => linesFor(i).map((l, n) => ({ quoteId: quotes[i].id, section: l.section, catalogItemId: l.catalogItemId, name: l.name, unit: l.unit, qtyHundredths: l.qtyHundredths, rateCents: l.rateCents, discountType: i === 4 && n === 0 ? ('percent' as const) : null, discountValue: i === 4 && n === 0 ? 500 : null, sortOrder: n }))),
  );

  const jobDays = await seedRecords(
    s,
    jobDayEntity,
    jobs.flatMap((job, i) => {
      const demo = JOBS[i];
      const days = demo.service === 'interstate' ? 2 : 1;
      return Array.from({ length: days }, (_, d) => ({
        jobId: job.id,
        dayDate: addDays(job.moveDate!, d),
        startTime: i % 2 ? '08:00' : '09:00',
        durationMinutes: Math.round((demo.hours / days) * 60),
        crewSize: demo.crew,
        trucks: job.trucks,
        actualMinutes: ['completed', 'closed'].includes(demo.stage) ? Math.round(demo.hours * 60) + 10 : null,
      }));
    }),
  );

  // Booked appointments, one per truck per day (core appointments).
  const appointmentRows = jobDays.flatMap((day) => {
    const i = jobs.findIndex((j) => j.id === day.jobId);
    if (!['booked', 'completed', 'closed'].includes(JOBS[i].stage)) return [];
    const startsAt = localTime(day.dayDate, day.startTime, tz);
    return Array.from({ length: Math.max(1, day.trucks) }, (_, t) => ({
      customerId: jobs[i].customerId,
      kind: 'hhmc.job_day',
      startsAt,
      endsAt: new Date(startsAt.getTime() + day.durationMinutes * 60_000),
      status: JOBS[i].stage === 'booked' ? ('confirmed' as const) : ('completed' as const),
      resourceId: trucks[(i + t) % trucks.length].id,
      subjectType: jobDayEntity.key,
      subjectId: day.id,
      notes: `${jobs[i].jobNumber} · M:${day.crewSize} / T:${day.trucks}`,
    }));
  });
  await seedRecords(s, appointmentEntity, appointmentRows);

  // ---- estimates (with deposits) for every job that got one
  const estimateRows: Parameters<typeof seedRecords<typeof estimateEntity.table>>[2] = [];
  const depositPayments: Parameters<typeof seedRecords<typeof paymentEntity.table>>[2] = [];
  const estimatedJobs = jobs.map((job, i) => ({ job, i })).filter(({ i }) => !['qualified'].includes(JOBS[i].stage) || i === 2);
  for (const { job, i } of estimatedJobs) {
    const demo = JOBS[i];
    const lines = linesFor(i).map((l, n) => ({ ...l, discountType: i === 4 && n === 0 ? ('percent' as const) : null, discountValue: i === 4 && n === 0 ? 500 : null }));
    const opts = { ...options, serviceTaxOn: demo.service !== 'local', convenienceFeeOn: demo.service === 'local' };
    const totals = computeTotals(lines, opts);
    const sentAt = new Date(job.createdAt.getTime() + (6 + i) * 3600 * 1000);
    const signed = ['booked', 'completed', 'closed'].includes(demo.stage) || (demo.stage === 'estimate_sent' && i === 5);
    const viewed = signed || (demo.stage === 'estimate_sent' && i === 4) || demo.stage === 'lost';
    const status = i === 2 ? 'void' : demo.stage === 'cancelled' ? 'void' : signed ? 'signed' : viewed && demo.stage !== 'lost' ? 'viewed' : demo.stage === 'lost' ? 'void' : 'sent';
    const snapshot: EstimateSnapshot = {
      title: `${demo.service === 'local' ? 'Local' : demo.service === 'intrastate' ? 'Intrastate' : 'Interstate'} Estimate for ${people[i].firstName} ${people[i].lastName}`,
      customerName: `${people[i].firstName} ${people[i].lastName}`,
      customerEmail: people[i].email,
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
      lines: lines.map((l) => ({ section: l.section, name: l.name, unit: l.unit, qtyHundredths: l.qtyHundredths, rateCents: l.rateCents, discountType: l.discountType, discountValue: l.discountValue, totalCents: lineTotalCents(l), description: null })),
      sections: totals.sections,
      serviceTaxOn: opts.serviceTaxOn,
      convenienceFeeOn: opts.convenienceFeeOn,
      serviceTaxBp: opts.serviceTaxBp,
      convenienceFeeBp: opts.convenienceFeeBp,
      depositBp,
      termsTitle: terms(job.serviceType).name,
      termsBody: terms(job.serviceType).body,
      valuation: valuation.body,
    };
    const deposit = computeDeposit(totals, depositBp, { byCard: true, convenienceFeeBp: opts.convenienceFeeBp });
    const paidDeposit = signed;
    if (paidDeposit) {
      depositPayments.push({
        customerId: job.customerId,
        kind: 'charge',
        amountCents: deposit.totalDueCents,
        status: 'succeeded',
        method: 'card',
        provider: 'mock',
        providerRef: `mock_ch_demo_hhmc_dep_${i}`,
        idempotencyKey: `hhmc-deposit:demo-${i}`,
        cardBrand: 'Visa',
        cardLast4: '4242',
        description: `Deposit for ${job.jobNumber}`,
        subjectType: estimateEntity.key,
        subjectId: `index:${i}`,
        paidAt: new Date(sentAt.getTime() + 2 * DAY),
        createdAt: new Date(sentAt.getTime() + 2 * DAY),
      });
    }
    estimateRows.push({
      jobId: job.id,
      estimateNumber: `E-${String(i + 1).padStart(6, '0')}`,
      version: 1,
      status,
      snapshot,
      subtotalCents: totals.subtotalCents,
      serviceTaxCents: totals.serviceTaxCents,
      convenienceFeeCents: totals.convenienceFeeCents,
      totalCents: totals.totalCents,
      depositCents: deposit.depositCents,
      sentAt,
      expiresAt: new Date(sentAt.getTime() + settings.estimateExpiryDays * DAY),
      viewedAt: viewed ? new Date(sentAt.getTime() + 5 * 3600 * 1000) : null,
      signedAt: signed ? new Date(sentAt.getTime() + 2 * DAY) : null,
      valuationInitials: signed ? `${people[i].firstName[0]}${people[i].lastName[0]}` : null,
      signatureName: signed ? `${people[i].firstName} ${people[i].lastName}` : null,
      signedIp: signed ? '192.0.2.10' : null,
      signedUserAgent: signed ? 'Demo browser' : null,
      voidedAt: status === 'void' ? new Date(sentAt.getTime() + 3 * DAY) : null,
      voidReason: status === 'void' ? (demo.stage === 'lost' ? 'Job lost' : 'Replaced or no longer needed') : null,
      depositPaidCents: paidDeposit ? deposit.totalDueCents : 0,
      createdAt: sentAt,
    });
  }
  // Estimates first (the deposit payments point at them through subject_id).
  const estimates = await seedRecords(s, estimateEntity, estimateRows);
  const payments = await seedRecords(
    s,
    paymentEntity,
    depositPayments.map((p) => {
      const i = Number(String(p.subjectId).slice('index:'.length));
      return { ...p, subjectId: estimates.find((e) => e.jobId === jobs[i].id)!.id };
    }),
  );

  // ---- invoices for completed and closed jobs
  const invoiced = jobs.map((job, i) => ({ job, i })).filter(({ i }) => ['completed', 'closed'].includes(JOBS[i].stage));
  const invoiceRows = invoiced.map(({ job, i }, n) => {
    const estimate = estimates.find((e) => e.jobId === job.id && e.status === 'signed')!;
    const invoiceDate = addDays(job.moveDate!, 1);
    const terms = n === 1 ? ('net_7' as const) : ('due_on_receipt' as const);
    const lines = linesFor(i).map((l) => (l.unit === 'hour' ? { ...l, qtyHundredths: Math.round(JOBS[i].hours * 100) + 25 } : l));
    const totals = computeTotals(lines, { ...options, serviceTaxOn: estimate.snapshot.serviceTaxOn, convenienceFeeOn: estimate.snapshot.convenienceFeeOn });
    const closed = JOBS[i].stage === 'closed';
    const balance = totals.totalCents - estimate.depositPaidCents;
    return {
      lines,
      row: {
        invoiceNumber: `I-${String(n + 1).padStart(6, '0')}`,
        jobId: job.id,
        estimateId: estimate.id,
        customerId: job.customerId,
        status: closed ? ('paid' as const) : ('sent' as const),
        terms,
        invoiceDate,
        dueDate: dueDateFor(invoiceDate, terms),
        serviceTaxOn: estimate.snapshot.serviceTaxOn,
        convenienceFeeOn: estimate.snapshot.convenienceFeeOn,
        serviceTaxBp: options.serviceTaxBp,
        convenienceFeeBp: options.convenienceFeeBp,
        subtotalCents: totals.subtotalCents,
        serviceTaxCents: totals.serviceTaxCents,
        convenienceFeeCents: totals.convenienceFeeCents,
        totalCents: totals.totalCents,
        depositReceivedCents: estimate.depositPaidCents,
        paidCents: closed ? balance : 0,
        sentAt: localTime(invoiceDate, '10:00', tz),
        paidAt: closed ? localTime(addDays(invoiceDate, 2), '12:00', tz) : null,
        createdAt: localTime(invoiceDate, '09:30', tz),
      },
      balance,
      closed,
      i,
    };
  });
  const invoices = await seedRecords(s, invoiceEntity, invoiceRows.map((r) => r.row));
  await seedRecords(
    s,
    invoiceLineEntity,
    invoiceRows.flatMap((r, n) => r.lines.map((l, k) => ({ invoiceId: invoices[n].id, section: l.section, name: l.name, unit: l.unit, qtyHundredths: l.qtyHundredths, rateCents: l.rateCents, serviceDate: r.row.invoiceDate, sortOrder: k }))),
  );
  const invoicePayments = await seedRecords(
    s,
    paymentEntity,
    invoiceRows.flatMap((r, n) =>
      r.closed
        ? [{
            customerId: r.row.customerId,
            kind: 'charge' as const,
            amountCents: r.balance,
            status: 'succeeded' as const,
            method: 'card' as const,
            provider: 'mock' as const,
            providerRef: `mock_ch_demo_hhmc_inv_${n}`,
            idempotencyKey: `hhmc-invoice:demo-${n}`,
            cardBrand: 'Visa',
            cardLast4: '4242',
            description: `Payment on ${r.row.invoiceNumber}`,
            subjectType: invoiceEntity.key,
            subjectId: invoices[n].id,
            paidAt: r.row.paidAt!,
            createdAt: r.row.paidAt!,
          }]
        : [],
    ),
  );

  // ---- notes and calls
  await seedRecords(s, noteEntity, [
    { jobId: jobs[3].id, kind: 'call', callOutcome: 'voicemail', body: 'Left a message about the estimate.', authorName: 'HHMC Staff', createdAt: new Date(now.getTime() - 2 * DAY) },
    { jobId: jobs[4].id, kind: 'call', callOutcome: 'spoke', body: 'Customer asked about a Cornellian discount; applied 5%.', authorName: 'HHMC Admin', createdAt: new Date(now.getTime() - DAY) },
    { jobId: jobs[7].id, kind: 'note', callOutcome: null, body: 'Gate code at drop-off: ask the customer on the day.', authorName: 'HHMC Admin', createdAt: new Date(now.getTime() - DAY) },
    { leadId: leads.find((l) => l.status === 'new')!.id, kind: 'call', callOutcome: 'ringcentral', body: 'No answer.', authorName: 'HHMC Staff', createdAt: new Date(now.getTime() - 3600 * 1000) },
  ]);

  // ---- the automation queue: drips waiting for open estimates, sent receipts, one cancelled
  const queueRows: Parameters<typeof seedRecords<typeof queueEntity.table>>[2] = [];
  for (const estimate of estimates.filter((e) => e.status === 'sent' || e.status === 'viewed')) {
    const job = jobs.find((j) => j.id === estimate.jobId)!;
    if (!job.automationOptIn) continue;
    for (const key of ['drip_same_day', 'drip_day2', 'drip_day3', 'drip_day7']) {
      const r = rule(key);
      const dueAt = new Date(estimate.sentAt!.getTime() + r.delayMinutes * 60_000);
      const past = dueAt.getTime() <= now.getTime() - 3600 * 1000;
      queueRows.push({ ruleId: r.id, jobId: job.id, estimateId: estimate.id, recipient: estimate.snapshot.customerEmail ?? 'demo@example.com', dueAt, status: past ? 'sent' : 'queued', sentAt: past ? dueAt : null });
    }
  }
  const signedExample = estimates.find((e) => e.status === 'signed')!;
  queueRows.push({ ruleId: rule('drip_day3').id, jobId: signedExample.jobId, estimateId: signedExample.id, recipient: signedExample.snapshot.customerEmail ?? 'demo@example.com', dueAt: new Date(signedExample.sentAt!.getTime() + 3 * DAY), status: 'cancelled', cancelledReason: 'The estimate was signed.' });
  for (const payment of [...payments, ...invoicePayments]) {
    queueRows.push({ ruleId: rule('payment_receipt').id, paymentId: payment.id, recipient: 'receipts@example.com', dueAt: payment.paidAt!, status: 'sent', sentAt: payment.paidAt! });
  }
  const pastDue = invoices.find((inv) => inv.status === 'sent');
  if (pastDue) {
    queueRows.push({ ruleId: rule('past_due').id, jobId: pastDue.jobId, invoiceId: pastDue.id, recipient: 'billing@example.com', dueAt: new Date(pastDue.sentAt!.getTime() + 8 * DAY), status: 'queued' });
  }
  await seedRecords(s, queueEntity, queueRows);
}
