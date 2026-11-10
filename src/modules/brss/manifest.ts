import { scaffoldModule } from '../_shared/scaffold';

/** Big Red Shipping & Storage: registered, not built yet. See README.md in this folder. */
export const brssModule = scaffoldModule({
  key: 'brss',
  name: 'Big Red Shipping & Storage',
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
});
