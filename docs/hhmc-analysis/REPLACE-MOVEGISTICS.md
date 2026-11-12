# What is left before HHMC's managers can stop using Movegistics

_11 Nov 2026. Checked against the code on `main`, the managers' written requirements and the
settings captured from their Movegistics account (text only, no customer data)._

**Short answer:** the managers' three day-one must-haves (Lead → Estimate → Invoice, payments
linked to work, a calendar of moves) work end to end, now with automatic mileage and truck
picking. What stops a switch is **not features**: it is putting the real data online and
connecting real email and real card payments, plus the managers' own contract and email
wording, which only they can provide.

## A. Blockers (cannot switch until done)

| # | What Movegistics does today | What SAI has | Size |
|---|---|---|---|
| A1 | Managers log in from anywhere and see live data | Real history only in the CTO's local database (P5C-1). Nothing of `PRODUCTION-READINESS.md` is done: Microsoft 365 sign-in per manager, a paid production database with backups and a restore test, a cut-over re-import and reconciliation | L |
| A2 | Emails reach customers (connected Gmail: receipts, drips, review requests) | Emails are written and queued but never sent: only the local "not sent" channel exists (`src/core/notifications/notifications.ts`); pilot mode forces it. Needs an email provider sending as HHMC's address (SPF/DKIM) | M |
| A3 | Takes real cards (Authorize.net), saved cards, pay links | Stripe adapter refuses a live key and was never run against Stripe; the customer page offers a test-card dropdown, no real card form; no refund screen (core `refundPayment` is not called by HHMC). Decide the 4% (card fee vs tax) | M–L |
| A4 | Real Terms & Conditions per service type, valuation text, email wording | Every template in `seed-data.ts` is a PLACEHOLDER; Movegistics' T&C and email templates were not copied. Customers cannot sign a placeholder contract | S for us; managers' time |
| A5 | Website form creates leads automatically | No public lead endpoint (`src/app/api` has auth, cron and health only): web leads would be typed in by hand | S–M |
| A6 | Drips go out on time (e.g. "+2 hours") | The scheduled run is once a day (`vercel.json`, 13:17 UTC), so a "+2 h" email can be up to a day late. Needs a run at least hourly | S |
| A7 | Mileage appears by itself | Built (P5D-1…3) but needs a paid `GOOGLE_MAPS_API_KEY` (and optionally `GOOGLE_MAPS_EMBED_KEY` for the map picture). Without it staff type the miles | S (a key and a cost decision) |

## B. Should have soon (they can live without for a few weeks)

1. **Email a customer from a record, and see what was sent** (M). Movegistics has an Email button on every record and a sent log; SAI sends only its templates. Minimum: replies land in the managers' Outlook, plus a "send email" button.
2. **Files and photos on a work request** (S–M). Only the estimate document is stored today.
3. **Export any list to CSV** for the P&L work in SharePoint (S).
4. **Real trucks** (S): the three trucks are placeholders; enter Van, 16' and 26' with the size in the name (Settings › Trucks) so picked trucks price right.
5. **Estimate PDF attached to the "Please sign" email** (S–M; needs a PDF library decision). Customers use the link today.
6. **Warn when addresses change after the quote was built** (S): the miles are cleared and looked up again, but truck pricing on the quote stays until the builder is run again.
7. **Settle the NEEDS JAI REVIEW items:** no-contact days (P5C-8), 150-mile cut-off (P5C-10), packing labor rate and the Cornellian rate on packing (P5C-9, P5C-12), branding (P5C-14), automatic mileage sending addresses to Google (P5D-1).

## C. Later, or not needed

- **Later:** claims pipeline, Outlook / Homebase / BILL / RingCentral / SharePoint links, a P&L with labor and expenses, companies with PO billing, tasks.
- **Not needed (managers say never used, or Movegistics shows it unused):** crew app, dispatch / trips / crew tracking, surveys and inventory, multipliers, tariffs and rate tables, commissions, Mailchimp and lead-feed integrations, in-app texting, tags, the 38 canned reports (the clickable dashboard covers the ones they open). QuickBooks: off unless accounting asks (Movegistics' sync shows "Not synced" on recent invoices).

## D. Data still to bring over

1. Estimate and invoice **line items** (exports have totals only). The Open API has no estimate or invoice endpoints: asked Movegistics support for an export.
2. **T&C, valuation, deposit note, scope templates and email templates** (text, copied by hand).
3. Estimate PDFs, work-order documents and photos.
4. Email history, call and activity logs.
5. Open import questions: 74 estimates with no matching work request, 7 partial refunds with no amount, 7 PAID invoices not covered by payments (`~/Documents/SAI/hhmc-data/RECONCILIATION.md`, outside the repo).
6. Saved cards cannot move from Authorize.net to Stripe without the processors' help.
7. A final re-export and reconciliation on cut-over day, against the hosted database.

## Suggested order

1. Managers: send the T&C and email wording (A4), the real trucks, and answer the NEEDS JAI REVIEW items.
2. Jai: Google Maps key (A7), email provider (A2), hosting checklist (A1).
3. Build: web lead endpoint (A5), hourly scheduled run (A6), CSV export, files on work requests.
4. Real card payments (A3), then the cut-over re-import and a week of running both systems side by side.
