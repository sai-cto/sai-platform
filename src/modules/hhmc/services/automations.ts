/**
 * Automations (ref §9.2, prompt "Automations"). Rules are rows in hhmc_automation_rules;
 * events put rows in hhmc_automation_queue; processDueAutomations(now) sends what is due
 * through the core's notifications, checking at send time that each email is still wanted.
 *
 * There is no scheduler yet (docs/HANDOFF.md). Due emails go out when someone presses
 * "Run due emails" (tech team) or `npm run hhmc:automations` runs. Emails with no delay go
 * out at once, in the same transaction as the event, when the person may send notifications.
 */
import { and, asc, eq, inArray, lte, type SQL } from 'drizzle-orm';
import { payments } from '@/core/db/schema/tenant';
import { withScope, type Scope } from '@/core/db/scope';
import { ForbiddenError } from '@/core/errors';
import { sendNotification } from '@/core/notifications/notifications';
import { can } from '@/core/rbac/permissions';
import { createRecord, updateRecord } from '@/core/records/records';
import type { BusinessContext } from '@/core/tenancy/context';
import { automationRuleEntity, queueEntity } from '../entities';
import { CORE, P } from '../permissions';
import { addDays, automationStillWanted, localDate, localTime, NOT_PAST_DUE } from '../rules';
import {
  hhmcAutomationQueue,
  hhmcAutomationRules,
  hhmcEstimates,
  hhmcInvoices,
  hhmcJobs,
  hhmcLeads,
  type AutomationTrigger,
} from '../schema';
import {
  estimateLink,
  invoiceLink,
  loadCustomer,
  money,
  personName,
  renderEmail,
} from './common';
import { balanceDueCents } from './pricing';

export type QueueRefs = {
  leadId?: string | null;
  jobId?: string | null;
  estimateId?: string | null;
  invoiceId?: string | null;
  paymentId?: string | null;
};

/**
 * Puts the emails of every active rule for this trigger in the queue. Rules that respect the
 * job's opt-in are skipped when it is off. Zero-delay emails are sent straight away if the
 * person may send notifications (otherwise they wait for the next run).
 */
export async function enqueue(
  s: Scope,
  trigger: AutomationTrigger,
  refs: QueueRefs & { recipient: string | null; optIn?: boolean; notBefore?: Date },
  now: Date = new Date(),
): Promise<number> {
  if (!refs.recipient) return 0;
  const rules = await s.db
    .select()
    .from(hhmcAutomationRules)
    .where(
      and(
        s.where(hhmcAutomationRules),
        eq(hhmcAutomationRules.trigger, trigger),
        eq(hhmcAutomationRules.isActive, true),
      ),
    )
    .orderBy(asc(hhmcAutomationRules.delayMinutes));
  let queued = 0;
  for (const rule of rules) {
    if (rule.respectsOptIn && refs.optIn === false) continue;
    const row = await createRecord(s, queueEntity, {
      ruleId: rule.id,
      leadId: refs.leadId ?? null,
      jobId: refs.jobId ?? null,
      estimateId: refs.estimateId ?? null,
      invoiceId: refs.invoiceId ?? null,
      paymentId: refs.paymentId ?? null,
      recipient: refs.recipient,
      dueAt: new Date(Math.max(now.getTime() + rule.delayMinutes * 60_000, refs.notBefore?.getTime() ?? 0)),
      status: 'queued',
    });
    queued++;
    if (rule.delayMinutes === 0 && !refs.notBefore && can(s.ctx, CORE.notificationsWrite)) {
      await processRow(s, row, now);
    }
  }
  return queued;
}

