# HHMC: like-for-like replacement of Movegistics (gap analysis)

_First audit: 12 Nov 2026 (read-only). Re-scoped and built the same day on branch
`hhmc/movegistics-parity`. The goal: everything HHMC's managers use in Movegistics today works in our
software, with all of their real data. No new features. Decisions: `docs/DECISIONS.md` PAR-1 … PAR-8._

Status labels: **Done** = built on this branch, with tests. **Working** = already worked before this
branch. **Blocked** = waiting on something only Jai or the managers can provide.

---

## 1. Summary

Before this branch, the office flow already worked end to end on fake data: lead → work request →
estimate → customer e-sign → booking → calendar → invoice → payment → closed.

This branch adds:
- **One command for the real data:** `npm run hhmc:import:real`.
- **A complete import:** every exported column is kept and shown on its record's page. The known gaps are closed wherever the export allows.
- **Payments recorded by hand:** cash, check, card via Shopify, or other. Nothing goes to a card processor.
- **Office fixes:** one-step reschedule, cancel with the deposit outcome, booking refuses a day with no free truck, and a booked move's date can only change through reschedule.
- **A local backup and restore.**
- **Performance at full volume:** every screen loads its data in under 500 ms at twice HHMC's real volume.

Two importer bugs that would have mattered on real data were found and fixed while checking at full scale:
- A repeat customer's work requests share a title, and every one of them got every work order's days.
- Imported future moves held no trucks.

**Still blocked:** the real Movegistics exports weren't in this environment (`data/movegistics/` was
empty), so the real-data import, its reconciliation and the walkthrough on real data have to be run on
Jai's machine (§3, "To do on real data").

---

## 2. Current state (in scope)

| Area | Status | Evidence | Notes |
|---|---|---|---|
| Lead → work request → estimate → e-sign → booking → calendar → invoice → payment → closed | Working | `tests/integration/hhmc.test.ts`, `tests/e2e/hhmc.spec.ts`; walked in the browser (§3) | |
| Real data with one command | Done (untested on real files) | `npm run hhmc:import:real`, `scripts/hhmc-import/index.ts --real` | Reads `data/movegistics/` (git-ignored). Takes the seven exports by their fixed names, or one CSV per list. The first run clears the demo moves. Prints the reconciliation and saves it to `data/movegistics-reports/` |
| Re-runnable, no duplicates | Done | `hhmc-import*.test.ts` | Re-running the same export changes nothing (7 s at 2× volume). A changed export updates records. A record staff changed in SAI is kept |
| Every field and full history | Done | `hhmc_import_refs.source_data` (migration 0012), "From Movegistics" panel on work request / lead / contact / invoice pages | Mapped now: lead status (disqualified, with reason and date), move type, storage, rating, UTM/click ids; work request company, bedrooms, rating, coordinators, notes; work-order day ranges with crew and vehicle; payment fee and refund reason; merged duplicate contacts keep their own row |
| Estimates with no matching work request | Done | `normalize()` fallback; test "an estimate whose title matches no work request…" | Linked to the contact's work request; otherwise kept on a placeholder work request (listed by id). None dropped |
| Partial refunds without an amount | Done (needs the amounts) | `data/movegistics/refund-amounts.csv` | The export has no amount. Each missing one is listed by Payment ID. Hand-entered amounts are used on both sides of the reconciliation |
| PAID invoices not covered by payments | Done | deposit crediting in `normalize()` | The work request's "Unapplied" deposit is credited to its invoice. At 2× fake volume, uncovered went 245 → 1. What's left is listed by Invoice ID |
| Imported future moves hold trucks | Done | `syncAppointments()` in `load.ts`; test "a move still to come holds a truck…" | Otherwise a new booking could double-book a truck promised in Movegistics |
| Manual payments with a method | Done | `services/manual-payment.ts`, core `takePayment({ recordOnly })`; `hhmc-manual-payments.test.ts`, `hhmc-parity.spec.ts` | Cash, check, card (Shopify), other; reference; date received. Recorded only |
| Reschedule (OPS-2) | Done | `rescheduleJob` in `services/booking.ts`; tests in `hhmc-parity` | All days shift together, optional new start time, trucks re-checked, all-or-nothing, a note says from/to and why |
| Move date drift (OPS-MD) | Done | `updateJob` | A booked move's date changes only by reschedule; an unbooked move's day follows its date; booking sets the move date to the first booked day |
| Cancel (OPS-3) | Done | `cancelJob` | A reason, and when a deposit was paid: kept, or to be refunded outside the software. No refund processing |
| No free truck (OPS-4) | Done | `bookDays` in `services/booking.ts` | Refused with the day named; "Book without a truck" is an explicit choice and shows "no truck yet" |
| Dashboard on imported data (DASH-1) | Done | `hhmc-parity.test.ts` "dashboard on imported Movegistics data" | Monthly invoiced/collected equal the reconciliation. Booked moves without a signed estimate now count, valued from their invoice. Imported moves count as booked on their work order's creation date |
| Backup / restore (DATA-3) | Done | `npm run db:backup`, `npm run db:restore -- <file> --yes`, `scripts/lib/backup.ts`; `backup.test.ts` | Restore runs in one transaction and backs up the current database first; `db:reset` backs up automatically when real data is there |
| Performance (DATA-4) | Done | `npm run hhmc:perf`, migration 0013, `services/dashboard.ts` | See §3 |
| Hydration warning (QA-2) | Done | | No longer reproduces: 17 seeded and 2 imported work request pages at 375 px (staff) and 1440 px (manager) showed no console errors |
| Real trucks (OPS-8) | Blocked (managers) | Settings › Trucks | The screen exists; the managers need to enter Van, 16' and 26' |
| Real wording (EML-5) | Blocked (managers) | Settings › Automatic emails / Documents | T&C, valuation text and email templates are still PLACEHOLDER |
| Data separation, audit log, permissions | Working | `tenant-isolation.test.ts`, `audit.test.ts`, `permissions.test.ts` | Unchanged |

