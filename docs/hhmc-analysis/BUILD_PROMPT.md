# HHMC module — build prompt (Phase 5)

Paste everything below the line into Claude Code, opened in a clone of `sai-cto/sai-platform`,
in an environment that can run `npm install` and Docker (the same setup that built Phases 1–4).

---

## Objective
Build the Hired Hands Moving Company (`hhmc`) module of the SAI platform. It replaces Movegistics for one move's whole life: Lead → Job → Quote → customer e-sign + deposit → Booking → Schedule → Invoice → Payment. Rebuild HHMC's workflow, not Movegistics' look. Managers find Movegistics cluttered, so the main goal is fewer screens and one record per move.

## Authorization (from Jai, CTO)
The HHMC requirements are now agreed. The agreed source is `docs/hhmc-analysis/movegistics-reference.md` (on this branch), and its §10 recommendations are requirements. You are cleared to:
- turn the `hhmc` scaffold into a real module
- remove `hhmc` (only `hhmc`; `sare` stays) from the "pending requirements" test in `tests/integration/modules.test.ts`
- update the "Do NOT build HHMC" line in `docs/BRIEF.md` and record this in `docs/DECISIONS.md`

## Start here
1. Read `docs/PROGRESS.md`, `docs/BRIEF.md`, `docs/ARCHITECTURE.md`, `docs/MODULE_GUIDE.md` and `docs/DECISIONS.md`, then all of `docs/hhmc-analysis/movegistics-reference.md`. Also read the Next.js guides AGENTS.md points to before writing any code.
2. `git fetch origin && git checkout phase-5-hhmc`. If `phase-4-brss` is not yet merged into `main`, STOP and ask whether to rebase this branch onto `phase-4-brss` or wait. Both branches generate migrations, and parallel migration journals conflict.
3. `npm install && npm run setup` (in a cloud container, start `dockerd` first). Then `npm run check` and `npm run test:e2e` must be green before you change anything.
4. Follow the repo's loop: plan → build → verify → review gate → UI gate → record → **stop before merge**. Write the plan to `docs/hhmc-analysis/PLAN.md`, commit it, and continue without waiting unless it hits a "stop and ask" item below.

## Build it the platform way (MODULE_GUIDE steps 3–15)
- Use the core services and don't rebuild them:
  - Contact = core `customers`
  - deposits and payments = `takePayment` / `refundPayment` (mock provider)
  - booked Job Days = `bookAppointment`, with trucks as scheduling `resources`
  - emails = `notifications`
  - PDFs and documents = `files`
  - dashboard numbers = `widgets` + `analytics`
- Every status change writes the activity log through the record functions.
- Module tables are only for what the core lacks: leads, jobs, job days (linked to appointments), quote lines, estimates, invoices and invoice lines, automation rules and queue, and settings data (catalog, rates, templates). All tables use `tenantTable()` and `sameTenant()` and are prefixed `hhmc_`.

## Domain model (consolidate, don't copy)
- **Lead**: the fields from ref §3.2. **Source** is a fixed picklist (Google, Website, Referral, Repeat Customer, Cornellian, Social, Third-party, Other) plus a free-text "source detail". Keep the UTM/GCLID/FBCLID fields. Statuses: `New`, `Disqualified` (reason and date), `Converted`. A lead converts into a Job and reuses an existing customer when email or phone matches; warn on a probable duplicate.
- **Job** replaces BOTH the Work Request and the Work Order. Fields: customer, optional company/PO, origin/destination (plus extra stops), move date, tentative, arrival window, service type (Local / Intrastate / Interstate), job type (ref §9.1), bedrooms, crew size, trucks, customer comments, scope of work, internal notes, owner and coordinators, rating, automation opt-in. A Job has 1..n **Job Days** for multi-day moves.
  Stage is a single field: `Qualified → Estimate Sent → Booked → Completed → Closed`, plus `Lost` (with a reason) and `Cancelled`. One service function validates every transition. No tags that repeat stages.
- **Quote**: exactly one per Job, holding the 7 sections from ref §3.4. **Estimates** are immutable, versioned snapshots taken when sent. Statuses: `Draft, Sent, Viewed, Signed, Void`. Sending v2 voids an unsigned v1, so there are never two live estimates.
- **Invoice**: built from the signed estimate (or the quote) plus actual hours, and subtracts deposits received. Statuses: `Draft, Sent, Partially Paid, Paid, Void`. Terms are Due On Receipt / Net 7/15/30/60.
- **Settings** go in the module `settings` schema plus seed:
  - catalog and rates from ref §4.1, discounts (3 × 5%), valuation (Basic $0.60/lb, $0)
  - deposit 20%, Service Tax % and Card Convenience Fee % (separate settings, both default 4%)
  - 15-minute rounding, 30-day estimate expiry, crew/truck capacity
  - T&C and email templates

