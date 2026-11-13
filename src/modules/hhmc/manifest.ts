/**
 * Hired Hands Moving Company: one record per move (Lead → Job → Quote → Estimate → Booking →
 * Invoice → Payment). README.md in this folder lists every rule with its source in
 * docs/hhmc-analysis/movegistics-reference.md.
 */
import { defineModule } from '@/core/modules/contract';
import { formatMoney, formatNumber } from '@/ui/format';
import { entities, jobEntity } from './entities';
import { ContactPage, ContactsPage } from './pages/contacts';
import { CustomerPage } from './pages/customer-page';
import { EstimatesPage } from './pages/estimates';
import { DashboardPage } from './pages/dashboard-page';
import { InvoicePage, InvoicesPage } from './pages/invoices';
import { JobPage } from './pages/job-page';
import { JobsPage, NewJobPage } from './pages/jobs';
import { LeadPage, LeadsPage, NewLeadPage } from './pages/leads';
import { SchedulePage } from './pages/schedule-page';
import { SettingsPage } from './pages/settings-page';
import { EstimatePrintPage, InvoicePrintPage } from './pages/print-pages';
import { CORE, P, permissions } from './permissions';
import { seedDemoData } from './seed';
import { processDueAutomationsInScope } from './services/automations';
import { estimateFunnel, invoiceTotals, leadsThisMonth, upcomingMoves } from './services/dashboard';
import { searchHhmc } from './services/search';
import { settingsDefaults, settingsFields, settingsSchema } from './settings';

