# HHMC: before managers use real data online

Today the real Hired Hands history lives **only in the local database on the CTO's Mac**
(imported with `npm run hhmc:import`, reconciled to the cent with Movegistics). This is the short
checklist for putting that data online for the managers. **None of it has been done.** The pilot
mode built in Phase 5 part 3 (`PILOT_MODE`, `docs/DEPLOY-DEMO.md`, DECISIONS P5-31 … P5-38)
already covers several items; they are marked "pilot mode".

## 1. Sign-in
- [ ] Microsoft 365 sign-in configured for SAI's own tenant (`MICROSOFT_TENANT_ID` = SAI's directory id, never `common`). *Pilot mode: Microsoft-only, dev login off.*
- [ ] One account per manager (no shared login — Movegistics' single shared "Super Admin" is why "who made this estimate" is unreliable today). Least access: GM = business admin, others staff.
- [ ] People who leave are switched off in Microsoft 365 **and** in People and access.

## 2. Hosted production database
- [ ] A paid database plan with point-in-time restore (the free plan's backups are limited — P5-37).
- [ ] Region in the US; encryption at rest (default on Neon / most hosts).
- [ ] The app connects as the restricted `sai_app` role (row-level security on); migrations run as the owner only from the deploy step.
- [ ] The database is marked as the production / pilot database so no seed or reset can ever run on it (pilot mode: `demo:prepare` refuses).

## 3. Getting the data there
- [ ] Re-export from Movegistics on the cut-over day (the import is idempotent: re-running updates, never duplicates).
- [ ] Run the importer **from the CTO's machine against the hosted database once**, deliberately (today it refuses any non-local database — change that guard on purpose, with a review, not by editing `.env`).
- [ ] Re-run the reconciliation against the hosted database; it must match to the cent before managers are told to use it.
- [ ] Decide the gaps: line items (Open API key), the 74 unmatched estimates, 7 partial refunds, Terms & Conditions text.

## 4. Backups and recovery
- [ ] Daily automatic backups kept ≥ 30 days, plus a manual snapshot before each import.
- [ ] One restore rehearsal into a scratch database, timed, before go-live.
- [ ] The raw Movegistics exports stay in `~/Documents/SAI/hhmc-data/` (encrypted disk), never in the repo or a shared drive without access control.

## 5. Privacy
- [ ] Data map: customer names, emails, phones, addresses, move details, payment amounts and card last-4 (no full card numbers are imported or stored).
- [ ] Retention: how long closed moves and customers are kept; archive → permanent delete after the retention window (already enforced by the platform).
- [ ] Access review each semester (student managers change every year).
- [ ] No real data in screenshots, docs, tests, demos or logs (`npm run secret-scan` enforces the repo side).
- [ ] Movegistics' own exports are public files on its storage with guessable names (seen 11 Nov 2026): ask Movegistics to restrict them, and stop exporting from it after cut-over.

## 6. Payments (Stripe live)
- [ ] Stripe account in SAI/HHMC's name; live keys only in the host's secret store, never in `.env` files in the repo.
- [ ] The Stripe adapter today refuses non-test keys on purpose: lifting that is a reviewed code change. *Pilot mode refuses card payments in Live.*
- [ ] Decide what the 4% is (service tax vs card convenience fee — DECISIONS H4) before charging anyone.
- [ ] Refunds and disputes: who handles them, and that every refund is recorded against the payment.

## 7. Email to customers
- [ ] An email provider sending from the HHMC address (SPF/DKIM set up). *Pilot mode forces log-only: nothing reaches customers.*
- [ ] Replace every placeholder template and the Terms & Conditions with HHMC's real wording (Settings › Automatic emails / Documents).
- [ ] Turn on the scheduler for due emails only after the templates are approved.

## 8. Go / no-go
- [ ] Managers run one real week in parallel with Movegistics; numbers compared at the end of the week.
- [ ] The CTO signs off this checklist.
