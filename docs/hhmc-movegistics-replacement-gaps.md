# HHMC: like-for-like replacement of Movegistics (gap analysis)

_First audit: 12 Nov 2026 (read-only). Re-scoped the same day: the goal is now a **like-for-like
replacement of Movegistics**. Everything HHMC's managers use in Movegistics today must work in our
software, with all of their real data. No new features._

Status labels: **Done** = built on branch `hhmc/movegistics-parity` with tests. **Working** = already
worked before this branch. **Open** = still to do. **Blocked** = waiting on something only Jai or the
managers can provide.

---

## 1. Summary

Before this branch, the HHMC office flow already worked end to end on fake data: lead → work request →
estimate → customer e-sign → booking → calendar → invoice → payment → closed. The gaps for a
like-for-like switch were:
- **Real data:** loading the real Movegistics history into the local database with one command.
- **Import completeness:** importing every field, not just the ones the first importer mapped.
- **Known reconciliation gaps:** unmatched estimates, partial refunds with no amount, PAID invoices not covered by payments.
- **Recording payments by hand:** payments are entered manually on invoices, without a card processor, the way HHMC actually takes them (cash, check, card through Shopify).
- **Office edge cases:** reschedule, cancel, booking when no truck is free, and the `moveDate` bug.
- **Safety and speed:** a local backup/restore, and performance at full data volume.

Everything about crews on site, Stripe, email delivery, hosting and Microsoft sign-in is now
**Later** (§7), by decision.

---

## 2. Current state (in scope)

| Area | Before this branch | Now | Evidence |
|---|---|---|---|
| Lead → work request → estimate → e-sign → booking → calendar → invoice → closed | Working (fake data) | Working | `tests/integration/hhmc.test.ts`, `tests/e2e/hhmc.spec.ts` |
| Real data in the local dev database | Partial: `npm run hhmc:import` read `~/Documents/SAI/hhmc-data/raw` | see §4 IMP-0 | `scripts/hhmc-import/` |
| Every export field imported | Partial: about half the columns were mapped; the rest were dropped | see IMP-A | `scripts/hhmc-import/movegistics.ts` |
| Manual payments with a method | Partial: cash/check recorded; "card" went through the (mock) processor | see PAY-M | `src/modules/hhmc/services/invoices.ts`, `estimates.ts` |
| Reschedule | Partial: release → edit days → book again; job `moveDate` could disagree with the booked days | see OPS-2, OPS-MD | `services/booking.ts`, `services/jobs.ts` |
| Cancel | Partial: reason only; deposit outcome not recorded | see OPS-3 | `services/jobs.ts cancelJob` |
| Booking with no free truck | Broken: booked silently with no truck | see OPS-4 | `services/booking.ts bookJob` |
| Dashboard on real data | Unverified | see DASH-1 | `services/dashboard.ts` |
| Backup / restore | Missing | see DATA-3 | |
| Performance at full volume | Unverified | see DATA-4 | |
| Data separation, audit log, permissions | Working | Working | `tests/integration/tenant-isolation.test.ts`, `audit.test.ts`, `permissions.test.ts` |

---

## 3. Test and run results

The final numbers for this branch are in §8. The original audit run (12 Nov 2026, before this branch):
typecheck and lint clean, 556/556 integration tests, 51/51 e2e, secret scan clean.

---

## 4. Gap list (in scope)

P0 = before managers start testing in January. P1 = before switching off Movegistics (May).

