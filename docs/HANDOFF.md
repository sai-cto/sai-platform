# Handoff

For whoever takes this project over. Kept up to date at the end of every phase.

## Status

See `docs/PROGRESS.md` for the live status and acceptance criteria.

## Known gaps (things that exist but are unverified or incomplete)

| Gap | Detail | What it takes to close |
|---|---|---|
| Stripe adapter never talked to Stripe | No account or test key exists. The adapter is tested against a fake client only. The mock provider is what runs. | Put a Stripe **test** key (`sk_test_…`) in `.env.local`, set `PAYMENT_PROVIDER=stripe`, take a test payment. |
| Microsoft / Google sign-in never talked to a real directory | Built with the `arctic` library and tested up to the redirect URL. | Register an app in Entra ID or Google Cloud, fill in the variables in `.env.local`, sign in once. |
| Day-before reminder emails | Need a scheduler. Out of scope until hosting is decided. | Add a scheduled job runner when the platform is hosted. |
| Customer and field portals | Hosting routes exist and answer "not found". No module defines one. | Add `portals.customer` / `portals.field` to a module manifest and switch the toggle on. How customers sign in is undecided. |
| Email is not sent | The only notification adapter prints to the server console. | Add a real `NotificationChannel` and call `setEmailChannel()`. |
| Session housekeeping | Sessions end after 12 hours; there is no idle timeout and expired rows are never deleted. | A small scheduled clean-up job once hosting exists. |
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