export const hhmcModule = defineModule({
  key: 'hhmc',
  name: 'Hired Hands Moving Company',
  version: '1.0.0',
  status: 'in_development',
  description: 'Student moving company.',
  plannedScope: [
    'Leads with a fixed source list, disqualify and convert (reusing existing customers)',
    'One Job per move: quote, versioned estimates, booking, job days, invoices, payments, notes and calls',
    'Customer pages from an emailed link: review, e-sign, pay the deposit; pay the invoice',
    'One schedule (day, week, month) with crew and truck capacity and sold-out dates',
    'Automations as data: estimate drip, lead no-contact, receipts, booked, review request, past due',
    'Dashboard: leads and conversion, estimates, booked revenue, invoices, time to first estimate',
  ],

  permissions,
  entities,

  portals: {
    staff: {
      // The managers' own words and only what they use (Hired Hands Software Input, Nov 2026):
      // Leads, Estimates, Work Requests, Contacts, a calendar, invoices. "Work Requests" are
      // the jobs (one record per move); "Contacts" are the business's customers.
      nav: [
        { label: 'Dashboard', path: '' },
        { label: 'Leads', path: 'leads' },
        { label: 'Estimates', path: 'estimates' },
        { label: 'Work Requests', path: 'jobs' },
        { label: 'Contacts', path: 'contacts' },
        { label: 'Calendar', path: 'schedule' },
        { label: 'Invoices', path: 'invoices' },
        { label: 'Settings', path: 'settings' },
      ],
      // prettier-ignore
      routes: [
        { path: '', title: 'Dashboard', permission: P.jobsRead, component: DashboardPage },
        { path: 'leads', title: 'Leads', permission: P.leadsRead, component: LeadsPage },
        { path: 'leads/new', title: 'Add lead', permission: P.leadsWrite, component: NewLeadPage },
        { path: 'leads/:id', title: 'Lead', permission: P.leadsRead, component: LeadPage },
        { path: 'estimates', title: 'Estimates', permission: P.jobsRead, component: EstimatesPage },
        { path: 'jobs', title: 'Work requests', permission: P.jobsRead, component: JobsPage },
        { path: 'jobs/new', title: 'New work request', permission: P.jobsWrite, component: NewJobPage },
        { path: 'jobs/:id', title: 'Work request', permission: P.jobsRead, component: JobPage },
        { path: 'contacts', title: 'Contacts', permission: CORE.customersRead, component: ContactsPage },
        { path: 'contacts/:id', title: 'Contact', permission: CORE.customersRead, component: ContactPage },
        { path: 'schedule', title: 'Calendar', permission: CORE.schedulingRead, component: SchedulePage },
        { path: 'invoices', title: 'Invoices', permission: P.invoicesRead, component: InvoicesPage },
        { path: 'invoices/:id', title: 'Invoice', permission: P.invoicesRead, component: InvoicePage },
        { path: 'invoices/:id/print', title: 'Print invoice', permission: P.invoicesRead, component: InvoicePrintPage },
        { path: 'estimates/:id/print', title: 'Print estimate', permission: P.jobsRead, component: EstimatePrintPage },
        { path: 'settings', title: 'Settings', permission: P.catalogRead, component: SettingsPage },
      ],
    },
    // Opened only through a customer link (/l/<token>); see linkPurposes below.
    customer: {
      nav: [],
      routes: [{ path: '', title: 'Your move', permission: CORE.customersRead, component: CustomerPage }],
    },
  },

  // Customer links (src/core/links): exactly what each kind of link may do. The services also
  // check that the link is for the one record being touched.
  linkPurposes: [
    {
      key: 'hhmc.estimate',
      permissions: [P.customerEstimate, P.jobsRead, P.jobsWrite, P.estimatesWrite, P.catalogRead, CORE.customersRead, CORE.paymentsRead, CORE.paymentsWrite, CORE.notificationsWrite, CORE.filesRead, CORE.filesWrite],
    },
    {
      key: 'hhmc.invoice',
      permissions: [P.customerInvoice, P.invoicesRead, P.invoicesWrite, P.jobsRead, P.jobsWrite, P.catalogRead, CORE.customersRead, CORE.paymentsRead, CORE.paymentsWrite, CORE.notificationsWrite],
    },
  ],

  widgets: [
    {
      key: 'leads-month',
      label: 'Leads this month',
      permission: P.leadsRead,
      load: async (s) => {
        const l = await leadsThisMonth(s);
        return { value: formatNumber(l.leads), hint: `${l.conversionPercent}% of enquiries became work requests` };
      },
    },
    {
      key: 'estimates-month',
      label: 'Estimates sent this month',
      permission: P.jobsRead,
      load: async (s) => {
        const f = await estimateFunnel(s);
        return { value: formatNumber(f.sent), hint: `${f.viewed} viewed · ${f.signed} signed` };
      },
    },
    {
      key: 'moves-week',
      label: 'Booked moves · next 7 days',
      permission: P.jobsRead,
      load: async (s) => ({ value: formatNumber(await upcomingMoves(s, new Date(), 7)) }),
    },
    {
      key: 'invoices-open',
      label: 'Open invoices',
      permission: P.invoicesRead,
      load: async (s) => {
        const t = await invoiceTotals(s);
        return { value: formatMoney(t.openCents), hint: `${formatMoney(t.pastDueCents)} past due` };
      },
    },
  ],

  search: searchHhmc,

  // The dashboard's "Booked moves" definition, from today on (one per move, not per truck).
  upcoming: { label: 'Booked moves · from today', permission: P.jobsRead, load: (s) => upcomingMoves(s) },

  workItem: { label: 'Jobs', entityKey: jobEntity.key },

  // Sends due automatic emails on the hosting's schedule, only where a manager switched
  // "Send due automatic emails on a schedule" on (off by default, P5-15).
  scheduledTasks: [
    {
      key: 'hhmc.due-emails',
      settingKey: 'autoSendDueEmails',
      run: async (s, now) => {
        const r = await processDueAutomationsInScope(s, now);
        return `sent ${r.sent}, cancelled ${r.cancelled}, deferred ${r.deferred}, failed ${r.failed}`;
      },
    },
  ],

  settings: { schema: settingsSchema, defaults: settingsDefaults, fields: settingsFields },

  seedDemoData,
});
