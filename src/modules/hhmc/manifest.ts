/**
 * Hired Hands Moving Company: one record per move (Lead → Job → Quote → Estimate → Booking →
 * Invoice → Payment). README.md in this folder lists every rule with its source in
 * docs/hhmc-analysis/movegistics-reference.md.
 */
import { defineModule } from '@/core/modules/contract';
import { formatMoney, formatNumber } from '@/ui/format';
import { entities, jobEntity } from './entities';
import { StubPage } from './pages/stub';
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
      nav: [{ label: 'Dashboard', path: '' }],
      routes: [{ path: '', title: 'Dashboard', permission: P.jobsRead, component: StubPage }],
    },
    customer: {
      nav: [],
      routes: [{ path: '', title: 'Your move', permission: 'customers.read', component: StubPage }],
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
