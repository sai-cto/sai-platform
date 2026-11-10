# Cornell Freshman Register (`cfr`)

First-year guide produced by The Cornellian.

**Status:** scaffold — registered on the platform, not built yet.

Placeholder. Scope has not been planned.

## Planned scope

_Not planned yet._

## What already works for this business

Because the module is registered, the console's shared features work today: People and access,
customers, payments, appointments, the Data tab (browse, export, archive, restore), the activity
log and test mode. Only the App tab (the business's own staff portal) is a placeholder.

## Building it

Follow `docs/MODULE_GUIDE.md`. In short: replace `scaffoldModule(...)` in `manifest.ts` with a
full `defineModule({ ... })`, add `schema.ts`, permissions, services, pages and `seed.ts`
(copy from `src/modules/_template/`), then run `npm run db:generate && npm run db:migrate`.
