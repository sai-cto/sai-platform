/**
 * The managers' three day-one must-haves, end to end, on a REAL imported repeat customer — run
 * only against a throw-away COPY of the local database (its name must end in "_copy"):
 *
 *   1. Lead → Estimate → Invoice   2. payments linked to the job and invoice   3. the move on the calendar
 *
 * As the HHMC general manager (fake seed login). Emails go to a silent recorder (nothing is sent,
 * nothing printed); cards use the mock provider (nothing charged). Prints steps and amounts only,
 * never names or contact details.
 *
 *   DATABASE_URL=…/sai_copy DATABASE_OWNER_URL=…/sai_copy npx tsx scripts/hhmc-import/must-haves.ts
 */
import { loadEnv, requireEnv } from '../lib/env';

function check(ok: unknown, what: string) {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log(`  ✓ ${what}`);
}

async function main() {
  loadEnv();
  const db = new URL(requireEnv('DATABASE_URL'));
  if (!db.pathname.endsWith('_copy') || !['127.0.0.1', 'localhost', '[::1]'].includes(db.hostname) || db.searchParams.has('host') || db.searchParams.has('hostaddr')) throw new Error('Refusing: run this only against a local copy whose name ends in "_copy".');
  // Pilot / demo mode would force the printing email channel; a real card provider must never be used.
  if (process.env.PILOT_MODE === 'true' || process.env.DEMO_MODE === 'true') throw new Error('Refusing: unset PILOT_MODE and DEMO_MODE first.');
  process.env.PAYMENT_PROVIDER = 'mock';
  const { and, desc, eq, sql } = await import('drizzle-orm');
  const { getDb, closeDb } = await import('../../src/core/db/client');
  const { users, customers, notifications } = await import('../../src/core/db/schema');
  const { setEmailChannel } = await import('../../src/core/notifications/notifications');
  const { buildBusinessContext } = await import('../../src/core/tenancy/context');
  const { buildLinkContext } = await import('../../src/core/links/links');
  const { withScope } = await import('../../src/core/db/scope');
  const { hhmcJobs, hhmcImportRefs } = await import('../../src/modules/hhmc/schema');
  const { createLead, convertLead } = await import('../../src/modules/hhmc/services/leads');
  const { applyBuilder } = await import('../../src/modules/hhmc/services/builder');
  const { sendEstimate, customerLinkFor, signEstimateByLink, payDepositByLink } = await import('../../src/modules/hhmc/services/estimates');
  const { bookJob, jobDaysOf, setActualTime } = await import('../../src/modules/hhmc/services/booking');
  const { createInvoice, sendInvoice, recordInvoicePayment, balanceOf } = await import('../../src/modules/hhmc/services/invoices');
  const { calendarBetween } = await import('../../src/modules/hhmc/services/calendar');
  const { loadJob } = await import('../../src/modules/hhmc/services/common');

  const sent: string[] = [];
  setEmailChannel({ name: 'silent-recorder', send: async (m) => (sent.push(m.subject), { ok: true }) });

  const [gm] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, 'hhmc.admin@sai.example')).limit(1);
  const ctx = await buildBusinessContext(gm.id, 'hhmc', 'live');
  console.log(`Signed in as the HHMC general manager (${ctx.role}), live data.`);

  // A real imported customer with an email who has moved with HHMC before (a repeat customer).
  const [real] = await withScope(ctx, 'customers.read', (s) =>
    s.db
      .select({ c: customers, jobs: sql<number>`count(${hhmcJobs.id})::int` })
      .from(customers)
      .innerJoin(hhmcJobs, and(eq(hhmcJobs.customerId, customers.id), s.where(hhmcJobs)))
      .innerJoin(hhmcImportRefs, and(eq(hhmcImportRefs.recordId, customers.id), s.where(hhmcImportRefs)))
      .where(and(s.where(customers), sql`${customers.email} is not null`, eq(hhmcJobs.stage, 'closed')))
      .groupBy(customers.id)
      .orderBy(desc(sql`count(${hhmcJobs.id})`))
      .limit(1),
  );
  check(real, `picked a real imported repeat customer (${real.jobs} earlier work requests)`);
  const moveDate = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);

  console.log('1. Lead → Estimate → Invoice');
  const lead = await createLead(ctx, { firstName: real.c.firstName, lastName: real.c.lastName, email: real.c.email, phone: real.c.phone, source: 'Repeat Customer', moveDate, originAddress: '1 Must-have Test St, Ithaca, NY', destinationAddress: '2 Must-have Test Ave, Ithaca, NY' });
  check(lead.status === 'new', 'lead created (call / web form)');
  const { job, customerId } = await convertLead(ctx, lead.id, { serviceType: 'local', jobType: 'Local Full Service Move', crewSize: 2, trucks: 1 });
  check(customerId === real.c.id, 'converting reused the existing customer (no duplicate contact)');
  await applyBuilder(ctx, job.id, { crewSize: '2', hoursMode: 'split', loadHours: '2', driveHours: '0.5', unloadHours: '1.5', cornellian: true, truckSize: '16', truckCount: '1', truckDays: '1', miles: '12', valuation: true, replace: true, materials: {} });
  const estimate = await sendEstimate(ctx, job.id);
  check(estimate.status === 'sent' && estimate.createdByName, `estimate built and sent: ${(estimate.subtotalCents / 100).toFixed(2)} (Cornellian, 4 h, 16' truck), made by "${estimate.createdByName}"`);
  const token = (await customerLinkFor(ctx, estimate.id)).split('/l/')[1];
  const customer = await buildLinkContext(token);
  const signed = await signEstimateByLink(customer, { valuationInitials: 'XX', signatureName: 'Must-have test signature', agree: true, ip: '192.0.2.1', userAgent: 'must-haves script' });
  check(signed.status === 'signed', 'customer signed from the link (valuation initialled)');

  console.log('2. Payments linked to the job and the invoice');
  const deposit = await payDepositByLink(customer, { attemptKey: `mh-${Date.now()}` });
  check(deposit.ok && deposit.payment.subjectId === estimate.id, `20% deposit paid on the estimate (mock card): ${deposit.ok ? (deposit.payment.amountCents / 100).toFixed(2) : '-'}`);
  await bookJob(ctx, job.id);
  check((await withScope(ctx, 'hhmc.jobs.read', (s) => loadJob(s, job.id))).stage === 'booked', 'move booked');

  console.log('3. The move on the calendar');
  const cal = await calendarBetween(ctx, moveDate, new Date(new Date(moveDate).getTime() + 86_400_000).toISOString().slice(0, 10));
  const events = cal.days.flatMap((d) => (d as unknown as { events?: { jobId?: string; kind?: string }[] }).events ?? []);
  check(JSON.stringify(cal.days).includes(job.id), `the booked move is on the calendar on the move date (${events.length} event(s) that day)`);

  console.log('… move day, then the final invoice for the actual work, minus the deposit');
  const days = await withScope(ctx, 'hhmc.jobs.read', (s) => jobDaysOf(s, job.id));
  await setActualTime(ctx, job.id, days[0].id, '4.5');
  const invoice = await createInvoice(ctx, job.id, { terms: 'due_on_receipt' });
  check(invoice.depositReceivedCents > 0, `invoice for the actual 4.5 h: ${(invoice.subtotalCents / 100).toFixed(2)}, deposit ${(invoice.depositReceivedCents / 100).toFixed(2)} subtracted`);
  await sendInvoice(ctx, invoice.id);
  const due = balanceOf(invoice);
  const paid = await recordInvoicePayment(ctx, invoice.id, { amount: (due / 100).toFixed(2), method: 'check', attemptKey: `mh-inv-${Date.now()}` });
  check(paid.ok, `balance ${(due / 100).toFixed(2)} recorded by check against the invoice`);
  const closed = await withScope(ctx, 'hhmc.jobs.read', (s) => loadJob(s, job.id));
  check(closed.stage === 'closed', 'invoice paid in full → work request closed');

  const emails = await withScope(ctx, 'notifications.read', (s) => s.db.select({ id: notifications.id }).from(notifications).where(and(s.where(notifications), eq(notifications.recipient, real.c.email!))));
  check(sent.length > 0 && sent.length === emails.length, `all ${sent.length} customer email(s) went to the silent recorder (nothing was sent or printed)`);
  await closeDb();
  console.log('All three must-haves work end to end on a real customer (in a throw-away copy).');
}

main().catch(async (error) => {
  // Our own messages only: an app or database error can quote a real name or value.
  const message = error instanceof Error ? error.message : '';
  console.error(message.startsWith('Refusing') || message.startsWith('FAILED:') ? message : `Failed: ${error instanceof Error ? error.name : 'error'} (details not printed: they can hold real data)`);
  process.exit(1);
});