| ID | Item | Area | Priority | Effort | Depends on | Why it matters | Status |
|---|---|---|---|---|---|---|---|
| IMP-0 | `npm run hhmc:import:real`: reads `data/movegistics/` (git-ignored), loads into the local dev database's HHMC **live** mode, re-runnable without duplicates, prints and saves a reconciliation every run | Import | P0 | M | | Managers test on their own data | Open |
| IMP-A | Import every column of every export with full history: raw row kept per record, mapped to real fields where they exist, the rest shown on the record's page ("From Movegistics") | Import | P0 | M | IMP-0 | Nothing the managers see in Movegistics may go missing | Open |
| IMP-3a | Estimates with no matching work request: link by contact (and dates) when the title doesn't match; otherwise import on a placeholder work request, so no estimate is dropped | Import | P0 | S | IMP-0 | 74 estimates were dropped by the first importer | Open |
| IMP-3b | Partial refunds with no amount: the export has no refund amount, so it can't be calculated. Support an override file `data/movegistics/refund-amounts.csv` (Payment ID, Refunded Amount) and list every partial refund by its Movegistics ID until filled | Import | P0 | S | IMP-0 | Collected totals for those months are otherwise unverifiable | Open |
| IMP-3c | PAID invoices not covered by payments: credit the work request's deposit to its invoice (Movegistics often leaves the deposit unapplied); list what is still uncovered, by invoice ID | Import | P0 | S | IMP-0 | Invoices showed "paid" with no money behind them | Open |
| IMP-WO | Work orders: their dates become the job's days and are kept in step on re-import (unless staff changed them); crew and vehicle text kept on the day | Import | P0 | S | IMP-0 | Calendar must match Movegistics between re-exports | Open |
| IMP-1 | Extra exports to request from Movegistics (§6) | Import | P0 (ask) | S | Jai | Line items, refund amounts and documents are not in the list exports | Blocked (Jai) |
| IMP-2 | Import estimate/invoice line items once Movegistics provides them | Import | P1 | M | IMP-1 | Detailed history for repeat customers | Blocked (IMP-1) |
| IMP-5 | Cut-over runbook: final export → `hhmc:import:real` → reconciliation clean → stop using Movegistics | Import | P1 | S | IMP-0 | One clean switch day | Open |
| PAY-M | Manual payments on deposits and invoices with a method (cash, check, card via Shopify, other), a reference (check no. / Shopify order) and a date; never sent to a processor | Payments | P0 | S | | How HHMC actually takes money | Open |
| OPS-2 | Reschedule a booked move in one step: new date/time → trucks re-checked → appointments moved → job move date updated | Scheduling | P0 | M | | Daily office task in peak season | Open |
| OPS-MD | `moveDate` on a booked job can't drift from its booked days (changing it goes through reschedule) | Scheduling | P0 | S | OPS-2 | Calendar and lists disagreed | Open |
| OPS-3 | Cancel: records the reason and what happens to the deposit (kept / to be refunded outside the app); no refund processing | Ops | P0 | S | | Movegistics records cancellations with a reason | Open |
| OPS-4 | Booking refuses when no truck is free on a day (or a manager books it anyway with "no truck yet", stated clearly) | Scheduling | P0 | S | | A move could be booked with no truck, silently | Open |
| DASH-1 | Dashboard numbers equal the reconciliation's numbers on imported data (invoiced, collected, open balance, work requests) | Reporting | P0 | S | IMP-0 | Managers will compare against Movegistics | Open |
| DATA-3 | `npm run db:backup` / `npm run db:restore` (local database only) | Data | P0 | S | | Real data on a laptop needs a way back | Open |
| DATA-4 | Performance on the full data volume (synthetic set ≥ the real counts); fix anything slow | Quality | P0 | M | | Real data is about 100× the seed | Open |
| OPS-8 | Real trucks (Van, 16', 26') entered in Settings › Trucks | Data | P0 | S | managers | Picked trucks price by size | Open (managers; Settings already supports it) |
| EML-5 | Real Terms & Conditions, valuation text and email wording replace the PLACEHOLDER templates | Content | P1 | S | managers | Customers can't sign a placeholder contract | Blocked (managers) |
| QA-2 | Hydration-mismatch warning on the work request page (phone width) | Quality | P1 | S | | Console noise; possible display glitch | Open |

---

## 5. Suggested build order