/** Cancels queued emails matching `where` (for example: this job's estimate drip). */
export async function cancelQueued(
  s: Scope,
  match: { triggers: AutomationTrigger[]; jobId?: string; estimateId?: string; leadId?: string; invoiceId?: string },
  reason: string,
): Promise<number> {
  const conditions: (SQL | undefined)[] = [
    s.where(hhmcAutomationQueue),
    eq(hhmcAutomationQueue.status, 'queued'),
    inArray(
      hhmcAutomationQueue.ruleId,
      s.db
        .select({ id: hhmcAutomationRules.id })
        .from(hhmcAutomationRules)
        .where(and(s.where(hhmcAutomationRules, 'include'), inArray(hhmcAutomationRules.trigger, match.triggers))),
    ),
    match.jobId ? eq(hhmcAutomationQueue.jobId, match.jobId) : undefined,
    match.estimateId ? eq(hhmcAutomationQueue.estimateId, match.estimateId) : undefined,
    match.leadId ? eq(hhmcAutomationQueue.leadId, match.leadId) : undefined,
    match.invoiceId ? eq(hhmcAutomationQueue.invoiceId, match.invoiceId) : undefined,
  ];
  const rows = await s.db.select({ id: hhmcAutomationQueue.id }).from(hhmcAutomationQueue).where(and(...conditions));
  for (const row of rows) {
    await updateRecord(s, queueEntity, row.id, { status: 'cancelled', cancelledReason: reason });
  }
  return rows.length;
}

type QueueRow = typeof hhmcAutomationQueue.$inferSelect;

async function one<T>(rows: Promise<T[]>): Promise<T | null> {
  return (await rows)[0] ?? null;
}

/** Sends one queued email if it is still wanted; otherwise cancels it with the reason. */
async function processRow(s: Scope, row: QueueRow, now: Date): Promise<'sent' | 'cancelled' | 'failed' | 'deferred'> {
  const rule = await one(
    s.db.select().from(hhmcAutomationRules).where(and(s.where(hhmcAutomationRules, 'include'), eq(hhmcAutomationRules.id, row.ruleId))),
  );
  const job = row.jobId
    ? await one(s.db.select().from(hhmcJobs).where(and(s.where(hhmcJobs, 'include'), eq(hhmcJobs.id, row.jobId))))
    : null;
  const estimate = row.estimateId
    ? await one(s.db.select().from(hhmcEstimates).where(and(s.where(hhmcEstimates, 'include'), eq(hhmcEstimates.id, row.estimateId))))
    : null;
  const lead = row.leadId
    ? await one(s.db.select().from(hhmcLeads).where(and(s.where(hhmcLeads, 'include'), eq(hhmcLeads.id, row.leadId))))
    : null;
  const invoice = row.invoiceId
    ? await one(s.db.select().from(hhmcInvoices).where(and(s.where(hhmcInvoices, 'include'), eq(hhmcInvoices.id, row.invoiceId))))
    : null;

  const verdict = !rule
    ? ({ ok: false, reason: 'The rule no longer exists.' } as const)
    : !rule.isActive || rule.archivedAt
      ? ({ ok: false, reason: 'The rule was switched off.' } as const)
      : automationStillWanted({
          trigger: rule.trigger,
          respectsOptIn: rule.respectsOptIn,
          jobStage: job?.archivedAt ? null : (job?.stage ?? null),
          jobOptIn: job?.automationOptIn ?? null,
          estimateStatus: estimate?.archivedAt ? null : (estimate?.status ?? null),
          leadStatus: lead?.archivedAt ? null : (lead?.status ?? null),
          invoiceStatus: invoice?.archivedAt ? null : (invoice?.status ?? null),
          invoicePastDue: invoice ? invoice.dueDate < localDate(now, s.ctx.business.timeZone) : null,
          estimateExpired: estimate?.expiresAt ? estimate.expiresAt.getTime() <= now.getTime() : false,
        });
  if (!verdict.ok && invoice && rule?.trigger === 'invoice_sent' && verdict.reason === NOT_PAST_DUE) {
    // Not due yet (e.g. its terms changed): wait until the day after the due date instead.
    await updateRecord(s, queueEntity, row.id, { dueAt: localTime(addDays(invoice.dueDate, 1), '09:00', s.ctx.business.timeZone) });
    return 'deferred';
  }
  if (!verdict.ok) {
    await updateRecord(s, queueEntity, row.id, { status: 'cancelled', cancelledReason: verdict.reason });
    return 'cancelled';
  }

  const customer = job ? await loadCustomer(s, job.customerId) : null;
  const values: Record<string, string> = {
    businessName: s.ctx.business.name,
    firstName: customer?.firstName || lead?.firstName || '',
    customerName: customer ? personName(customer) : `${lead?.firstName ?? ''} ${lead?.lastName ?? ''}`.trim(),
    jobNumber: job?.jobNumber ?? '',
    moveDate: job?.moveDate ?? lead?.moveDate ?? '',
    estimateNumber: estimate?.estimateNumber ?? '',
    estimateTotal: estimate ? money(estimate.totalCents) : '',
    invoiceNumber: invoice?.invoiceNumber ?? '',
    invoiceTotal: invoice ? money(invoice.totalCents) : '',
    balanceDue: invoice
      ? money(balanceDueCents(invoice.totalCents, invoice.depositReceivedCents, invoice.paidCents))
      : '',
    link: estimate ? estimateLink(s, estimate) : invoice ? invoiceLink(s, invoice, now) : '',
  };
  if (row.paymentId) {
    const payment = await one(s.db.select().from(payments).where(and(s.where(payments, 'include'), eq(payments.id, row.paymentId))));
    values.amount = payment ? money(payment.amountCents) : '';
    values.paymentDate = payment?.paidAt ? payment.paidAt.toISOString().slice(0, 10) : '';
    values.paymentId = payment?.id.slice(0, 8) ?? '';
  }
  const email = await renderEmail(s, rule!.templateKey, values);
  const notification = await sendNotification(s, {
    recipient: row.recipient,
    subject: email.subject,
    body: email.body,
    subjectType: queueEntity.key,
    subjectId: row.id,
  });
  const status = notification.status === 'sent' ? 'sent' : 'failed';
  await updateRecord(s, queueEntity, row.id, {
    status,
    sentAt: status === 'sent' ? now : null,
    notificationId: notification.id,
  });
  return status;
}

