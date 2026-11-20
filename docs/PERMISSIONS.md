# Permissions: the role × action matrix

> **Generated file — do not edit by hand.** It is built from `src/core/rbac/actions.ts` (and each
> module's `permissions`) by `npm run docs:permissions`. A test fails if this file does not match
> the code, so what you read here is what the server enforces.

## Roles

- **Super admin** (`super_admin`): The CTO. Everything, including permanent deletion and platform settings.
- **Tech team** (`tech`): Builds and tests in every module and manages module settings. Cannot permanently delete or change platform settings.
- **Executive** (`executive`): Read-only overview and analytics across every business.
- **Business admin** (`business_admin`): Full day-to-day use of their own business. Manages their own staff. Cannot permanently delete.
- **Business staff** (`business_staff`): Day-to-day use of their own business, limited to what a business admin grants.

The first three are *platform roles*: they apply to every business. The last two are *business
roles*: a person holds one per business they are assigned to. A person has either a platform role
or business roles, never both.

## How to read the tables

| Symbol | Meaning |
|:-:|---|
| ✅ | Always allowed |
| 🔑 | Off by default. A business admin can switch it on for an individual staff member (People and access) |
| — | Never allowed |

"Type" is `read` or `write`. Executives hold no `write` action anywhere.

## Platform actions

These are not tied to one business. Business roles never hold them.

| Action | Key | Type | Super admin | Tech team | Executive | Business admin | Business staff |
|---|---|---|:-:|:-:|:-:|:-:|:-:|
| See the cross-business executive dashboard | `executive.dashboard.read` | read | ✅ | ✅ | ✅ | — | — |
| See all users and their roles | `platform.users.read` | read | ✅ | ✅ | — | — | — |
| Create users and assign business roles | `platform.users.manage` | write | ✅ | ✅ | — | — | — |
| Grant or remove super_admin, tech and executive | `platform.roles.grant` | write | ✅ | — | — | — | — |
| See the module registry | `platform.modules.read` | read | ✅ | ✅ | — | — | — |
| See feature flags | `platform.flags.read` | read | ✅ | ✅ | — | — | — |
| Change feature flags | `platform.flags.write` | write | ✅ | ✅ | — | — | — |
| See the global activity log | `platform.activity.read` | read | ✅ | ✅ | — | — | — |
| See data imports | `platform.imports.read` | read | ✅ | ✅ | — | — | — |
| Import a file into a sandbox | `platform.imports.run` | write | ✅ | ✅ | — | — | — |
| Import a checked file into live data | `platform.imports.run_live` | write | ✅ | ✅ | — | — | — |
| See system health | `platform.health.read` | read | ✅ | ✅ | — | — | — |
| Read the feedback people sent from the apps | `platform.feedback.read` | read | ✅ | ✅ | — | — | — |
| See platform settings | `platform.settings.read` | read | ✅ | ✅ | — | — | — |
| Change platform settings (e.g. retention window) | `platform.settings.write` | write | ✅ | — | — | — | — |

## Actions inside a business

Checked per business. A business admin or staff member holds them **only in their own business**;
in any other business they hold nothing and the business does not appear to exist.

| Action | Key | Type | Super admin | Tech team | Executive | Business admin | Business staff |
|---|---|---|:-:|:-:|:-:|:-:|:-:|
| See the business overview | `business.overview.read` | read | ✅ | ✅ | ✅ | ✅ | ✅ |
| Open the staff portal | `business.app.use` | read | ✅ | ✅ | — | ✅ | ✅ |
| Send feedback about the app (Send feedback button) | `business.feedback.send` | write | ✅ | ✅ | — | ✅ | ✅ |
| Read this business's app feedback | `business.feedback.read` | read | ✅ | ✅ | — | — | — |
| See who has access | `business.people.read` | read | ✅ | ✅ | — | ✅ | — |
| Add people, change roles and staff permissions | `business.people.manage` | write | ✅ | ✅ | — | ✅ | — |
| Browse records in the Data tab | `business.data.read` | read | ✅ | ✅ | ✅ | ✅ | 🔑 |
| Export records to CSV | `business.data.export` | read | ✅ | ✅ | — | ✅ | 🔑 |
| Permanently delete archived records past retention | `business.data.purge` | write | ✅ | — | — | — | — |
| See the business's activity log (staff: only entries about records they may read) | `business.activity.read` | read | ✅ | ✅ | ✅ | ✅ | 🔑 |
| See module settings | `business.settings.read` | read | ✅ | ✅ | — | ✅ | — |
| Change module settings (business admins too, where the module runs its admin inside the app) | `business.settings.write` | write | ✅ | ✅ | — | — | — |
| Switch portals on and off | `business.portals.write` | write | ✅ | ✅ | — | — | — |
| Use test mode (sandbox data) | `business.sandbox.use` | read | ✅ | ✅ | — | ✅ | 🔑 |
| Reset the sandbox to fresh fake data | `business.sandbox.reset` | write | ✅ | ✅ | — | ✅ | — |
| See customers | `customers.read` | read | ✅ | ✅ | ✅ | ✅ | 🔑 |
| Add, edit, archive and restore customers | `customers.write` | write | ✅ | ✅ | — | ✅ | 🔑 |
| See payments and refunds | `payments.read` | read | ✅ | ✅ | ✅ | ✅ | 🔑 |
| Take payments and issue refunds | `payments.write` | write | ✅ | ✅ | — | ✅ | 🔑 |
| See appointments, resources and unavailability | `scheduling.read` | read | ✅ | ✅ | ✅ | ✅ | 🔑 |
| Add and change appointments, resources and unavailability | `scheduling.write` | write | ✅ | ✅ | — | ✅ | 🔑 |
| See sent notifications | `notifications.read` | read | ✅ | ✅ | ✅ | ✅ | 🔑 |
| Send notifications | `notifications.write` | write | ✅ | ✅ | — | ✅ | 🔑 |
| See and download files | `files.read` | read | ✅ | ✅ | ✅ | ✅ | 🔑 |
| Upload and archive files | `files.write` | write | ✅ | ✅ | — | ✅ | 🔑 |
| See import runs for this business | `imports.read` | read | ✅ | ✅ | — | — | — |
| Run imports for this business | `imports.write` | write | ✅ | ✅ | — | — | — |

New staff members start with: `customers.read`, `scheduling.read`, plus their module's defaults.

## Module actions

Every module permission follows one of two standard rows: a `read` permission is ✅ for super admin,
tech, executive and business admin and 🔑 for staff; a `write` permission is the same except — for executive.

### Hired Hands Moving Company (`hhmc`)

| Action | Key | Type | Super admin | Tech team | Executive | Business admin | Business staff |
|---|---|---|:-:|:-:|:-:|:-:|:-:|
| See leads *(on by default for new staff)* | `hhmc.leads.read` | read | ✅ | ✅ | ✅ | ✅ | 🔑 |
| Add and change leads, disqualify and convert them *(on by default for new staff)* | `hhmc.leads.write` | write | ✅ | ✅ | — | ✅ | 🔑 |
| See jobs, quotes, estimates and job days *(on by default for new staff)* | `hhmc.jobs.read` | read | ✅ | ✅ | ✅ | ✅ | 🔑 |
| Change jobs: details, quote, job days, notes, calls, stage *(on by default for new staff)* | `hhmc.jobs.write` | write | ✅ | ✅ | — | ✅ | 🔑 |
| Book a job and release a booking | `hhmc.jobs.book` | write | ✅ | ✅ | — | ✅ | 🔑 |
| Send, resend and void estimates *(on by default for new staff)* | `hhmc.estimates.write` | write | ✅ | ✅ | — | ✅ | 🔑 |
| See invoices *(on by default for new staff)* | `hhmc.invoices.read` | read | ✅ | ✅ | ✅ | ✅ | 🔑 |
| Create, send and void invoices | `hhmc.invoices.write` | write | ✅ | ✅ | — | ✅ | 🔑 |
| See the price catalog, discounts, templates and automation rules *(on by default for new staff)* | `hhmc.catalog.read` | read | ✅ | ✅ | ✅ | ✅ | 🔑 |
| Change the price catalog, discounts, templates and automation rules | `hhmc.catalog.write` | write | ✅ | ✅ | — | ✅ | 🔑 |
| Send due automation emails now (tech team only; no scheduler yet) | `hhmc.automations.run` | write | ✅ | ✅ | — | ✅ | 🔑 |
| Import records from Movegistics (tech team; command line only) | `hhmc.import.run` | write | ✅ | ✅ | — | ✅ | 🔑 |
| Customer link only: review, sign and pay the deposit on one estimate | `hhmc.customer.estimate` | write | ✅ | ✅ | — | ✅ | 🔑 |
| Customer link only: pay one invoice | `hhmc.customer.invoice` | write | ✅ | ✅ | — | ✅ | 🔑 |

### Big Red Shipping & Storage (`brss`)

| Action | Key | Type | Super admin | Tech team | Executive | Business admin | Business staff |
|---|---|---|:-:|:-:|:-:|:-:|:-:|
| See orders *(on by default for new staff)* | `brss.orders.read` | read | ✅ | ✅ | ✅ | ✅ | 🔑 |
| Process orders: create and change orders, take in articles, add charges, change order status | `brss.orders.write` | write | ✅ | ✅ | — | ✅ | 🔑 |
| Give a discount above the staff limit | `brss.orders.discount_any` | write | ✅ | ✅ | — | ✅ | 🔑 |
| See articles (boxes and items) *(on by default for new staff)* | `brss.articles.read` | read | ✅ | ✅ | ✅ | ✅ | 🔑 |
| Change an article's details, status and warehouse location *(on by default for new staff)* | `brss.articles.write` | write | ✅ | ✅ | — | ✅ | 🔑 |
| Book an appointment at a blocked time or at short notice | `brss.appointments.override` | write | ✅ | ✅ | — | ✅ | 🔑 |
| See prices, storage terms, zones, buildings and warehouses *(on by default for new staff)* | `brss.catalog.read` | read | ✅ | ✅ | ✅ | ✅ | 🔑 |
| Change prices, storage terms, zones, buildings and warehouses | `brss.catalog.write` | write | ✅ | ✅ | — | ✅ | 🔑 |

## Rules that are not a single cell

These are enforced in code and each has a test (file in brackets).

| Rule | Where it is tested |
|---|---|
| A business admin or staff member cannot open, read or write another business — through the context, the record functions, or a raw database query | `tests/integration/tenant-isolation.test.ts` |
| A record can only link to records of the same business and the same environment (the database refuses anything else), and links never cascade a delete | `tests/integration/tenant-isolation.test.ts` |
| Permission is checked before any payment, refund, file write or email leaves the platform | `tests/integration/hardening.test.ts` |
| The same payment request is never charged twice, and refunds can never exceed what was paid, even when requests arrive at the same moment | `tests/integration/hardening.test.ts` |
| Live and sandbox data cannot see or change each other | `tests/integration/tenant-isolation.test.ts` |
| Executives cannot write anything, in any business or on the platform | `tests/integration/permissions.test.ts` |
| "Delete" archives (recoverable). Permanent delete needs super admin **and** the record archived longer than the retention window (default 30 days, configurable by super admin only) | `tests/integration/retention.test.ts` |
| Every create, update, archive, restore, permanent delete, permission change, settings change and sign-in writes an activity log entry in the same transaction; the log cannot be edited or deleted | `tests/integration/audit.test.ts` |
| Only super admin can grant or remove platform roles, or deactivate a platform-role account | `tests/integration/permissions.test.ts` |
| The last super admin cannot be demoted or deactivated; a business always keeps one usable admin (also when an account is deactivated, and when two removals happen at once) | `tests/integration/permissions.test.ts`, `tests/integration/hardening.test.ts` |
| A person with business roles cannot be given a platform role, and the reverse | `tests/integration/permissions.test.ts` |
| Staff can only be granted actions marked 🔑 | `tests/integration/permissions.test.ts` |
| Every page, export and portal URL of another business — and the Platform section and executive view for business roles — answers "not found" | `tests/e2e/isolation.spec.ts` |
| Each role sees exactly its own navigation, tabs and actions in the console | `tests/e2e/console.spec.ts` |
| A file is imported into a sandbox first; importing into live needs a successful sandbox run of the same file and mapping, and happens once | `tests/integration/console-services.test.ts` |
| Using test mode (sandbox) needs `business.sandbox.use`; the sandbox always uses the mock payment provider | `tests/integration/permissions.test.ts`, `tests/integration/services.test.ts` |