## Pricing rules: the 3 examples in ref §4.2 are acceptance tests
- Line = Qty × Rate − discount (% or $). Section = sum of its lines. Subtotal = sum of sections. Grand Total = Subtotal + Service Tax (if on for this estimate) + Convenience Fee (if on).
- Deposit = 20% × (Subtotal + Service Tax). When paid by card, add the convenience fee % on top.
- Invoice: Total − Deposit Received (including the card fee paid on it) − Payments = Balance Due.
- Use integer cents and round half-up.
- Tests MUST reproduce exactly:
  - A: $709.80 total, $136.50 + $5.46 = $141.96 deposit
  - B: $2,313.47 + $92.54 = $2,406.01, deposit $481.20
  - C: invoice $202.80 − $40.56 = $162.24
- Put the pricing engine in pure functions in `src/modules/hhmc/services/pricing.ts`.

## Staff portal (the App tab)
Nav: **Dashboard, Leads, Jobs, Schedule, Invoices**. Customers and payments are already in the console's shared tabs, so link to them rather than duplicating them.
- **Job page** is one page with everything: summary, addresses, Quote editor (live totals in a small `'use client'` part rendered from the server page), estimates (send, resend, copy link, void), Book / Release Booking, Job Days, invoices, payments, activity, notes, and Log a Call (Spoke / Voicemail / RingCentral Call plus a note).
- Booking is a manual staff action. Signing and paying the deposit sets a "Ready to book" badge and does NOT auto-book.
- **Schedule**: one calendar with Day, Week and Month views, labeled "time · customer · M:crew / T:trucks". Daily crew and truck capacity vs booked. "Mark date sold out".
- **Dashboard widgets**:
  - leads this month and conversion rate
  - estimates sent, viewed and signed
  - booked revenue by month and by source
  - open, paid and past-due invoice totals
  - median time from lead to first estimate

## Customer pages
The customer reviews and signs the estimate (4 steps, ref §7.3: Summary → full Estimate with T&Cs → E-sign (initial Valuation, typed final signature, store timestamp, IP and user agent) → Confirmation with Pay Deposit), then pays the invoice balance from an emailed link, without an account.
The platform has not decided how customers sign in (HANDOFF.md). So **STOP and propose** the smallest core addition, for example a signed, expiring, single-purpose link token checked in `src/core` with its own tests, in `docs/hhmc-analysis/PLAN.md`. Ask Jai before changing `src/core` or `src/app`. While waiting, build everything else.

## Automations
Rules are data. The queue is in a module table, and one processor function takes `now` and sends what's due through `notifications`.
- Sequences:
  - estimate drip at +2 h, +1 d, +3 d, +7 d
  - lead no-contact emails at 0 / +24 h / +2 d
  - payment receipt, "You're booked"
  - "How did your move go?" when an invoice is paid in full
  - past-due reminder 8 days after an invoice is sent
- A queued drip MUST be cancelled when the Job leaves `Estimate Sent`, when the estimate is signed, or when opt-in is off.
- The platform has no scheduler yet (HANDOFF.md). Expose the processor through a tech-only "Run due emails" action and an `npm` script. Record the scheduler as an open item.

## Out of scope
Crew app, BOL, claims, long-distance trips, surveys and inventory, storage/billing/claims pipelines, multipliers, tariffs, SMS, commissions and payroll, canned reports, QuickBooks, RingCentral, importing Movegistics data.

## Acceptance criteria
- [ ] `npm run check` (typecheck, lint, integration tests, secret scan) and `npm run test:e2e` are green; `npm run docs:permissions` has been regenerated
- [ ] Registry-driven tests cover every `hhmc` entity (isolation, archive/restore, sandbox reset); `seed.ts` has ≥2 fake rows per table
- [ ] Pricing tests A, B and C pass to the cent
- [ ] `tests/integration/hhmc.test.ts` runs the full lifecycle: lead → convert → quote → send → view → sign → deposit (mock) → book → invoice → pay → `Closed`, with the right statuses and activity entries at each step
- [ ] Tests prove: drip cancelled on booking or signing; v2 voids unsigned v1; a staff member without the permission is refused; sandbox and live never mix
- [ ] UI gate: screenshots of every HHMC screen at 1440px and 375px in `docs/screenshots/phase-5/`
- [ ] Independent review gate (reviewer subagent with no access to your reasoning), repeated until nothing above minor
- [ ] The module `README.md` lists every rule with a ref § citation. `DECISIONS.md` records how each ref §11 open question was handled. `PROGRESS.md` gets a Phase 5 verification log.

## Guardrails
- Never push `--force` and never rewrite `main`. Never touch `../brss-salesforce` or run `sf`/`sfdx`. Never visit or call go.movegistics.com.
- No real data, credentials or live keys.
- No new dependencies beyond DECISIONS A3.
- At most 2 subagents at once.
- Commit and push `phase-5-hhmc` after each working step, running `npm run check` first.
- STOP and ask before:
  - changing `src/core` or `src/app`
  - adding a dependency
  - merging to `main`
  - expanding scope
- Also stop and report if the same failure survives 3 genuine fix attempts.

## Reporting
Report at each loop stage: what was done, a check/test output summary and the commit hash. Ground every "done" in real command output. End with the acceptance checklist, each item marked pass or fail with evidence, plus what's stubbed and what's waiting on Jai.