/**
 * Sends every queued email that is due at `now` (oldest first), in this business and mode.
 * Each email is re-checked first: one that is no longer wanted is cancelled with a reason.
 */
export async function processDueAutomationsInScope(
  s: Scope,
  now: Date,
): Promise<{ sent: number; cancelled: number; failed: number; deferred: number }> {
  const due = await s.db
    .select()
    .from(hhmcAutomationQueue)
    .where(and(s.where(hhmcAutomationQueue), eq(hhmcAutomationQueue.status, 'queued'), lte(hhmcAutomationQueue.dueAt, now)))
    .orderBy(asc(hhmcAutomationQueue.dueAt))
    .limit(500);
  const result = { sent: 0, cancelled: 0, failed: 0, deferred: 0 };
  for (const row of due) result[await processRow(s, row, now)]++;
  return result;
}

/**
 * "Run due emails". Tech team and super admin only (the platform roles that build and test);
 * a business's own people never trigger sending by hand. Needs notifications.write as well.
 */
export async function processDueAutomations(ctx: BusinessContext, now: Date = new Date()) {
  const systemActor = ctx.actor.id === null && !ctx.link && ctx.role === 'super_admin';
  if (!systemActor && ctx.role !== 'tech' && ctx.role !== 'super_admin')
    throw new ForbiddenError(P.automationsRun, 'Only the tech team can send due emails by hand.');
  return withScope(ctx, P.automationsRun, async (s) => {
    if (!can(ctx, CORE.notificationsWrite)) throw new ForbiddenError(CORE.notificationsWrite);
    return processDueAutomationsInScope(s, now);
  });
}

/** The queue as staff see it on a job or lead page, newest first. */
export async function queueFor(s: Scope, match: { jobId?: string; leadId?: string }) {
  const rows = await s.db
    .select({ queue: hhmcAutomationQueue, ruleName: hhmcAutomationRules.name })
    .from(hhmcAutomationQueue)
    .innerJoin(hhmcAutomationRules, eq(hhmcAutomationRules.id, hhmcAutomationQueue.ruleId))
    .where(
      and(
        s.where(hhmcAutomationQueue),
        match.jobId ? eq(hhmcAutomationQueue.jobId, match.jobId) : undefined,
        match.leadId ? eq(hhmcAutomationQueue.leadId, match.leadId) : undefined,
      ),
    )
    .orderBy(asc(hhmcAutomationQueue.dueAt));
  return rows.map((r) => ({ ...r.queue, ruleName: r.ruleName }));
}

/** Switches a rule on or off, or changes its delay. */
export async function updateRule(
  ctx: BusinessContext,
  id: string,
  patch: { isActive?: boolean; delayMinutes?: number },
) {
  return withScope(ctx, P.catalogWrite, (s) => updateRecord(s, automationRuleEntity, id, patch));
}
