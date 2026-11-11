# Phase 5 — HHMC module: plan

Source of requirements: `docs/hhmc-analysis/movegistics-reference.md` ("ref"), its §10
recommendations, and the Phase 5 build prompt from Jai (CTO). This plan follows
`docs/MODULE_GUIDE.md` steps 3–15 inside the existing `src/modules/hhmc/` scaffold.

**Branching (decided by Jai, 11 Nov 2026):** `phase-4-brss` was not merged into `main`, so this
work is based on `phase-4-brss` (HHMC's migration comes after BRSS's `0006`). Work is pushed to
the session branch `claude/practical-brahmagupta-1o62aq` (Jai's choice); it contains the two
HHMC docs commits from `phase-5-hhmc` on top of `phase-4-brss`. **It must be merged after
`phase-4-brss`.**

## 1. One record per move

Movegistics spreads a move over six records (Lead → Work Request → Estimate → Work Order + BOL →
Invoice → Payment), each with its own status, plus stage tags (ref §2, §10). HHMC gets:

| Record | Where it lives | Replaces |
|---|---|---|
| Customer | core `customers` | Contact (ref §3.6) |
| Lead | `hhmc_leads` | Lead (ref §3.2) |
| **Job** | `hhmc_jobs` | Work Request **and** Work Order (ref §3.3, §3.10) |
| Job Day | `hhmc_job_days` + core `appointments` (one per truck, `subject = hhmc.job_day`) | WO activity dates, multi-day moves (ref §3.4) |
| Quote | `hhmc_quotes` (exactly one per job, unique index) + `hhmc_quote_lines` | Move Pricing, WO Pricing copy (ref §3.4, §10 "pricing copied three times") |
| Estimate | `hhmc_estimates` — immutable versioned snapshot taken when sent | Estimate (ref §3.5) |
| Invoice | `hhmc_invoices` + `hhmc_invoice_lines` | Invoice (ref §7.1) |
| Payment | core `payments` via `takePayment` / `refundPayment` (`subject = hhmc.estimate` for deposits, `hhmc.invoice` for balance payments) | Payment (ref §7.2) |
| Notes and calls | `hhmc_notes` (kind `note` / `call`, call outcome) | Notes, Log a Call (ref §3.3) |
| Truck | core `resources` (`kind = 'truck'`) | Vehicles (ref §6) |
| Sold-out date | core `unavailability` (business-wide, whole day) | "Mark as Sold Out" (ref §3.13) |
| Emails | core `notifications` | Conversations / Sent Items (ref §3.14) |
| Estimate document | core `files` (see §8, "PDF") | Documents › Estimates (ref §3.14) |
| Automation rules, queue | `hhmc_automation_rules`, `hhmc_automation_queue` | Automations (ref §9.2) |
| Catalog, discounts, templates | `hhmc_catalog_items`, `hhmc_discounts`, `hhmc_templates` | Line Items, Discounts, T&C and email templates (ref §4.1, §4.3, §9.1) |

Every table: `tenantTable()`, `sameTenant()` links, `hhmc_` prefix, registered as an entity
(parents first), ≥2 fake rows in `seed.ts`.

Not built (out of scope, ref §10 "unused"): BOL, crew app, claims, trips, surveys/inventory,
storage/billing/claims pipelines, multipliers, tariffs, SMS, commissions/payroll, canned
reports, QuickBooks, RingCentral, Movegistics import. No tags (they only repeated stages).

## 2. Statuses and the one transition function

**Lead** (`New → Disqualified | Converted`, `Disqualified → New` to reopen). Disqualify needs a
reason; the date is stamped. Convert creates a Job and links (or creates) a customer — an
existing customer is reused when email or phone matches; a probable duplicate (same name,
different contact details) is shown as a warning before converting.

**Job stage** — one field, one function (`rules.ts: canMoveStage`, `services/jobs.ts: moveStage`):

```
Qualified ──send estimate──▶ Estimate Sent ──book──▶ Booked ──create invoice──▶ Completed ──invoice paid in full──▶ Closed
    ▲   └──────────── Lost (reason) ◀─────────┘│   ◀─release booking─┘
    └──reopen── Lost                           └── Cancelled (reason) ◀── Qualified | Estimate Sent | Booked
```

- `Estimate Sent → Qualified` happens automatically when the only live estimate is voided.
- `Booked → Estimate Sent` = Release Booking (cancels the job's appointments).
- Booking is manual (`hhmc.jobs.book`) and needs a signed estimate. Signed + deposit paid shows a
  "Ready to book" badge; nothing books itself (ref §11 Q3, decided by the prompt).
- Every stage change is an `updateRecord` on the job, so it is in the activity log with before/after.

**Estimate**: `Draft → Sent → Viewed → Signed`, any unsigned one `→ Void`. Sending v2 voids an
unsigned v1 in the same transaction (a partial unique index also refuses two live estimates per job).
A signed estimate cannot be voided while the job is Booked.

**Invoice**: `Draft → Sent → Partially Paid → Paid`, `Draft|Sent → Void`. Terms: Due On Receipt,
Net 7/15/30/60 → due date.

## 3. Pricing engine (`services/pricing.ts`, pure, integer cents, half-up)

```
line      = round(qty × rate) − discount          (qty in hundredths; discount % in basis points, or $ in cents)
section   = Σ lines                                (7 sections, ref §3.4)
subtotal  = Σ sections
tax       = round(subtotal × serviceTax%)          if on for this quote/estimate/invoice
fee       = round((subtotal + tax) × cardFee%)     if on
total     = subtotal + tax + fee
deposit   = round(20% × (subtotal + tax));  by card: + round(deposit × cardFee%)
invoice balance = total − deposit received (incl. its card fee) − payments
```

Acceptance tests (ref §4.2): A $709.80 / $136.50 + $5.46 = $141.96; B $2,313.47 + $92.54 =
$2,406.01, deposit $481.20; C $202.80 − $40.56 = $162.24.

## 4. Settings (module `settings` schema + seeded tables)

Settings form: deposit 20%, Service Tax 4%, Card Convenience Fee 4%, 15-minute rounding,
30-day estimate expiry, crew capacity per day, truck capacity per day, default arrival window.
Seeded tables: catalog and rates (ref §4.1), discounts (Friends & Family / Cornellian / Repeat
Customer, 5% each), valuation (Basic $0.60/lb, $0), T&C per service type, email templates.

## 5. Staff portal (App tab)

Nav: **Dashboard · Leads · Jobs · Schedule · Invoices** (customers and payments link to the
console's shared tabs). Routes:

| Path | Page |
|---|---|
| `` | Dashboard: leads this month + conversion, estimates sent/viewed/signed, booked revenue by month and by source, open/paid/past-due invoices, median lead → first estimate |
| `leads`, `leads/new`, `leads/:id` | Lead list (status/source filter, search), add, lead page (edit, disqualify, couldn't-reach sequence, convert with duplicate warning) |
| `jobs`, `jobs/new`, `jobs/:id` | Job list (stage filter), new job, **the Job page**: summary, addresses, Quote editor (live totals in a small `'use client'` component rendered from the server page), estimates (send, resend, copy link, void), Book / Release Booking, Job Days, invoices, payments, activity, notes, Log a Call |
| `schedule` | One calendar: Day / Week / Month, "time · customer · M:crew / T:trucks", daily crew and truck capacity vs booked, mark/unmark date sold out |
| `invoices`, `invoices/:id` | Invoice list (status, past due) and invoice page (lines, totals, send, record payment, void) |
| `settings` | Catalog, discounts, templates, automation rules, "Run due emails" (tech) |

Permissions (module): `hhmc.leads.read/write`, `hhmc.jobs.read/write`, `hhmc.jobs.book`,
`hhmc.invoices.read/write`, `hhmc.catalog.read/write`, `hhmc.automations.run`. Shared ones reused:
customers, payments, scheduling, notifications, files. "Run due emails" is shown and accepted for
platform roles only (tech / super admin); the permission matrix itself is not changed.

## 6. Automations

Rules are rows (`hhmc_automation_rules`: trigger, delay, template, active, respects opt-in).
Events enqueue rows in `hhmc_automation_queue`; `processDueAutomations(ctx, now)` sends what is
due through `sendNotification`, re-checking each row's condition at send time. Zero-delay rows
are processed immediately in the same transaction when the actor may send notifications.

| Sequence | Trigger | Cancelled when |
|---|---|---|
| Estimate drip +2 h, +1 d, +3 d, +7 d | estimate sent | job leaves Estimate Sent, estimate signed or voided, opt-in off |
| Lead no-contact 0 / +24 h / +2 d | staff press "Couldn't reach" on a lead | lead converted or disqualified |
| Payment receipt | payment taken | — |
| "You're booked" | job booked | booking released |
| "How did your move go?" | invoice paid in full | opt-in off |
| Past-due reminder +8 d | invoice sent | invoice paid or void |

No scheduler exists (HANDOFF): exposed as the tech-only "Run due emails" button and
`npm run hhmc:automations` (runs every business-environment's due rows with the system actor).
The scheduler stays an open item in HANDOFF.

## 7. Customer pages — STOP: needs Jai (core change)

The customer must review/sign the estimate (ref §7.3: Summary → full Estimate with T&Cs → E-sign:
initial Valuation, typed final signature, timestamp, IP, user agent → Confirmation with Pay
Deposit) and pay an invoice balance from an emailed link, **without an account**. Today the
customer portal host (`src/app/portal/…`) requires a console login, and how customers sign in is
undecided (HANDOFF). This needs a change to `src/core` and `src/app`, which I may not make
without approval.

**Proposal: signed, expiring, single-purpose link tokens.** Smallest version:

1. `src/core/links/links.ts` (new, ~80 lines):
   - `signLink({ businessId, environment, purpose, subjectId, expiresAt })` → an opaque token:
     base64url(payload) + "." + HMAC-SHA256(payload, `LINK_SIGNING_SECRET` from `.env.local`).
     No table: nothing to store, nothing to leak from the database.
   - `verifyLink(token, purpose)` → payload, or `NotFoundError` if the signature is wrong, the
     purpose differs, or it has expired. Constant-time compare.
   - `buildLinkContext(payload)` → a `BusinessContext` whose actor is "Customer (link)" (no user
     id) and whose permissions are exactly the set the module declared for that purpose — nothing
     else. Every write it makes is in the activity log as that actor.
2. `ModuleManifest.linkPurposes?: { key: string; permissions: string[]; ttlDays: number }[]`
   (contract addition; `validateRegistry()` checks the keys start with the module key and that
   no purpose grants a platform, people, settings or purge permission).
3. One route, `src/app/l/[token]/[[...path]]/page.tsx`, that verifies the token, builds the link
   context and renders the module's `portals.customer` route for that purpose (reusing
   `PortalHost`), plus `requireLinkContext()` in `src/server/session.ts` for its server actions.
4. Revocation without a table: the module's services refuse a link whose subject is no longer in
   the right state (a void estimate, a paid invoice). Expiry: 30 days (= estimate expiry).
5. Tests in `tests/integration/links.test.ts`: tampered token, wrong purpose, expired, other
   business, sandbox token cannot reach live (environment is inside the signed payload), link
   context cannot read anything outside its permission set.

Alternative if Jai prefers revocable links: the same, plus a core `access_links` table storing
only a SHA-256 of the token (one migration). Slightly bigger; allows "revoke link" by hand.

**While waiting** I build everything else, including the customer-side services
(`viewEstimate`, `signEstimate`, `payDeposit`, `payInvoice`) behind the module permissions
`hhmc.estimates.respond` and `hhmc.invoices.pay` that a link context would hold. The lifecycle
test drives them directly; only the URL and its context are missing. "Copy link" on the Job page
shows that the customer link is waiting on this decision.

## 8. Other choices (recorded in DECISIONS.md as they are made)

- **Estimate "PDF"**: no PDF library is approved (A3). The estimate document is saved through
  `files` as a self-contained HTML document (print-to-PDF from the browser). Real PDF = a
  dependency decision for Jai.
- **4% charge (ref §11 Q4)**: two separate settings (Service Tax %, Card Convenience Fee %), per
  the prompt. Fee applies only when ticked on the estimate/invoice or when paying by card.
- Owner / coordinators: staff of the business; defaults to the person creating the record.
- Times are in the business's time zone (America/New_York).

## 9. Build order (commit + `npm run check` + push after each)

1. Plan (this file) ✅ → 2. Pricing engine + tests A/B/C → 3. Schema, entities, permissions,
settings, migration, seed; remove `hhmc` from the "pending requirements" test → 4. Services:
leads, jobs/stage, quote, estimates, booking/job days, invoices, payments, notes/calls,
automations + `tests/integration/hhmc.test.ts` (lifecycle, drip cancellation, v2 voids v1,
permission refusal, sandbox/live) → 5. Pages + actions → 6. E2E `tests/e2e/hhmc.spec.ts` →
7. Review gate (independent subagent, repeat until nothing above minor) → 8. UI gate
(screenshots 1440 / 375 in `docs/screenshots/phase-5/`) → 9. README rules with ref § citations,
DECISIONS (incl. every ref §11 question), BRIEF line, PROGRESS log, `docs:permissions` →
**stop before merge**.

---

# Phase 5C — HHMC on real data, and the managers' own requirements (11 Nov 2026)

Sources: the managers' written input ("Hired Hands Software Input", Nov 2026, kept by the CTO —
not in the repo), Movegistics' own settings and list exports (read-only, 11 Nov 2026), and the
CTO's Phase 5C prompt. **Where the managers' document conflicts with the Phase 5 build, the
managers win** and the conservative choice is logged in DECISIONS (P5C-*), most as NEEDS JAI REVIEW.

## What the managers asked for → where it is

| Managers' requirement | Status | Where |
|---|---|---|
| **Must-have 1: Lead → Estimate → Invoice** | ✅ end to end, also on a real repeat customer (throw-away copy) | `scripts/hhmc-import/must-haves.ts`, `tests/integration/hhmc.test.ts` |
| **Must-have 2: payments linked to jobs and invoices** | ✅ deposits on the estimate, balance on the invoice; 1,383 real payments imported and linked (19 had no single matching contact) | `services/estimates.ts`, `services/invoices.ts`, importer |
| **Must-have 3: calendar of moves** | ✅ month first, colour-coded (booked moves, estimates, work requests, invoices due), legend with show/hide, week + day views | `pages/schedule-page.tsx`, `services/calendar.ts` |
| Flow: lead → qualify → "no contact" = 3 follow-up emails over a week | ✅ "Couldn't reach" starts emails same day / day 3 / day 7 (NEEDS JAI REVIEW: exact days); "No contact" badge | `seed-data.ts RULES`, `pages/leads.tsx` |
| 20% deposit; valuation $0.60/lb per article | ✅ (already; confirmed against Movegistics settings) | settings, catalog |
| Final invoice = actual work − deposit | ✅ | `services/invoices.ts` |
| Estimate builder: load/drive/unload as 1 or 3 lines at the hourly rate | ✅ | `services/builder.ts`, `pages/estimate-builder.tsx` |
| Cornellian $20/hr off | ✅ as a lower hourly rate (setting); old 5% discount archived (migration 0009) | builder, settings |
| Own truck (labor only) vs ours | ✅ | builder |
| Local truck day fee ($195 for 16'); long distance (> ~150 mi) small day fee + per mile ~$0.10 under U-Haul | ✅ threshold is a setting (150); per-mile rates are line items | builder, Settings › Line items |
| Materials (dollies, blankets, wrap, boxes), packing help | ✅ any line item with a quantity; packing labor $195/hr (NEEDS JAI REVIEW: no Movegistics item) | builder |
| Notes on locations (stairs, elevator, split loading, fragile/unusual) | ✅ per end, ticks + text, on the job page | builder, job page |
| Automatic mileage and drive time | ⚠️ adapter built; **NEEDS JAI REVIEW**: no `GOOGLE_MAPS_API_KEY` yet → manual entry with a clear note | `services/maps.ts` |
| Cost categories with dropdowns of pre-generated line items, set up in Settings ("very important") | ✅ HHMC's real 32 Movegistics line items seeded; add/edit by cost category | `seed-data.ts CATALOG`, Settings › Line items |
| "Created by" on every estimate | ✅ `created_by_name` (staff name when sent; Movegistics owner when imported) | Estimates list, job page |
| Detailed estimates and work requests | ✅ (Phase 5); imported history carries totals only (see gaps) | |
| Date-range dashboard; **every number clickable** to name, move date, amount, paid/unpaid | ✅ | `pages/dashboard-page.tsx`, `services/dashboard.ts` |
| Sidebar in their words: Leads, Estimates, Work Requests, Contacts, Calendar, Invoices | ✅ "Jobs" is now "Work Requests", "Schedule" is "Calendar"; new Estimates list and Contacts (no duplicate screens) | `manifest.ts` |
| Repeat customers: "New estimate / work request" on a contact | ✅ keeps contact details, prefills how they moved last time; only new addresses and dates | `pages/contacts.tsx`, `pages/jobs.tsx` |
| Settings: one simple page per area; automations "when X → send Y", no tags | ✅ Line items · Discounts · Automatic emails · Documents and branding · Trucks | `pages/settings-page.tsx` |
| Branding beyond a logo (colours, header/footer, company info) | ✅ module settings; customer estimate/invoice pages and stored estimate document | `settings.ts brandOf`, `customer-page.tsx`, `document.ts` |
| Real Hired Hands history in the software | ✅ local only; reconciles to the cent (`~/Documents/SAI/hhmc-data/RECONCILIATION.md`) | `scripts/hhmc-import` |

## Import design (`npm run hhmc:import`)

Movegistics' list exports (Contacts, Leads, Work Requests, Estimates, Work Orders, Invoices,
Payments) → `movegistics.ts` (pure mapping, every unlinked record counted) → `load.ts`
(createRecord/updateRecord in batches of 250, `hhmc_import_refs` = Movegistics id → local id +
content hash, so a re-run updates instead of duplicating) → `reconcile.ts` (Movegistics' numbers
computed straight from its CSVs, independent of the mapping, against HHMC live, per month).
Local database only, HHMC live only; the sandbox stays fake. Nothing is emailed, queued or
charged: payments are recorded as already received (`manual` provider).

**Known gaps of the export (NEEDS JAI REVIEW):** no estimate or invoice line items (totals only:
imported estimates and invoices carry one line saying so — the Open API or the detail pages
would give the lines); 74 estimates name no matching work request (not imported); 7 partial
refunds have no amount; multi-day job dates and actual hours come only from work-order start dates;
Terms & Conditions text and email templates still to be copied by hand.

## Later (listed, not built now)

- **Claims pipeline** (today it "mostly just lives in the email").
- Integrations: **Homebase** (labor cost), **BILL** (expenses, mover reimbursements),
  **RingCentral** (calls), **Outlook** (the HHMC mailbox), **SharePoint** (P&L and performance
  dashboard). Until then the P&L is built from Movegistics revenue and payments only; labor and
  expenses are empty (export them by hand into `~/Documents/SAI/hhmc-data/raw/other/`).
- **Crew app** (the managers: "impossible to set up" in Movegistics; not used).
- Movegistics Open API pull for line items, if the CTO provides `MOVEGISTICS_API_KEY`.
