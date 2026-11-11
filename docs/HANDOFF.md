# Handoff

For whoever takes this project over. Kept up to date at the end of every phase.

## Status

See `docs/PROGRESS.md` for the live status and acceptance criteria.

## Known gaps (things that exist but are unverified or incomplete)

| Gap | Detail | What it takes to close |
|---|---|---|
| Stripe adapter never talked to Stripe | No account or test key exists. The adapter is tested against a fake client only. The mock provider is what runs. | Put a Stripe **test** key (`sk_test_…`) in `.env.local`, set `PAYMENT_PROVIDER=stripe`, take a test payment. |
| No real card form | The BRSS payment form offers two test cards ("approved" and "declined"). Card details must be collected by the card company's own form in the browser, never by ours. | With Stripe test keys in place, add Stripe's card element to `src/modules/brss/pages/forms/payment-form.tsx` and pass its token as `cardToken`. |
| BRSS runs on invented prices and unconfirmed rules | The price list, zones and rates are made up, and twelve business questions were answered conservatively without a BRSS manager. | Work through "Before going live" in `src/modules/brss/README.md`. |
| Only customers can be imported | The import tool works for any entity that declares how, and only the customer entity does. | Add an `import` block to the BRSS order and article entities when the Salesforce export format is known. |
| No crew (field) or customer portal for BRSS | Intake and payment are done in the staff portal, which works on a phone. | Build `portals.field` / `portals.customer` in the BRSS manifest when wanted. |
| Microsoft sign-in never talked to a real directory | Built with the `arctic` library and tested up to the redirect to Microsoft. The pilot (`docs/DEPLOY-DEMO.md`) is its first real use. | Register the app in Entra (steps 6–9 of the deploy guide) and sign in once. |
| Day-before reminder emails | Need a scheduler. Out of scope until hosting is decided. | Add a scheduled job runner when the platform is hosted. |
| Customer and field portals | HHMC has customer pages opened through signed links (`/l/<token>`, `src/core/links`). No module has a signed-in customer or field portal. | How customers sign in to an account is still undecided; links cover one-off review, sign and pay. |
| HHMC automatic emails: daily at best | On the free Vercel plan the scheduler runs once a day, and only where a manager switched it on (P5-20). Otherwise "Run due emails" / `npm run hhmc:automations`. | Call `/api/cron/scheduled` every 15 minutes (paid plan, or any external scheduler with `CRON_SECRET`). |
| Hosted site is a pilot | Pilot mode (`docs/DEPLOY-DEMO.md`, DECISIONS P5-31 …): real data and Microsoft sign-in, but no customer email, no live card payments, files not kept, free plans. A fake-data demo mode also exists. | The list below. |
| HHMC estimate document is HTML, not PDF | No PDF library is approved (DECISIONS A3, P5-5). | Approve a PDF library, render `estimateDocument()` with it. |
| HHMC wording is placeholder | Terms & Conditions and email templates are written fresh, not HHMC's. | A manager replaces them in HHMC → App → Settings → Templates. |
| Email is not sent | The only notification adapter prints to the server console. | Add a real `NotificationChannel` and call `setEmailChannel()`. |
| Session housekeeping | Sessions end after 12 hours; there is no idle timeout and expired rows are never deleted. | A small scheduled clean-up job once hosting exists. |
| Orphaned file bytes | Bytes are removed when a save fails or rolls back, but a crash between writing a file and committing its row could still leave bytes on disk with no row. | A periodic sweep comparing the storage folder with the `files` table. |
| Files are on local disk | `FILE_STORAGE_DIR`. | Add a `FileStorage` adapter for whatever storage hosting provides. |

## Before replacing Movegistics

The pilot is deliberately not live. Each of these needs a decision, and most need an account:

1. **Email service.** Choose one (for example Postmark, Resend, Microsoft 365 via Graph), add a
   `NotificationChannel` adapter, and stop forcing the log-only channel in pilot mode.
2. **Card processor.** Choose one (Stripe has an adapter already, which refuses live keys on
   purpose); add the processor's own card form in the browser, review, and allow live keys.
3. **File storage** for signed estimate documents (a `FileStorage` adapter; Vercel's disk is
   temporary).
4. **Paid hosting and backups:** Vercel Pro (commercial use) and a Neon plan with point-in-time
   restore, and someone who checks a restore once.
5. **HHMC's real wording:** terms and conditions and email templates (now PLACEHOLDER).
6. **The open business questions:** DECISIONS H1–H14, P5-5 … P5-37, especially the 4% and
   service tax.
7. **Import** of the open Movegistics jobs and customers (only customers can be imported today),
   then switch off `PILOT_MODE`.
8. **The automatic-email scheduler** turned on (P5-20), preferably every 15 minutes on a paid plan.

## Upgrading notes

- **Next.js:** "Cache Components" is off (DECISIONS R-8). Next.js says it becomes the only mode
  in the next major version. When upgrading, read `node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md`.
- **Drizzle:** pinned to the stable 0.45 line. 1.0 was a release candidate in Nov 2026. Upgrade only once it is final, and re-run every test.
- Versions are pinned exactly in `package.json`. Upgrade one dependency at a time.

## Things only a person can do

- Register the app in Microsoft Entra (sign-in provider: Microsoft 365, chosen 11 Nov 2026).
- Decide paid hosting, the email service and the card processor ("Before replacing Movegistics").
- Review the items marked **NEEDS JAI REVIEW** in `docs/DECISIONS.md`.
- Sit down with a BRSS manager over `src/modules/brss/OPEN_QUESTIONS.md` (83 questions the old code cannot answer).
- Supply the real BRSS price list, zip zones and shipping rates.
- Sit down with an HHMC manager over DECISIONS H1–H14 and P5-5 … P5-14, and replace HHMC's placeholder terms and emails.
