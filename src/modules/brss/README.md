# Big Red Shipping & Storage (`brss`)

Shipping and storage for the Cornell community; Cornell's preferred vendor.

**Status:** scaffold — registered on the platform, not built yet.

The proof module (Phase 4): a staff portal modelled on what BRSS's Salesforce org does. The analysis of that org is in docs/brss-analysis/.

## Planned scope

- Orders dashboard (filter by status, campus/region, date)
- Order detail (customer, articles and their status and location, payments, appointments)
- Appointment scheduling, including unavailability
- Article intake and status updates through storage and delivery
- Warehouses and trucks
- Pricing and storage term products
- Zip zones

## What already works for this business

Because the module is registered, the console's shared features work today: People and access,
customers, payments, appointments, the Data tab (browse, export, archive, restore), the activity
log and test mode. Only the App tab (the business's own staff portal) is a placeholder.

## Building it

Follow `docs/MODULE_GUIDE.md`. In short: replace `scaffoldModule(...)` in `manifest.ts` with a
full `defineModule({ ... })`, add `schema.ts`, permissions, services, pages and `seed.ts`
(copy from `src/modules/_template/`), then run `npm run db:generate && npm run db:migrate`.
