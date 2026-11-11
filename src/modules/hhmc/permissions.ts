/**
 * HHMC permissions. New staff start with the ones marked defaultForStaff.
 *
 * HHMC also uses the shared core's permissions (not repeated here):
 *   customers.read / customers.write   – the customer on a lead or job
 *   payments.read / payments.write     – deposits, invoice payments, refunds
 *   scheduling.read / scheduling.write – booking job days (appointments), trucks, sold-out dates
 *   notifications.read / .write        – emails, including the automation queue
 *   files.read / files.write           – the stored estimate document
 *
 * The two "customer.*" permissions are held only by customer links (src/core/links): they open
 * the customer pages. A staff member holding one can do nothing with it, because those pages
 * and services also require the link itself.
 */
import type { PermissionDef } from '@/core/modules/contract';

export const P = {
  leadsRead: 'hhmc.leads.read',
  leadsWrite: 'hhmc.leads.write',
  jobsRead: 'hhmc.jobs.read',
  jobsWrite: 'hhmc.jobs.write',
  jobsBook: 'hhmc.jobs.book',
  estimatesWrite: 'hhmc.estimates.write',
  invoicesRead: 'hhmc.invoices.read',
  invoicesWrite: 'hhmc.invoices.write',
  catalogRead: 'hhmc.catalog.read',
  catalogWrite: 'hhmc.catalog.write',
  automationsRun: 'hhmc.automations.run',
  importRun: 'hhmc.import.run',
  customerEstimate: 'hhmc.customer.estimate',
  customerInvoice: 'hhmc.customer.invoice',
} as const;

/** Core permissions HHMC relies on, named once so a typo cannot slip in. */
export const CORE = {
  customersRead: 'customers.read',
  customersWrite: 'customers.write',
  paymentsRead: 'payments.read',
  paymentsWrite: 'payments.write',
  schedulingRead: 'scheduling.read',
  schedulingWrite: 'scheduling.write',
  notificationsRead: 'notifications.read',
  notificationsWrite: 'notifications.write',
  filesRead: 'files.read',
  filesWrite: 'files.write',
} as const;

// prettier-ignore
export const permissions: PermissionDef[] = [
  { key: P.leadsRead, label: 'See leads', kind: 'read', defaultForStaff: true },
  { key: P.leadsWrite, label: 'Add and change leads, disqualify and convert them', kind: 'write', defaultForStaff: true },
  { key: P.jobsRead, label: 'See jobs, quotes, estimates and job days', kind: 'read', defaultForStaff: true },
  { key: P.jobsWrite, label: 'Change jobs: details, quote, job days, notes, calls, stage', kind: 'write', defaultForStaff: true },
  { key: P.jobsBook, label: 'Book a job and release a booking', kind: 'write', defaultForStaff: false },
  { key: P.estimatesWrite, label: 'Send, resend and void estimates', kind: 'write', defaultForStaff: true },
  { key: P.invoicesRead, label: 'See invoices', kind: 'read', defaultForStaff: true },
  { key: P.invoicesWrite, label: 'Create, send and void invoices', kind: 'write', defaultForStaff: false },
  { key: P.catalogRead, label: 'See the price catalog, discounts, templates and automation rules', kind: 'read', defaultForStaff: true },
  { key: P.catalogWrite, label: 'Change the price catalog, discounts, templates and automation rules', kind: 'write', defaultForStaff: false },
  { key: P.automationsRun, label: 'Send due automation emails now (tech team only; no scheduler yet)', kind: 'write', defaultForStaff: false },
  { key: P.importRun, label: 'Import records from Movegistics (tech team; command line only)', kind: 'write', defaultForStaff: false },
  { key: P.customerEstimate, label: 'Customer link only: review, sign and pay the deposit on one estimate', kind: 'write', defaultForStaff: false },
  { key: P.customerInvoice, label: 'Customer link only: pay one invoice', kind: 'write', defaultForStaff: false },
];