---

## 3. Test and run results

Environment: local PostgreSQL 16 (Docker wasn't available here), Node 22, no hosted services, no
real data.

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | Clean |
| `npm test` | 28 files, **586 passed** (was 556) |
| `npm run secret-scan` | Clean |
| `npm run test:e2e` | **54 passed** (was 51; new `tests/e2e/hhmc-parity.spec.ts`) |
| Import, fixture files, `--real` mode | Matches to the cent; re-run creates nothing |

**Full-scale check (fake data at twice HHMC's real counts,** `scripts/hhmc-import/generate-fake-exports.ts --scale 2`**):** 5,890 contacts,
1,226 leads, 2,792 work requests, 3,223 estimates, 1,506 work orders, 1,481 invoices, 2,764 payments.

- First import: 102 s. Re-run with no changes: 7 s, nothing created or updated.
- Reconciliation: every number matches to the cent (work requests 2,792; invoiced $1,976,591.34;
  collected $1,756,846.76; open balance $226,541.84). 1 PAID invoice left uncovered, listed by id.
- `npm run hhmc:perf` (median of 5, data loading per screen), before → after this branch:

| Screen | Before | After |
|---|---|---|
| Dashboard · all time | 2,049 ms | ~320 ms |
| Dashboard · this month | 285 ms | ~45 ms |
| Payments collected list (all time) | 906 ms | ~170 ms |
| Estimates list | 401 ms | ~50 ms |
| Every other screen (leads, work requests, contacts, invoices, calendar in the busiest month, detail pages) | 6–40 ms | 6–40 ms |

Causes fixed: under row-level security the `environment` enum can't be an index condition, so the
`(business, environment, x)` indexes scanned a whole business per lookup (migration 0013 adds
`(business_id, parent id)` indexes). The payments list joined on `coalesce()`, which compared every
payment with every job (3.8 million comparisons). A new date formatter was built for every row.

**Browser walkthrough** (dev server, full-scale fake data):
- Every HHMC screen (24 URLs, including filters, searches and detail pages) loaded with HTTP 200 and no sideways scroll at 1440 px (manager) and 375 px (staff).
- "From Movegistics" shows each record's rows. Staff don't see payment rows, as their permissions intend.
- Workflows completed in the browser:
  1. Lead → work request → estimate → customer e-sign → deposit recorded (check) → book → calendar → reschedule → actual hours → invoice → send → balance recorded as Card (Shopify) → Closed.
  2. Three moves on one day take the three trucks; the fourth is refused ("No truck is free on …"), then booked without a truck.
  3. Cancel with a deposit, "to be refunded outside the software".
  4. A booked move's date field is read-only.
- No browser errors. The all-time dashboard's open balance equals the reconciliation.

Errors hit (environment, not code):
- The scratch database's folder lost its permissions mid-run once.
- Playwright needed `PLAYWRIGHT_CHROMIUM_PATH`.
- The dev server got into a reload loop twice right after the browser tests had used the same `.next` folder (known: PROGRESS.md). A clean restart fixed it.

**To do on real data (Jai's machine):**
1. Put the seven exports in `data/movegistics/`.
2. `npm run db:migrate`
3. `npm run db:backup`
4. `npm run hhmc:import:real`
5. Read the summary (full report in `data/movegistics-reports/`).
6. Fill `refund-amounts.csv` for any listed partial refunds and re-run.
7. `npm run hhmc:perf`
8. `npm run dev` and walk the screens.

---

## 4. Gap list (in scope)

P0 = before managers start testing in January. P1 = before switching off Movegistics (May).

| ID | Item | Area | Priority | Effort | Depends on | Why it matters | Status |
|---|---|---|---|---|---|---|---|
| IMP-0 | `npm run hhmc:import:real` into local live, re-runnable, reconciliation every run | Import | P0 | M | | Managers test on their own data | Done; **real run Blocked** (needs the exports) |
| IMP-A | Every column of every export kept and shown; more fields mapped | Import | P0 | M | IMP-0 | Nothing seen in Movegistics goes missing | Done |
| IMP-WO | Work-order days on the job, one work order per work request, kept in step on re-import | Import | P0 | S | IMP-0 | Calendar must match Movegistics | Done |
| IMP-TR | Imported future moves hold trucks (appointments) | Import | P0 | S | IMP-WO | No double-booked trucks after cut-over | Done |
| IMP-3a | Unmatched estimates linked or kept on a placeholder | Import | P0 | S | IMP-0 | 74 were dropped | Done |
| IMP-3b | Partial refunds: `refund-amounts.csv`, listed by id | Import | P0 | S | IMP-0 | Collected totals unverifiable otherwise | Done; amounts **Blocked** (managers look them up) |
| IMP-3c | PAID invoices covered by the unapplied deposit; the rest listed | Import | P0 | S | IMP-0 | "Paid" with no money behind it | Done |
| IMP-1 | Extra exports from Movegistics (§6) | Import | P0 (ask) | S | Jai | Line items, refunds, documents | **Blocked (Jai)** |
| IMP-2 | Import line items once provided | Import | P1 | M | IMP-1 | Detailed history | Blocked (IMP-1) |
| IMP-5 | Cut-over runbook (final export → import → clean reconciliation → stop using Movegistics) | Import | P1 | S | IMP-0 | One clean switch day | Open (the steps in §3 are the local part; hosting deferred) |
| PAY-M | Manual payments: method, reference, date | Payments | P0 | S | | How HHMC takes money | Done |
| OPS-2 | One-step reschedule | Scheduling | P0 | M | | Daily task in peak season | Done |
| OPS-MD | Move date can't drift from the booked days | Scheduling | P0 | S | OPS-2 | Lists and calendar disagreed | Done |
| OPS-3 | Cancel with the deposit outcome (no refund processing) | Ops | P0 | S | | Parity with Movegistics | Done |
| OPS-4 | No free truck: refused, or booked "without a truck" on purpose | Scheduling | P0 | S | | Silent truckless bookings | Done |
| DASH-1 | Dashboard numbers equal the reconciliation on imported data | Reporting | P0 | S | IMP-0 | Managers compare with Movegistics | Done (fixture and 2× fake); real data: run step 7 of §3 |
| DATA-3 | Local backup / restore | Data | P0 | S | | Real data on a laptop | Done |
| DATA-4 | Performance at full volume | Quality | P0 | M | | ~100× the seed data | Done |
| OPS-8 | Real trucks entered | Data | P0 | S | managers | Picked trucks price by size | Blocked (managers) |
| EML-5 | Real T&C, valuation and email wording | Content | P1 | S | managers | No signing a placeholder contract | Blocked (managers) |
| QA-2 | Hydration warning on the work request page | Quality | P1 | S | | Console noise | Done (no longer reproduces) |
| PRIV-1 | A customer purge should also remove their import links' raw rows | Privacy | P1 | S | | Raw rows hold personal data (PAR-2) | Open |

---

## 5. Suggested build order (what's left)

1. Jai: put the real exports in `data/movegistics/`, run §3's real-data steps, send the reconciliation summary (totals only).
2. Managers: look up the listed partial refunds and uncovered PAID invoices; enter the real trucks; send the T&C and email wording.
3. Ask Movegistics for the exports in §6; then IMP-2.
4. PRIV-1, then the cut-over runbook (IMP-5) once hosting is decided.

---

## 6. What to ask Movegistics for (IMP-1)

The seven list exports (Contacts, Leads, Work Requests, Estimates, Work Orders, Invoices, Payments)
are what `hhmc:import:real` reads. They don't contain:

1. **Estimate line items** (item, section, quantity, rate, discount, line total) per Estimate ID, with the T&C version and valuation choice.
2. **Invoice line items** per Invoice ID, and **payment applications** (which payment, how much, to which invoice). Then deposits reconcile without inference.
3. **Refund amounts and dates** per Payment ID. The Payments export says PARTIAL_REFUNDED with no amount; until then, `data/movegistics/refund-amounts.csv` is filled by hand.
4. **A Work Request ID column on the Estimates, Invoices, Work Orders and Payments exports.** They link by title and contact name today, which is ambiguous for repeat customers.
5. **Work order detail:** start/end times (not only dates), actual hours, crew names and vehicles per day.
6. **The lead → work request link** (which work request a lead became).
7. **Signed estimate PDFs and work-order documents/photos** (bulk download, named by their IDs).
8. **Notes, call logs and email history** per contact and work request.
9. **Terms & Conditions per service type and every email template** (text).

Format: CSV, UTF-8, one file per list, all rows ("All" view, no filters), all columns.

---

## 7. Later (out of scope by decision; existing code left in place, not extended)

| Former ID | Item | Why later |
|---|---|---|
| CREW-1 … CREW-14, MGR-1, MGR-6, SEC-1, SEC-2 | Crew role, logins, on-site timer, extras, approvals, crew mobile view, operations board | HHMC has no crew role; roles stay as they are |
| PAY-1 … PAY-13 | Stripe, Tap to Pay, card-on-file, webhooks, payouts, processor refunds | HHMC doesn't use Stripe; payments are recorded (PAY-M). Tap to Pay is handled separately |
| EML-1 … EML-10 (except EML-5) | Email provider, delivery, new triggers (incl. reschedule/cancel notices), HTML, sent log, SMS | The console channel stays |
| Hosting, Microsoft 365 sign-in, `PILOT_MODE`, `scripts/hhmc-sync` | Vercel + Neon, Entra | Deferred. A hosted copy would need migrations 0012 and 0013 |
| OPS-1 | Website form → lead | Needs the website's form details (Q2) |
| OPS-5, OPS-6, OPS-7, OPS-9, OPS-10 | Rate tables, structured addresses, Maps key, PDF estimates, storage billing | New features or need a decision |
| MGR-2 … MGR-5, IMP-4 | Payroll export, claims, profit/crew reports, labor/expense P&L | Not in Movegistics as HHMC uses it |
| CUS-1 … CUS-3, DATA-1, DATA-2, DATA-5, DATA-6, QA-1, QA-4, QA-5 | Tied to the features above | |

---

## 8. Open questions for Jai

| # | Question |
|---|---|
| Q1 | Put the real exports in `data/movegistics/` and run §3's steps; and ask Movegistics for the exports in §6 (at least line items, refund amounts, and a Work Request ID on every export). |
| Q2 | Does HHMC's website form feed leads into Movegistics today? If so, which site and which fields (OPS-1)? |
| Q3 | When will the managers send the real T&C, valuation text and email wording (EML-5) and enter the real trucks (OPS-8)? |
| Q4 | The 4%: should a card payment taken in Shopify still add the card convenience fee when the invoice has it on (current behaviour, DECISIONS H4/PAR-6)? |
| Q5 | Should a reschedule or a cancellation email the customer once email delivery is turned on (Later)? Today they leave a note on the move only. |