1. IMP-0 → IMP-A → IMP-WO → IMP-3a/b/c (real data first: everything else is tested on it).
2. PAY-M.
3. OPS-2 + OPS-MD → OPS-3 → OPS-4.
4. DASH-1.
5. DATA-3 → DATA-4.
6. Walk every screen, then the cut-over runbook (IMP-5) for May.

---

## 6. What to ask Movegistics for (IMP-1)

The seven list exports (Contacts, Leads, Work Requests, Estimates, Work Orders, Invoices, Payments)
are what `hhmc:import:real` reads. They don't contain:

1. **Estimate line items** (item, section, quantity, rate, discount, line total) per Estimate ID, including the T&C version and the valuation choice. The Open API has no estimate endpoint.
2. **Invoice line items** per Invoice ID (same columns), plus applied deposits/credits per invoice.
3. **Refund amounts and dates** per Payment ID (the Payments export says PARTIAL_REFUNDED without an amount). Until then, `data/movegistics/refund-amounts.csv` is filled by hand.
4. **Payment ↔ invoice applications** (which payment, how much, applied to which invoice), so deposits applied to invoices reconcile without inference.
5. **Work order detail:** start/end times (not only dates), actual hours, crew names and vehicles per day.
6. **Signed estimate PDFs and work-order documents/photos** (bulk download), with their Estimate/WO IDs in the file names.
7. **Notes, call logs and email history** per contact / work request (Conversations, Sent Items).
8. **Stable IDs on every row:** the Estimates, Invoices and Work Orders exports link to work requests by title and contact name; a Work Request ID column on each would remove all guessing.
9. **Lead conversion links:** the Work Request ID a lead became.
10. The text of the **Terms & Conditions per service type and every email template** (copied by hand if there's no export).

Export format: CSV, UTF-8, one file per list, all rows ("All" view, no filters), all columns.

---

## 7. Later (out of scope by decision; existing code left in place, not extended)

| Former ID | Item | Why later |
|---|---|---|
| CREW-1 … CREW-14, MGR-1, MGR-6, SEC-1, SEC-2 | Crew role, crew logins, on-site timer, extras, approvals, crew mobile view, operations board | HHMC has no crew role; roles stay as they are |
| PAY-1 … PAY-13 | Stripe, Tap to Pay, card-on-file, webhooks, payouts, refunds through a processor | HHMC doesn't use Stripe; payments are recorded by hand (PAY-M). Tap to Pay is handled separately |
| EML-1 … EML-10 (except the wording, EML-5) | Email provider, delivery, new triggers, HTML layout, sent log, SMS | The console channel stays |
| Hosting, Microsoft 365 sign-in, `PILOT_MODE`, `scripts/hhmc-sync`, PAY-13 | Vercel + Neon, Entra | Deferred |
| OPS-1 | Website form → lead automatically | Needs the website's form details (open question Q2) |
| OPS-5, OPS-6, OPS-7, OPS-9, OPS-10 | Rate tables, structured addresses, Maps key, PDF estimates, storage billing | New features, or need a decision |
| MGR-2 … MGR-5, IMP-4 | Payroll export, damage claims, profit/crew reports, report exports, labor/expense P&L | Not in Movegistics as HHMC uses it (the managers said the canned reports are unused) |
| CUS-1 … CUS-3, DATA-1, DATA-2, DATA-5, DATA-6, QA-1, QA-4, QA-5 (for later features) | Customer move page, new-table integrity, photo storage, monitoring | Tied to the features above |

---

## 8. Open questions for Jai

| # | Question |
|---|---|
| Q1 | Send the extra exports in §6 (at least line items and refund amounts) when Movegistics provides them. |
| Q2 | Does the HHMC website form feed leads into Movegistics today? If yes, which site and which fields (OPS-1)? |
| Q3 | When will the managers send the real T&C, valuation text and email wording (EML-5) and their real trucks (OPS-8)? |
| Q4 | Is the 4% a service tax or a card fee (DECISIONS H4)? Recorded card payments currently add the card fee when the invoice has it on. |
