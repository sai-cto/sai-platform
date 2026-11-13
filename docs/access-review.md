# Access review: who can see HHMC customer data

Last reviewed: 2026-11-13, for the HHMC pilot. Source of truth: `src/core/rbac/actions.ts` and the
HHMC module's permissions. The full matrix is generated in [PERMISSIONS.md](PERMISSIONS.md), and a
test fails if the two disagree. Review this page before each new person is given access, and
at least once a quarter.

"Customer data" here means names, phone numbers, emails, addresses, move details, estimates,
invoices and payments of HHMC's customers (live mode). Test mode holds made-up data only.

## By role

| Role | Who holds it | Sees HHMC customer data? | Can change it? | Notes |
|---|---|---|---|---|
| Super admin | The CTO | Yes, every business | Yes | Only role that can permanently delete (after 30 days archived) or grant platform roles. Can "act as" another person; every such session is logged and shows a banner. |
| Tech team | Platform engineers | Yes, every business | Yes | Needed to support and fix the app. Reads feedback and the server error log. |
| Executive | SAI leadership | Yes, read-only, every business | No | Cannot open the staff app or export; sees the overview, Data tab and activity log. |
| Business admin (HHMC) | HHMC managers | Yes, HHMC only | Yes | Manages HHMC's own people. Cannot see any other business: its pages answer "not found". |
| Business staff (HHMC) | HHMC office staff | Only what an admin grants | Only what an admin grants | New staff start with: see customers, scheduling, leads, jobs, invoices, catalog; change leads, jobs and estimates. Export, payments, booking and invoicing are off until an admin switches them on. |
| Customer link | An HHMC customer, no account | Their own one estimate or invoice | Sign / pay that one item | Signed link, expires; cannot reach anything else. |
| Anyone else | | No | No | Every console page needs a signed-in account. Other businesses' admins and staff see nothing of HHMC. |

## Sensitive actions

| Action | Who | Logged |
|---|---|---|
| Export records to CSV | Super admin, tech, HHMC admin; staff only if granted | Yes |
| Take payments / issue refunds | Super admin, tech, HHMC admin; staff only if granted | Yes |
| Import from Movegistics | Tech team, command line only | Yes (system entries, in the Import log) |
| Permanently delete | Super admin only, after the retention window | Yes |
| Change who has access | Super admin, tech, HHMC admin (own business) | Yes |
| Act as another person | Super admin only | Yes, with banner |

## How access is enforced

- Every database query runs as the `sai_app` role with row-level security: a session only sees rows
  of the business and mode (live or test) it opened (`tests/integration/tenant-isolation.test.ts`).
- Every service checks the permission before reading or writing (`tests/integration/permissions.test.ts`).
- Sessions end 12 hours after sign-in, or after 8 hours without use, and on sign-out; deactivating
  a person ends all their sessions at once (`tests/integration/auth.test.ts`).
- Server error logs drop query parameters and search terms so customer data does not end up there.

## Checklist for each review

1. Console › People and access (HHMC): every person listed still works at HHMC and has the right role.
2. Platform › Users: platform roles (super admin, tech, executive) are only the people who need them.
3. Staff grants: nobody has export or payments switched on without a reason.
4. Activity log, "Who: People": no sign-ins or exports you cannot explain.
