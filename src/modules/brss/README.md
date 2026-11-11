# Big Red Shipping & Storage (`brss`)

Shipping and storage for the Cornell community; Cornell's preferred vendor.

**Status:** staff portal built (the proof module). No customer portal and no field (crew)
portal yet. All data in it is fake until a real import is done.

This module replaces what BRSS staff do in Salesforce today. It was modelled on what the
Salesforce org _actually does_ (its data, its Apex code and its automations), not on how it
looks. The analysis of that org is in `docs/brss-analysis/`.

| Read this                                | For                                                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| this file                                | what the portal does, who can do what, what was deliberately changed, what waits for a decision |
| [`RULES.md`](RULES.md)                   | every ported business rule, with its Salesforce source file and line (84 rules)                 |
| [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) | everything the old code leaves unclear (83 questions for a BRSS manager)                        |
| `docs/brss-analysis/known-issues.md`     | defects of the old system that were not copied                                                  |

## See it

`npm run dev`, sign in as **Blake BRSS-Admin** (`brss.admin@sai.example`), open
**Big Red Shipping & Storage → App**. Use **Test mode** to try things on throw-away data.

## What the staff portal does

| Section        | What you do there                                                                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Orders**     | The dashboard: every order, filtered by status, service, campus category, region, date placed, or a search. Create an order.                                                                                                                               |
| **Order page** | Everything about one order: customer and details; its articles with status and warehouse location; take in an article; charges and payments (take a payment, refund); appointments (book, confirm, move, assign a truck). Activate, close, cancel, reopen. |
| **Articles**   | Find any box or item by number, description, customer, status or warehouse. Open one to set its status or its warehouse location.                                                                                                                          |
| **Schedule**   | Upcoming appointments day by day; confirm them, put them on a truck, move them. Block times when BRSS is unavailable (all day or some time windows, everywhere or only some buildings).                                                                    |
| **Operations** | Warehouses (and how many articles are in each), trucks and their crews, regions and buildings (with each building's campus category).                                                                                                                      |
| **Pricing**    | The price list and which storage product applies to which storage term.                                                                                                                                                                                    |
| **Zip zones**  | Which shipping zone a zip code is in, the price per zone and weight, and a price lookup.                                                                                                                                                                   |

The business's **Overview** tab shows BRSS's key numbers, and the executive dashboard counts
BRSS orders. Tax, the staff discount limit, the appointment lead time, the dimensional-weight
divisor and the weight limits are in the business's **Settings** tab (`settings.ts`).

### A typical order, start to finish

1. **New order**: customer, services, storage term → status _Open_.
2. **Book a pickup** on the order page (date, time window, building). The first appointment
   gives the order its campus category.
3. At pickup, **take in each article** (size and weight for a box). Its storage, shipping and
   insurance charges are worked out and added to the order.
4. **Take payment** (card, cash or check; discount and tip). The first payment starts the
   storage clock.
5. In the warehouse, **give each article a location**: that marks it _Stored_.
6. Later, **book a delivery**, move the articles through _Ready for delivery_ → _On truck_.
7. **Close** the order: its articles become _Delivered_.

## Who can do what

BRSS adds eight permissions of its own and uses six of the shared ones. Business admins, the
tech team and the CTO hold all of them; executives hold the "see" ones only; staff hold what
their business admin switches on in **People and access** (new staff start with the ones
marked ✔). The full matrix is `docs/PERMISSIONS.md`.

| Permission                                      | Lets a person                                                                              | New staff |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ | --------- |
| `brss.orders.read`                              | see orders                                                                                 | ✔         |
| `brss.orders.write`                             | process orders: create and change them, take in articles, add charges, change order status |           |
| `brss.orders.discount_any`                      | give a discount above the staff limit (up to 100%)                                         |           |
| `brss.articles.read`                            | see articles                                                                               | ✔         |
| `brss.articles.write`                           | change an article's details, status and warehouse location                                 | ✔         |
| `brss.appointments.override`                    | book at a blocked time or at short notice (a reason is required and kept)                  |           |
| `brss.catalog.read`                             | see prices, storage terms, zones, buildings, warehouses                                    | ✔         |
| `brss.catalog.write`                            | change them                                                                                |           |
| `customers.read` / `customers.write` (shared)   | see the customer on an order / create a customer with a new order                          | read ✔    |
| `payments.read` / `payments.write` (shared)     | see payments / take payments and refund                                                    |           |
| `scheduling.read` / `scheduling.write` (shared) | see the schedule / book and change appointments, trucks, unavailability                    | read ✔    |
| `notifications.write` (shared)                  | needed to confirm an appointment, because that emails the customer                         |           |

Some actions need two: taking in an article (`brss.orders.write` + `brss.articles.write`),
taking a payment (`brss.orders.write` + `payments.write`), booking an appointment
(`scheduling.write` + `brss.orders.write`, because it stamps the order's campus category).

## How it is built

```
manifest.ts      the contract with the platform: pages, permissions, widgets, settings, seed
schema.ts        the 14 tables (all tenant tables; see "Data model" below)
permissions.ts   the permission keys
settings.ts      numbers a manager may change (tax, discount limit, lead time, weights)
rules.ts         EVERY business rule, as plain functions with no database: read this first
entities.ts      one entry per table, so the Data tab, test mode and automatic tests cover it
services/        what the screens call: orders, articles, charges, appointments, catalog
actions.ts       the server actions behind the forms and buttons
pages/           the screens (server components); pages/forms/ holds the three interactive forms
seed.ts          fake data for test mode and the demo database
```

**Where a rule lives.** A calculation or decision goes in `rules.ts` with its rule id in a
comment and a test in `tests/integration/brss.test.ts`. A service loads the rows, calls the
rule, and saves through the core's record functions (which write the activity log).

### Data model, and what each table replaces

| Table                                                | Replaces in Salesforce                                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `brss_orders`                                        | `Order` (custom fields)                                                                                                                   |
| `brss_order_items`                                   | `OrderItem`                                                                                                                               |
| `brss_articles`                                      | `Article__c`                                                                                                                              |
| `brss_order_articles`                                | `OrderArticle__c`                                                                                                                         |
| `brss_appointments` (+ core `appointments`)          | `Appointment__c`                                                                                                                          |
| `brss_block_buildings` (+ core `unavailability`)     | `ApptNonavailability__c`                                                                                                                  |
| `brss_truck_crew` (+ core `resources`, kind "truck") | `Truck__c` and its five field reps                                                                                                        |
| `brss_products`                                      | `Product2` + `PricebookEntry` + the product ids in `BRSS_HierarchySettings__c`                                                            |
| `brss_storage_term_products`                         | `BRSS_StorageTermProduct__c`                                                                                                              |
| `brss_zip_zones`, `brss_zone_rates`                  | `ZipZone__c`, `ZoneWeight__c`                                                                                                             |
| `brss_regions`, `brss_buildings`                     | the Region and Building picklists on `Appointment__c`                                                                                     |
| `brss_warehouses`                                    | the warehouse picklists. (The Salesforce object called `Warehouse__c` is something else: one row per order line. It is not carried over.) |
| core `customers`, `payments`, `refunds`              | community `User` / `Account`, `Payment__c`                                                                                                |

## Deliberately different from the old system

The first three were confirmed by the CTO ("do not copy"); details and sources are in
`docs/brss-analysis/known-issues.md` (KI-1 to KI-8).

|      | Old system                                                           | Here                                                                                                                                                |
| ---- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| KI-1 | "Storage Delivery By" came out a year late for some months           | plain calendar-month addition (`addMonths`)                                                                                                         |
| KI-2 | billable weight ÷166 on the phone, ÷139 for the price                | one function, one divisor (139, a setting)                                                                                                          |
| KI-3 | lines saved as Paid, then the card charged in a second step          | the card is charged first; lines are marked paid in the same transaction; a declined card leaves a failed payment on record and nothing marked paid |
| KI-4 | card numbers and the Stripe key passed through the app               | card details never reach the server; no key is stored. (No card company is connected yet: see "Before going live".)                                 |
| KI-5 | a missing price silently produced no charge                          | the order page lists what could not be priced, and payment is refused until it is fixed or explicitly accepted                                      |
| KI-6 | lead time and unavailability checked only in the customer's browser  | checked on the server every time; an override needs a permission and a reason                                                                       |
| KI-7 | campus category hard-coded so only North Campus was On-Campus        | each building carries its own category as data (seeded the same way)                                                                                |
| KI-8 | reminder emails depended on someone saving a record on the right day | only the confirmation email is sent; reminders need a scheduler (not built)                                                                         |

Smaller differences, chosen as the safer option and listed for review:

| Old system                                                                                                              | Here                                                                                                | Why                                                                |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| A discount above the cap was silently reduced to the cap (R-ORD-116)                                                    | It is refused with a message; nothing is charged                                                    | Money should never change without the person knowing               |
| Articles were saved first and linked to the order later; abandoned ones belonged to no order (Q-ORD-23)                 | Intake creates the article, the link and the charges together                                       | No orphans                                                         |
| Overlapping zip ranges gave an arbitrary zone (R-SCH-148)                                                               | Ranges cannot overlap                                                                               | One zip, one answer                                                |
| Building was "required" even for a region with no buildings (Q-SCH-13); room was always required by accident (Q-SCH-12) | A region with buildings needs a building; a region without needs a street address; room is optional | Data-driven, no region names in code                               |
| Cancelling an order set every appointment to Cancelled, even completed ones (R-ORD-019)                                 | Completed appointments are left as they were                                                        | Keeps the record of what happened                                  |
| Ship-to-Cornell with no zone or rate created a $0 shipping line (R-SCH-156)                                             | Reported as "could not be priced"                                                                   | Same reason as KI-5                                                |
| Extra automatic lines could be removed during processing (R-SCH-051)                                                    | Only hand-added charges can be removed; a discount waives an automatic one                          | A removed automatic line would come back at the next recalculation |

## Not ported

| What                                                                                                                                                                                         | Why                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The customer website: ordering wizard, extend storage, deliver or ship stored items, customer reschedule and cancel (R-ORD-092 to R-ORD-104, R-SCH-031 to R-SCH-035, R-SCH-159 to R-SCH-183) | Phase 4 is the staff portal only. Staff can do the equivalent by hand: book a delivery, add "ship to home" to an order, add a charge.                      |
| The $1 card authorization at booking (R-ORD-109)                                                                                                                                             | Belongs to the customer website; its purpose is unclear (Q-ORD-04).                                                                                        |
| Stripe calls and saved cards (R-ORD-120 to R-ORD-127)                                                                                                                                        | Replaced by the core payment service (mock provider; Stripe adapter needs keys).                                                                           |
| Storage start date from a completed pickup (R-ORD-088)                                                                                                                                       | Decision B5: the first payment is the rule.                                                                                                                |
| Storage-extension pricing (R-ORD-093)                                                                                                                                                        | Customer flow; its pricing is itself an open question (Q-ORD-29). After storage is paid, changing the term does not create charges: staff add one by hand. |
| The "Supplies Delivery" line added automatically (R-ORD-046)                                                                                                                                 | It is keyed on a product's exact name; staff add the delivery charge by hand.                                                                              |
| Pre-arrival handling (R-ORD-013, R-SCH-184 to R-SCH-193)                                                                                                                                     | Mostly outside the old system (a separate website and a spreadsheet). The product exists on the price list only.                                           |
| The hard-coded Ithaca College pickup dates (R-SCH-028)                                                                                                                                       | A one-off in page code (Q-SCH-18). Use unavailability instead.                                                                                             |
| Location on the order line and its mirror record (R-ORD-050, R-ORD-051)                                                                                                                      | Decision B2: location lives on the article.                                                                                                                |
| Record-ownership rules (R-ORD-007, R-ORD-059, R-ORD-131), record types (R-ORD-002)                                                                                                           | Salesforce mechanics with no meaning here.                                                                                                                 |
| Reminder and alert emails other than the confirmation (R-SCH-037, R-SCH-038 and the Order workflow alerts)                                                                                   | KI-8; needs a scheduler.                                                                                                                                   |
| The careers page (R-SCH-206 to R-SCH-210)                                                                                                                                                    | Not operations.                                                                                                                                            |

## Decisions waiting for the CTO

The CTO asked for the most conservative reasonable answer to each of these, flagged for review
(also in `docs/DECISIONS.md`). **Each is a guess about how BRSS works and should be confirmed
with a BRSS manager before real use.**

| #   | Question                                                                                                 | What was built                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | No custom staff screen exists in Salesforce to model.                                                    | A new design from the data model, the rules and the list views staff use today.                                                                                                             |
| B2  | Location is stored three ways in the old system. Which is real?                                          | On the article: warehouse, section, row, pallet. Warehouses seeded: Mecklenburg, Lansing, Overflow, SAI Basement.                                                                           |
| B3  | Should the article status order be enforced?                                                             | No. The screen suggests the next status; any change is allowed and logged, as today.                                                                                                        |
| B4  | Who sets Activated, Closed, Confirmed, Truck en route, Completed, and when?                              | All are buttons for staff. Closing an order marks its articles Delivered (kept from the old system).                                                                                        |
| B5  | What starts the storage clock: the first payment or the completed pickup?                                | The first payment.                                                                                                                                                                          |
| B6  | "Storage Delivery By" a year late: a bug?                                                                | Treated as a bug; plain month addition.                                                                                                                                                     |
| B7  | Billable weight divisor: 139 or 166?                                                                     | 139 everywhere (what customers are charged on today); a setting.                                                                                                                            |
| B8  | Is there really no capacity limit per time window or truck?                                              | No limit; managers block time with unavailability.                                                                                                                                          |
| B9  | Is West Campus meant to be Off-Campus? When is "Counter" used?                                           | Each building has its own category (seeded as the old system behaves); "Counter" is a tick box on the order.                                                                                |
| B10 | Intake happens on the crew's phones today. Where should it live?                                         | In the staff portal's order page, usable on a phone (375px wide). No separate crew portal.                                                                                                  |
| B11 | Are truck crew members individual users?                                                                 | **Changed from the earlier default:** crews are recorded by name, as in Salesforce (where they are contacts, not logins). Linking a crew member to a login can be added when crews sign in. |
| B12 | Should the system calculate the fees that exist only as website text (peak, late, missed, packing rate)? | No. They are products on the price list that staff add by hand.                                                                                                                             |

Also chosen without a manager's input, and worth a second look:

- **What a refund does to the order.** A refund is recorded on the payment; the charges stay
  marked paid and the order is not reopened (Q-ORD-08).
- **Any payment starts the storage clock**, including cash and a payment that only covers
  supplies on a storage order (as the old system does; Q-ORD-06).
- **An earlier article can be added to a new order whatever its status**, and is then charged
  storage again (as the old system does; Q-ORD-32).
- **Staff rescheduling keeps the appointment's status** (the old system reset it to
  Unconfirmed only when the _customer_ rescheduled; R-SCH-033).
- **No confirmation email for packing appointments** (the old system has none; R-SCH-036).
- **All prices, zones and rates in the seed data are invented.**

## Before going live

1. **Answer the decisions above** and the questions in `OPEN_QUESTIONS.md` with a BRSS manager.
2. **Enter the real price list, storage terms, zip zones and rates** (Pricing and Zip zones
   pages, or an import). The seeded ones are made up.
3. **Connect a card company.** The payment form offers two test cards only. Real cards need the
   Stripe adapter switched on with test keys, and a card form from Stripe in
   `pages/forms/payment-form.tsx` (see `docs/HANDOFF.md`).
4. **Connect real email** (the confirmation email is only printed to the server log today).
5. **Import the existing customers, orders and articles** from Salesforce. Only customers can
   be imported so far (`docs/HANDOFF.md`).
6. **Decide who gets which permission** and add the real staff in People and access.

## Tests

- `tests/integration/brss.test.ts`: every rule in `rules.ts`, then the workflows against the
  database (orders, intake, pricing, payment, declined cards, discounts, locations, appointments,
  unavailability, permissions, live versus test mode).
- `tests/e2e/brss.spec.ts`: the same workflows in a real browser.
- The platform's registry-driven tests cover all 14 tables automatically: tenant isolation,
  archive/restore logging, executive read-only, test-mode reset.
