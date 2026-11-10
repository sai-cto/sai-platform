/**
 * Big Red Shipping & Storage: the staff portal. README.md in this folder explains what was
 * modelled on the old Salesforce system, which of its rules were ported (with sources), and
 * what is still an open question.
 */
import { defineModule } from '@/core/modules/contract';
import { createdCount, lastDays } from '@/core/analytics/analytics';
import { formatMoney, formatNumber } from '@/ui/format';
import { entities, orderEntity } from './entities';
import { ArticleEditPage } from './pages/article-edit-page';
import { ArticlePage } from './pages/article-page';
import { ArticlesPage } from './pages/articles-page';
import { NewOrderPage } from './pages/new-order-page';
import { OperationsPage } from './pages/operations-page';
import { OrderPage } from './pages/order-page';
import { OrdersPage } from './pages/orders-page';
import { PricingPage } from './pages/pricing-page';
import { SchedulePage } from './pages/schedule-page';
import { ZonesPage } from './pages/zones-page';
import { CORE, P, permissions } from './permissions';
import { seedDemoData } from './seed';
import { settingsDefaults, settingsFields, settingsSchema } from './settings';
import { openWorkSummary } from './services/summary';

export const brssModule = defineModule({
  key: 'brss',
  name: 'Big Red Shipping & Storage',
  version: '1.0.0',
  status: 'in_development',
  description: "Shipping and storage for the Cornell community; Cornell's preferred vendor.",
  plannedScope: [
    'Orders dashboard (filter by status, campus/region, date)',
    'Order detail (customer, articles and their status and location, payments, appointments)',
    'Appointment scheduling, including unavailability',
    'Article intake and status updates through storage and delivery',
    'Warehouses and trucks',
    'Pricing and storage term products',
    'Zip zones',
  ],

  permissions,
  entities,

  portals: {
    staff: {
      nav: [
        { label: 'Orders', path: '' },
        { label: 'Articles', path: 'articles' },
        { label: 'Schedule', path: 'schedule' },
        { label: 'Operations', path: 'operations' },
        { label: 'Pricing', path: 'pricing' },
        { label: 'Zip zones', path: 'zones' },
      ],
      // prettier-ignore
      routes: [
        { path: '', title: 'Orders', permission: P.ordersRead, component: OrdersPage },
        { path: 'orders/new', title: 'New order', permission: P.ordersWrite, component: NewOrderPage },
        { path: 'orders/:id', title: 'Order', permission: P.ordersRead, component: OrderPage },
        { path: 'orders/:id/articles/:articleId', title: 'Correct an article', permission: P.ordersWrite, component: ArticleEditPage },
        { path: 'articles', title: 'Articles', permission: P.articlesRead, component: ArticlesPage },
        { path: 'articles/:id', title: 'Article', permission: P.articlesRead, component: ArticlePage },
        { path: 'schedule', title: 'Schedule', permission: CORE.schedulingRead, component: SchedulePage },
        { path: 'operations', title: 'Operations', permission: P.catalogRead, component: OperationsPage },
        { path: 'pricing', title: 'Pricing', permission: P.catalogRead, component: PricingPage },
        { path: 'zones', title: 'Zip zones', permission: P.catalogRead, component: ZonesPage },
      ],
    },
  },

  // Key numbers on the business's Overview tab.
  widgets: [
    {
      key: 'orders-30d',
      label: 'Orders placed · last 30 days',
      permission: P.ordersRead,
      load: async (s) => ({
        value: formatNumber(await createdCount(s, orderEntity, lastDays(30))),
      }),
    },
    {
      key: 'orders-open',
      label: 'Orders in progress',
      permission: P.ordersRead,
      load: async (s) => {
        const summary = await openWorkSummary(s);
        return {
          value: formatNumber(summary.activeOrders),
          hint: `${formatMoney(summary.unpaidCents)} waiting to be paid`,
        };
      },
    },
    {
      key: 'articles-held',
      label: 'Articles in our hands',
      permission: P.articlesRead,
      load: async (s) => {
        const summary = await openWorkSummary(s);
        return {
          value: formatNumber(summary.articlesHeld),
          hint: `${formatNumber(summary.articlesWithoutLocation)} without a warehouse location`,
        };
      },
    },
    {
      key: 'appointments-week',
      label: 'Appointments · next 7 days',
      permission: CORE.schedulingRead,
      load: async (s) => {
        const summary = await openWorkSummary(s);
        return {
          value: formatNumber(summary.appointmentsNext7Days),
          hint: `${formatNumber(summary.unconfirmedNext7Days)} not confirmed yet`,
        };
      },
    },
  ],

  // Counted on the executive dashboard.
  workItem: { label: 'Orders', entityKey: orderEntity.key },

  settings: { schema: settingsSchema, defaults: settingsDefaults, fields: settingsFields },

  seedDemoData,
});
