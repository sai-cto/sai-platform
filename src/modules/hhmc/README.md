# Hired Hands Moving Company (`hhmc`)

The staff portal and customer pages that replace Movegistics for one move's whole life:
**Lead → Job → Quote → customer e-sign + deposit → Booking → Schedule → Invoice → Payment.**
It rebuilds HHMC's workflow, not Movegistics' screens: one record per move, five sections
in the nav (Dashboard, Leads, Jobs, Schedule, Invoices) plus Settings.

Sources: `docs/hhmc-analysis/movegistics-reference.md` ("ref"; its §10 recommendations are
requirements) and the Phase 5 build prompt from the CTO ("prompt"). The plan is in
`docs/hhmc-analysis/PLAN.md`; decisions are `P5-*` in `docs/DECISIONS.md`.

**Status:** built and tested on fake data. Not live: prices are the ones Movegistics showed,
but terms and email wording are placeholders, no email is really sent, and payments use the
mock card provider (see "Before going live").

## Where things are

| | |
|---|---|
| `schema.ts` | 14 `hhmc_` tables (only what the core lacks) |
| `entities.ts` | One entity per table, for the Data tab and the automatic tests |
| `permissions.ts` | 13 permissions; reuses the core's customers, payments, scheduling, notifications, files |
| `rules.ts` | Business rules as plain functions (stage moves, lead statuses, duplicates, dates, automation checks) |
| `services/pricing.ts` | The pricing engine: pure functions, integer cents, half-up |
| `services/*.ts` | Leads, jobs (the one stage function), quote, estimates, booking and schedule, invoices, automations, dashboard |
| `pages/*.tsx` | Staff screens and the customer pages; `quote-editor.tsx` and `copy-link.tsx` are the only client parts |
| `actions.ts` | Server actions (staff: session; customer: link token) |
| `seed.ts`, `seed-data.ts` | Fake demo moves at every stage; catalog, discounts, templates, rules |
| `scripts/hhmc-automations.ts` | `npm run hhmc:automations`: sends due emails (no scheduler yet) |

## The records

| Record | Stored in | Replaces (ref) |
|---|---|---|
| Customer | core `customers` | Contact (§3.6) |
| Lead | `hhmc_leads` | Lead (§3.2) |
| **Job** | `hhmc_jobs` | Work Request **and** Work Order (§3.3, §3.10, §10) |
| Job Day | `hhmc_job_days`; booked = core `appointments`, one per truck | WO activity dates, multi-day (§3.4) |
| Quote | `hhmc_quotes` (one per job) + `hhmc_quote_lines` | Move Pricing + WO Pricing copy (§3.4, §10) |
| Estimate | `hhmc_estimates`: frozen, versioned snapshot | Estimate (§3.5) |
| Invoice | `hhmc_invoices` + `hhmc_invoice_lines` | Invoice (§7.1) |
| Payment | core `payments` via `takePayment` | Payment (§7.2) |
| Truck | core `resources`, kind `truck` | Vehicles (§6) |
| Sold-out date | core `unavailability`, whole day, whole business | Mark as Sold Out (§3.13) |
| Email | core `notifications` | Sent Items (§3.14) |
| Estimate document | core `files` (HTML) | Documents › Estimates (§3.14) |
| Notes and calls | `hhmc_notes` | Notes, Log a Call (§3.3) |
| Automation rules / queue | `hhmc_automation_rules`, `hhmc_automation_queue` | Automations (§9.2) |
| Catalog, discounts, templates | `hhmc_catalog_items`, `hhmc_discounts`, `hhmc_templates` | Line Items, Discounts, Templates (§4.1, §4.3, §9.1) |

## Rules (each has a test in `tests/integration/hhmc*.test.ts` or `tests/e2e/hhmc.spec.ts`)

