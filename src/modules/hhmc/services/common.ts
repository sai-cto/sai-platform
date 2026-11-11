/** Lookups shared by the HHMC services. All take a Scope: they run inside the caller's transaction. */
import { and, asc, eq } from 'drizzle-orm';
import { customers } from '@/core/db/schema/tenant';
import type { Scope } from '@/core/db/scope';
import { NotFoundError } from '@/core/errors';
import { isUuid } from '@/core/ids';
import { siteUrl } from '@/core/demo/pilot';
import { signLink } from '@/core/links/links';
import { customerName } from '@/core/records/core-entities';
import { formatMoney } from '@/ui/format';
import { renderTemplate } from '../rules';
import {
  hhmcEstimates,
  hhmcInvoices,
  hhmcJobs,
  hhmcLeads,
  hhmcQuotes,
  hhmcTemplates,
} from '../schema';

export async function loadJob(s: Scope, id: string) {
  if (!isUuid(id)) throw new NotFoundError();
  const [row] = await s.db
    .select()
    .from(hhmcJobs)
    .where(and(s.where(hhmcJobs), eq(hhmcJobs.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError();
  return row;
}

export async function loadLead(s: Scope, id: string) {
  if (!isUuid(id)) throw new NotFoundError();
  const [row] = await s.db
    .select()
    .from(hhmcLeads)
    .where(and(s.where(hhmcLeads), eq(hhmcLeads.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError();
  return row;
}

export async function loadEstimate(s: Scope, id: string) {
  if (!isUuid(id)) throw new NotFoundError();
  const [row] = await s.db
    .select()
    .from(hhmcEstimates)
    .where(and(s.where(hhmcEstimates), eq(hhmcEstimates.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError();
  return row;
}

export async function loadInvoice(s: Scope, id: string) {
  if (!isUuid(id)) throw new NotFoundError();
  const [row] = await s.db
    .select()
    .from(hhmcInvoices)
    .where(and(s.where(hhmcInvoices), eq(hhmcInvoices.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError();
  return row;
}

export async function loadQuoteFor(s: Scope, jobId: string) {
  const [row] = await s.db
    .select()
    .from(hhmcQuotes)
    .where(and(s.where(hhmcQuotes), eq(hhmcQuotes.jobId, jobId)))
    .limit(1);
  return row ?? null;
}

/** The customer of a job (archived customers still count: the job still belongs to them). */
export async function loadCustomer(s: Scope, id: string) {
  const [row] = await s.db
    .select()
    .from(customers)
    .where(and(s.where(customers, 'include'), eq(customers.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError();
  return row;
}

/** Live estimates of a job, newest first. */
export async function estimatesOf(s: Scope, jobId: string) {
  return s.db
    .select()
    .from(hhmcEstimates)
    .where(and(s.where(hhmcEstimates), eq(hhmcEstimates.jobId, jobId)))
    .orderBy(asc(hhmcEstimates.version));
}

export async function loadTemplate(s: Scope, key: string) {
  const [row] = await s.db
    .select()
    .from(hhmcTemplates)
    .where(and(s.where(hhmcTemplates), eq(hhmcTemplates.key, key)))
    .limit(1);
  return row ?? null;
}

/** A template filled in. A missing template gives a plain fallback so an email is never blank. */
export async function renderEmail(
  s: Scope,
  key: string,
  values: Record<string, string>,
): Promise<{ subject: string; body: string }> {
  const template = await loadTemplate(s, key);
  if (!template)
    return {
      subject: `${s.ctx.business.name}`,
      body: `Hello ${values.firstName ?? ''},\n\n${values.link ?? ''}\n\n${s.ctx.business.name}`,
    };
  return {
    subject: renderTemplate(template.subject, values),
    body: renderTemplate(template.body, values),
  };
}

export function personName(c: { kind: string; firstName: string; lastName: string; organizationName: string | null; email: string | null }) {
  return customerName(c as Record<string, unknown>);
}

/** Where the app is reached from outside (links in emails). */
export function appUrl(): string {
  // On Vercel the site's own address is known without configuration.
  return siteUrl();
}

export const PURPOSE = { estimate: 'hhmc.estimate', invoice: 'hhmc.invoice' } as const;

/** The customer's link to review and sign an estimate. Valid until the estimate expires. */
export function estimateLink(s: Scope, estimate: { id: string; expiresAt: Date | null; signedAt?: Date | null }): string {
  // A signed estimate's link stays usable for 90 days after signing (to pay the deposit).
  const base = estimate.expiresAt ?? new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const afterSigning = estimate.signedAt ? estimate.signedAt.getTime() + 90 * 24 * 3600 * 1000 : 0;
  const expiresAt = new Date(Math.max(base.getTime(), afterSigning));
  return `${appUrl()}/l/${signLink(s.ctx, { purpose: PURPOSE.estimate, subjectId: estimate.id, expiresAt })}`;
}

/** The customer's link to pay an invoice. Valid for 90 days. */
export function invoiceLink(s: Scope, invoice: { id: string }, now: Date = new Date()): string {
  const expiresAt = new Date(now.getTime() + 90 * 24 * 3600 * 1000);
  return `${appUrl()}/l/${signLink(s.ctx, { purpose: PURPOSE.invoice, subjectId: invoice.id, expiresAt })}`;
}

export const money = (cents: number) => formatMoney(cents);
