/**
 * Hired Hands Moving Company: one record per move (Lead → Job → Quote → Estimate → Booking →
 * Invoice → Payment). README.md in this folder lists every rule with its source in
 * docs/hhmc-analysis/movegistics-reference.md.
 */
import { defineModule } from '@/core/modules/contract';
import { formatMoney, formatNumber } from '@/ui/format';
import { entities, jobEntity } from './entities';
import { CustomerPage } from './pages/customer-page';
import { DashboardPage } from './pages/dashboard-page';
import { InvoicePage, InvoicesPage } from './pages/invoices';
import { JobPage } from './pages/job-page';
import { JobsPage, NewJobPage } from './pages/jobs';
import { LeadPage, LeadsPage, NewLeadPage } from './pages/leads';
import { SchedulePage } from './pages/schedule-page';
import { SettingsPage } from './pages/settings-page';
import { CORE, P, permissions } from './permissions';
import { seedDemoData } from './seed';
import { estimateFunnel, invoiceTotals, leadsThisMonth, upcomingMoves } from './services/dashboard';
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
      // Customers and payments are the console's shared Data tabs; the pages link to them.
      nav: [
        { label: 'Dashboard', path: '' },
        { label: 'Leads', path: 'leads' },
        { label: 'Jobs', path: 'jobs' },
        { label: 'Schedule', path: 'schedule' },
        { label: 'Invoices', path: 'invoices' },
        { label: 'Settings', path: 'settings' },
      ],
      // prettier-ignore
      routes: [
        { path: '', title: 'Dashboard', permission: P.jobsRead, component: DashboardPage },
        { path: 'leads', title: 'Leads', permission: P.leadsRead, component: LeadsPage },
        { path: 'leads/new', title: 'Add lead', permission: P.leadsWrite, component: NewLeadPage },
        { path: 'leads/:id', title: 'Lead', permission: P.leadsRead, component: LeadPage },
        { path: 'jobs', title: 'Jobs', permission: P.jobsRead, component: JobsPage },
        { path: 'jobs/new', title: 'New job', permission: P.jobsWrite, component: NewJobPage },
        { path: 'jobs/:id', title: 'Job', permission: P.jobsRead, component: JobPage },
        { path: 'schedule', title: 'Schedule', permission: CORE.schedulingRead, component: SchedulePage },
        { path: 'invoices', title: 'Invoices', permission: P.invoicesRead, component: InvoicesPage },
        { path: 'invoices/:id', title: 'Invoice', permission: P.invoicesRead, component: InvoicePage },
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
        return { value: formatNumber(l.leads), hint: `${l.conversionPercent}% converted to jobs` };
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
      load: async (s) => ({ value: formatNumber(await upcomingMoves(s)) }),
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

  workItem: { label: 'Jobs', entityKey: jobEntity.key },

  settings: { schema: settingsSchema, defaults: settingsDefaults, fields: settingsFields },

  seedDemoData,
});
