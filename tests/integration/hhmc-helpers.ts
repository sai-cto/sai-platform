/** Builders for HHMC integration tests: a lead, a signed estimate, a booked move. Fake data only. */
import { buildLinkContext } from '@/core/links/links';
import type { BusinessContext } from '@/core/tenancy/context';
import { addJobDay, bookJob } from '@/modules/hhmc/services/booking';
import { customerLinkFor, sendEstimate, signEstimateByLink } from '@/modules/hhmc/services/estimates';
import { convertLead, createLead } from '@/modules/hhmc/services/leads';
import { ctxFor, USERS } from './helpers';

let counter = 0;
export const tag = () => `${Date.now().toString(36)}p${(counter += 1)}`;
export const gm = (env: 'live' | 'sandbox' = 'live') => ctxFor(USERS.hhmcAdmin, 'hhmc', env);
const DAY = 24 * 3600 * 1000;
/** A date `days` from today, "yyyy-mm-dd". */
export const dayFromNow = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

export async function newJob(ctx: BusinessContext, moveDate = dayFromNow(30)) {
  const t = tag();
  const lead = await createLead(ctx, {
    firstName: 'Parity',
    lastName: `Tester${t}`,
    email: `parity.${t}@example.com`,
    phone: `607-555-01${String(counter % 100).padStart(2, '0')}`,
    source: 'Website',
    moveDate,
    originAddress: '1 Test St, Ithaca, NY',
    destinationAddress: '2 Test St, Ithaca, NY',
  });
  const { job } = await convertLead(ctx, lead.id, { serviceType: 'local', jobType: 'Local Full Service Move', crewSize: 2, trucks: 1 });
  return job;
}

/** A job whose estimate the customer has signed (through the customer link). */
export async function signedJob(ctx: BusinessContext, moveDate = dayFromNow(30)) {
  const job = await newJob(ctx, moveDate);
  const estimate = await sendEstimate(ctx, job.id);
  const customer = await buildLinkContext((await customerLinkFor(ctx, estimate.id)).split('/l/')[1]);
  await signEstimateByLink(customer, { valuationInitials: 'PT', signatureName: 'Parity Tester', agree: true, ip: null, userAgent: null });
  return { job, estimate };
}

/** A booked move (one day on the move date unless more are given). */
export async function bookedJob(ctx: BusinessContext, moveDate = dayFromNow(30), extraDays: string[] = []) {
  const { job, estimate } = await signedJob(ctx, moveDate);
  for (const d of extraDays) await addJobDay(ctx, job.id, { dayDate: d, startTime: '08:00', hours: '4', crewSize: '2', trucks: '1' });
  await bookJob(ctx, job.id);
  return { job, estimate };
}
