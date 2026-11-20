/**
 * HHMC's automatic emails (docs/hhmc-emails.md): every trigger fires at the right moment,
 * reschedules move the scheduled emails, cancellations stop them, and nothing ever sends twice.
 * A recording channel stands in for Amazon SES.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { withScope } from '@/core/db/scope';
import { consoleEmailChannel, setEmailChannel, type NotificationChannel } from '@/core/notifications/notifications';
import type { BusinessContext } from '@/core/tenancy/context';
import { P } from '@/modules/hhmc/permissions';
import { hhmcAutomationQueue, hhmcAutomationRules } from '@/modules/hhmc/schema';
import { enqueue, processDueAutomationsInScope } from '@/modules/hhmc/services/automations';
import { convertLead, createLead } from '@/modules/hhmc/services/leads';
import { USERS, ctxFor } from './helpers';

let counter = 0;
const tag = () => `${Date.now().toString(36)}${(counter += 1)}`;
const admin = () => ctxFor(USERS.hhmcAdmin, 'hhmc', 'live');
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

type Sent = { recipient: string; subject: string; body: string };
let sent: Sent[] = [];
const recorder: NotificationChannel = { name: 'recorder', async send(m) { sent.push(m); return { ok: true }; } };
const saved = { ...process.env };

beforeEach(() => {
  sent = [];
  setEmailChannel(recorder);
  // Everyone in these tests may receive real email (the allow-list is tested in email-channel.test.ts).
  delete process.env.EMAIL_ALLOWED_RECIPIENTS;
  delete process.env.PILOT_MODE;
});
afterEach(() => {
  setEmailChannel(consoleEmailChannel);
  for (const key of ['EMAIL_ALLOWED_RECIPIENTS', 'PILOT_MODE'])
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
});

async function newJob(ctx: BusinessContext, moveInDays = 30 + (counter % 200)) {
  const t = tag();
  const lead = await createLead(ctx, {
    firstName: 'Riley',
    lastName: `Workflow${t}`,
    email: `riley.${t}@example.com`,
    phone: `607-555-01${String(counter % 100).padStart(2, '0')}`,
    source: 'Google',
    moveDate: day(moveInDays),
    originAddress: '1 Test St, Ithaca, NY',
    destinationAddress: '2 Test St, Ithaca, NY',
  });
  const { job } = await convertLead(ctx, lead.id, { serviceType: 'local', jobType: 'Local Full Service Move', crewSize: 2, trucks: 1 });
  return { lead, job, email: `riley.${t}@example.com` };
}

async function queueOf(ctx: BusinessContext, jobId: string) {
  return withScope(ctx, P.jobsRead, (s) =>
    s.db
      .select({ q: hhmcAutomationQueue, trigger: hhmcAutomationRules.trigger, key: hhmcAutomationRules.key })
      .from(hhmcAutomationQueue)
      .innerJoin(hhmcAutomationRules, eq(hhmcAutomationRules.id, hhmcAutomationQueue.ruleId))
      .where(and(s.where(hhmcAutomationQueue), eq(hhmcAutomationQueue.jobId, jobId))),
  );
}

describe('nothing sends twice', () => {
  it('the same email for the same records is queued once, however often its event fires', async () => {
    const ctx = await admin();
    const { job, email } = await newJob(ctx);
    const first = await withScope(ctx, P.jobsWrite, (s) => enqueue(s, 'job_booked', { jobId: job.id, recipient: email, optIn: true, notBefore: new Date(Date.now() + 3_600_000) }));
    const again = await withScope(ctx, P.jobsWrite, (s) => enqueue(s, 'job_booked', { jobId: job.id, recipient: email, optIn: true, notBefore: new Date(Date.now() + 3_600_000) }));
    expect(first).toBeGreaterThan(0);
    expect(again).toBe(0);
    const rows = (await queueOf(ctx, job.id)).filter((r) => r.trigger === 'job_booked');
    expect(rows.filter((r) => r.q.status === 'queued')).toHaveLength(first);
  });

  it('two runs of the scheduler at the same moment send each due email once', async () => {
    const ctx = await admin();
    const { job, email } = await newJob(ctx);
    // A receipt is wanted whatever the job's stage, so only the double run can stop it.
    await withScope(ctx, P.jobsWrite, (s) => enqueue(s, 'payment_received', { jobId: job.id, recipient: email, optIn: true, notBefore: new Date(Date.now() + 60_000) }));
    const later = new Date(Date.now() + 2 * 3_600_000);
    await Promise.all([
      withScope(ctx, P.jobsWrite, (s) => processDueAutomationsInScope(s, later)),
      withScope(ctx, P.jobsWrite, (s) => processDueAutomationsInScope(s, later)),
    ]);
    const mine = sent.filter((m) => m.recipient === email);
    const queued = (await queueOf(ctx, job.id)).filter((r) => r.trigger === 'payment_received');
    expect(queued.length).toBeGreaterThan(0);
    expect(mine).toHaveLength(queued.filter((r) => r.q.status === 'sent').length);
    expect(queued.every((r) => r.q.status === 'sent')).toBe(true);
  });
});
