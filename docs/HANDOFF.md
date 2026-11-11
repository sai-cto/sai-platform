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
| Microsoft / Google sign-in never talked to a real directory | Built with the `arctic` library and tested up to the redirect URL. | Register an app in Entra ID or Google Cloud, fill in the variables in `.env.local`, sign in once. |
| Day-before reminder emails | Need a scheduler. Out of scope until hosting is decided. | Add a scheduled job runner when the platform is hosted. |
| Customer and field portals | HHMC has customer pages opened through signed links (`/l/<token>`, `src/core/links`). No module has a signed-in customer or field portal. | How customers sign in to an account is still undecided; links cover one-off review, sign and pay. |
| HHMC automatic emails: daily at best | On the free Vercel plan the scheduler runs once a day, and only where a manager switched it on (P5-20). Otherwise "Run due emails" / `npm run hhmc:automations`. | Call `/api/cron/scheduled` every 15 minutes (paid plan, or any external scheduler with `CRON_SECRET`). |
| Hosted test site | Demo mode only (`docs/DEPLOY-DEMO.md`): fake data, shared password, demo accounts. Not a production setup: files are not kept, and emails and payments are fake. | Decide real hosting, sign-in provider, email and card processor. |
| HHMC estimate document is HTML, not PDF | No PDF library is approved (DECISIONS A3, P5-5). | Approve a PDF library, render `estimateDocument()` with it. |
| HHMC wording is placeholder | Terms & Conditions and email templates are written fresh, not HHMC's. | A manager replaces them in HHMC → App → Settings → Templates. |
| Email is not sent | The only notification adapter prints to the server console. | Add a real `NotificationChannel` and call `setEmailChannel()`. |
| Session housekeeping | Sessions end after 12 hours; there is no idle timeout and expired rows are never deleted. | A small scheduled clean-up job once hosting exists. |
| Orphaned file bytes | Bytes are removed when a save fails or rolls back, but a crash between writing a file and committing its row could still leave bytes on disk with no row. | A periodic sweep comparing the storage folder with the `files` table. |
| Files are on local disk | `FILE_STORAGE_DIR`. | Add a `FileStorage` adapter for whatever storage hosting provides. |

## Upgrading notes

- **Next.js:** "Cache Components" is off (DECISIONS R-8). Next.js says it becomes the only mode
  in the next major version. When upgrading, read `node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md`.
- **Drizzle:** pinned to the stable 0.45 line. 1.0 was a release candidate in Nov 2026. Upgrade only once it is final, and re-run every test.
- Versions are pinned exactly in `package.json`. Upgrade one dependency at a time.

## Things only a person can do

- Decide the company's sign-in provider (Microsoft 365 or Google Workspace).
- Decide hosting.
- Review the items marked **NEEDS JAI REVIEW** in `docs/DECISIONS.md`.
- Sit down with a BRSS manager over `src/modules/brss/OPEN_QUESTIONS.md` (83 questions the old code cannot answer).
- Supply the real BRSS price list, zip zones and shipping rates.
- Sit down with an HHMC manager over DECISIONS H1–H14 and P5-5 … P5-14, and replace HHMC's placeholder terms and emails.