### Leads
| Rule | Source | Where |
|---|---|---|
| Fields: name, email, phones, source, move date, move type, storage, bedrooms, addresses, owner, rating, notes, UTM/GCLID/FBCLID | ref §3.2 | `schema.ts hhmcLeads` |
| Source is a fixed list (Google, Website, Referral, Repeat Customer, Cornellian, Social, Third-party, Other) plus free-text detail | ref §10 "lead source list"; prompt | `LEAD_SOURCES` |
| A lead needs a name and an email or phone | ref §3.2 (Lead API requires FirstName); our safe default | `leads.ts checkContact` |
| Statuses New → Disqualified (reason + date) or Converted; Disqualified → New to reopen | ref §2.2; prompt | `rules.ts leadMoveProblem` |
| Converting reuses the customer whose email (then phone) matches | ref §10 "duplicate contacts"; prompt | `rules.ts findMatchingCustomer`, `convertLead` |
| Same name with different details = probable duplicate; a new customer needs explicit confirmation | prompt "warn on a probable duplicate" | `probableDuplicates`, `convertLead` |
| "Couldn't reach" starts three emails at 0 / +24 h / +2 d; they stop when the lead is converted or disqualified | ref §9.2 (Sorry we missed you, Didn't Connect, Last Check In); §2.1 step 2b | `startNoContactEmails`, `automationStillWanted` |

### Jobs and the stage
| Rule | Source | Where |
|---|---|---|
| One Job replaces Work Request + Work Order | ref §10 ("one Job page"); prompt | `hhmc_jobs` |
| Fields: customer, company/PO, origin/destination + extra stops, move date, tentative, arrival window, service type, job type, bedrooms, crew, trucks, comments, scope of work, internal notes, owner, coordinators, rating, opt-in | ref §3.3; prompt | `jobDetailsInput` |
| Service types Local / Intrastate / Interstate; job type must belong to its service type | ref §9.1 (International and Commercial dropped: unused, §10) | `JOB_TYPES`, `isJobTypeFor` |
| Stage is one field: Qualified → Estimate Sent → Booked → Completed → Closed, plus Lost (reason) and Cancelled (reason); every change goes through `moveStage` | prompt; ref §2.2 | `rules.ts canMoveStage`, `jobs.ts moveStage` |
| No tags that repeat stages | ref §10 "tags repeat pipeline stages" | (none built) |
| A new local job gets the 16' Truck Local line | ref §4.1 "default line item" | `createJobInScope` |
| A job day exists for the move date; more can be added (multi-day) | ref §3.4 | `createJobInScope`, `addJobDay` |
| Log a Call: Spoke / Voicemail / RingCentral Call + note | ref §3.3 | `addNote` |
| Cancelling a booked job releases its booking | ref §2.1 step 14 | `cancelJob` |

### Quote and pricing (`services/pricing.ts`)
| Rule | Source |
|---|---|
| Exactly one quote per job, 7 sections: Transportation Labor, Valuation, Packing Materials, Packing Labor, Crating, Additional Services, Storage | ref §3.4; prompt |
| Line = Qty × Rate − discount (% or $); section = Σ lines; subtotal = Σ sections | ref §4.2 |
| Total = subtotal + Service Tax (if on). The Card Convenience Fee (if on) is added **only when paying by card**: "paid by card" = total + fee on (subtotal + tax). New quotes: tax OFF, card fee ON (manager settings) | ref §4.2; H4 / P5-15 (NEEDS JAI REVIEW) |
| Deposit = 20% × (subtotal + tax); paid by card + the fee % on the deposit (only when the estimate has the card fee on) | ref §4.2; prompt |
| Integer cents, half-up | prompt |
| Examples A ($709.80; $141.96), B ($2,406.01; $481.20), C ($202.80 − $40.56 = $162.24) | ref §4.2 — acceptance tests in `hhmc-pricing.test.ts` |
| Discounts Friends & Family / Cornellian / Repeat Customer, 5% each | ref §4.3 |
| Valuation Basic Coverage $0.60/lb at $0; initialed by the customer | ref §4.3, §7.3 |
| The quote locks once an estimate is signed or the job is booked | ref §10 "pricing copied three times … can drift" |

### Estimates
| Rule | Source |
|---|---|
| An estimate is a frozen snapshot of the quote (lines, totals, terms, valuation) taken when sent; snapshot fields cannot be updated | ref §10; prompt |
| Statuses Sent → Viewed → Signed, or Void. (Draft is in the list but never produced: the snapshot is taken at send, P5-8) | ref §2.2; prompt |
| Sending v2 voids an unsigned v1 and cancels its emails; a database index refuses two live estimates per job | ref §10 "duplicate estimates"; prompt |
| A signed estimate cannot be voided or replaced | our safe default (P5-9) |
| Voiding the only live estimate returns the job to Qualified | follows from the stage rule |
| Expires 30 days after sending (setting) | ref §4.3, §3.5 |
| Sending emails "Please Sign: [title]" with the customer's link | ref §2.1 step 4, §7.3 |
| Opening the link marks it Viewed | ref §2.1 step 6 |
| E-sign: initial Valuation, typed final signature, agree box; time, IP and browser stored | ref §7.3 step 3; prompt |
| After signing the customer gets "Estimate … has been signed by you" | ref §7.3 |
| Signing + deposit shows "Ready to book"; booking stays a staff action | ref §11 Q3; prompt |

### Booking and schedule
| Rule | Source |
|---|---|
| Book needs a signed estimate and at least one job day; it books one core appointment per truck per day, picking free trucks | ref §2.1 step 9; prompt (trucks as resources) |
| A sold-out date refuses booking (core unavailability) | ref §3.13 "Mark as Sold Out" |
| Release Booking cancels the appointments and returns the job to Estimate Sent | ref §3.3 header |
| One calendar, Day / Week / Month, "time · customer · M:crew / T:trucks", crew and truck capacity vs booked | ref §3.12, §10; prompt |

### Invoices and payments
| Rule | Source |
|---|---|
| Built from the signed estimate; hourly Transportation Labor replaced by actual hours (rounded up to 15 min) when entered | ref §2.1 step 12, §4.1; prompt |
| Balance due = (subtotal + tax) − deposit received (its base, not the card fee paid on it) − payments credited; paying it by card adds the fee. Example C: $156.00 cash, $162.24 by card | ref §4.2 example C, §7.1; P5-15 |
| Statuses Draft → Sent → Partially Paid → Paid, or Void (only without payments) | ref §2.2; prompt |
| Terms Due On Receipt / Net 7 / 15 / 30 / 60 set the due date | ref §7.1 |
| Creating the invoice marks the job Completed; paying it in full closes the job | prompt lifecycle; P5-7 |
| Payments go through the core `takePayment` (mock provider) with an idempotency key per attempt; a declined card is recorded as failed | ARCHITECTURE; prompt |

### Records that cannot be archived (P5-21)
Through any path, the Data tab included (`entities.ts archiveGuard`): signed or live estimates
(only void ones), sent or paid invoices (only void ones, or unpaid drafts), jobs in progress
(only Qualified, Lost, Cancelled or Closed), quote lines once the quote is locked, job days of a
booked job, lines of a sent invoice.

### Automations (rules are data, `seed-data.ts RULES`)
| Email | Trigger | Delay | Respects opt-in | Source |
|---|---|---|---|---|
| Estimate drip ×4 | estimate sent | +2 h, +1 d, +3 d, +7 d | yes | ref §9.2 |
| Lead no-contact ×3 | "Couldn't reach" | 0, +24 h, +2 d | no | ref §9.2 |
| Payment receipt | payment taken | 0 | no | ref §9.2 |
| You're booked | job booked | 0 | no | ref §7.3 |
| How did your move go? | invoice paid in full | 0 | yes | ref §9.2 |
| Past-due reminder | invoice sent | +8 d | no | ref §9.2 |

A queued drip is cancelled when the job leaves Estimate Sent, when the estimate is signed or
voided, and when opt-in is turned off (prompt). Every email is checked again when it is due
(`rules.ts automationStillWanted`), so nothing goes out that is no longer wanted.
Due emails go out with Settings → "Run due emails" (tech team), `npm run hhmc:automations`, or
the hosting's daily scheduler when a manager switches on "Send due automatic emails on a
schedule" (off by default, P5-20).

## Customer pages (no account)

`/l/<token>`: a signed, expiring, single-purpose link (`src/core/links`, approved by the CTO,
P5-1). Two purposes, declared in the manifest with exactly the permissions each may use:
`hhmc.estimate` (review, sign, pay deposit) and `hhmc.invoice` (pay the balance). The services
also check that the link is for the one record being touched. A tampered, expired or
switched-off link is "not found"; a void estimate's link shows "no longer valid".

## Permissions

Staff start with: see and work leads and jobs, send estimates, see invoices and the catalog.
Off by default (an admin grants them): book / release, create and send invoices, change the
catalog and templates. "Run due emails" is for the tech team only. Full matrix:
`docs/PERMISSIONS.md`.

## Before going live

1. Replace the placeholder Terms & Conditions (three service types) and the email wording
   (Settings → Templates).
2. Decide how the 4% is presented (P5-6) and confirm the rates (catalog).
3. Connect a real email channel and card processor (docs/HANDOFF.md).
4. Add a scheduler for `npm run hhmc:automations`.
5. Real PDF documents need a PDF library (P5-5).

## Out of scope (prompt)

Crew app, BOL, claims, long-distance trips, surveys and inventory, storage / billing / claims
pipelines, multipliers, tariffs, SMS, commissions and payroll, canned reports, QuickBooks,
RingCentral integration, importing Movegistics data.
