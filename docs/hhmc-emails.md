# HHMC automatic emails

Every email Hired Hands Moving Company (HHMC) sent automatically from Movegistics, and what SAI
does instead. Movegistics' settings were read on 2026-11-20, without changing anything. The
wording is HHMC's own, copied into SAI by the Movegistics importer (`scripts/hhmc-import/settings-docs.ts`,
`settings-pricing.ts`). Merge fields are mapped to SAI's (for example `{{contact.firstName}}` becomes `{{firstName}}`).
Managers can change any template or rule in **Settings › Templates / Automations**, and the importer
never overwrites their changes.

## Automatic emails (rules)

Delays count from the trigger. Each email is queued once per job (or lead) and sent once, even
if its event happens again or two schedulers run at the same moment (`hhmc_queue_dedupe`, and the
row lock in `processRow`). The scheduler runs every 15 minutes.

| Email (template) | Subject | Trigger in SAI | When | Opt-in | Status |
| --- | --- | --- | --- | --- | --- |
| Sorry we missed you (`lead_sorry`) | Sorry we missed you, {{firstName}}! | Staff press **Couldn't reach** on a lead. In Movegistics, staff added the tag "Awaiting Response". | At once | No | Copied |
| Didn't Connect Yet (`lead_didnt_connect`) | Still hoping to help, {{firstName}} | Same. In Movegistics, the tag "Over 24hrs". | 24 hours | No | Copied |
| Last check-in on your move (`lead_last_checkin`) | Last check-in on your move, {{firstName}} | Same. In Movegistics, the tag "Over 3 days". | 2 days | No | Copied |
| Same Day (`drip_same_day`) | {{firstName}}, Your Hired Hands Estimate is Ready | Estimate sent | 2 hours | Yes | Copied |
| Is the price giving you pause? – Day 2 (`drip_day2`) | Is the price giving you pause? | Estimate sent | 1 day | Yes | Copied |
| Quick note on your move date – Day 3 (`drip_day3`) | Quick note on your move date | Estimate sent | 3 days | Yes | Copied |
| Still thinking it over? – Day 7 (`drip_day7`) | Still thinking it over? | Estimate sent | 7 days | Yes | Copied |
| Payment Receipt (`payment_receipt`) | Payment Receipt | Payment received (online or recorded) | At once | No | Copied |
| Past due invoice (`past_due`) | Invoice reminder - Hired Hands Moving | Invoice sent | 8 days (only if the invoice is past its due date by then) | No | Copied |
| How did your move go? (`review_request`) | How did your move go, {{firstName}}? | Invoice paid in full | At once | Yes | Copied |
| You're Booked! (`booked`) | You're Booked! Here's what to expect, {{firstName}} | Move booked (confirmed) | At once | No | **New in SAI.** This is HHMC's own template, which Movegistics had but never sent automatically. |
| Move reminder (`move_reminder`) | Your move is coming up, {{firstName}} | Move booked | 2 days before the first move day's start time | No | **New in SAI.** Movegistics had no reminder; the wording is SAI's, in HHMC's style. |

The **drip** emails stop when the job leaves Estimate Sent, the estimate expires, or the job's
"automation opt-in" is switched off. The **lead** emails stop when the lead is converted or
disqualified.

**Booking changes:**
- **Rescheduling** a move cancels its queued reminders and queues them again for the new date.
- **Unconfirming or releasing** a booking cancels the booking email and the reminders.
- **Cancelling a job** cancels every queued email of that job.

## Emails sent at once by an action (no rule)

| Email (template) | Subject | Sent when | Status |
| --- | --- | --- | --- |
| Sent Estimate Template (`estimate_email`) | Please Review: {{estimateTitle}} | Staff send an estimate | Copied (Movegistics' system template; the "Powered by Movegistics" footer is removed) |
| Post-Signature Estimate Template (`estimate_signed`) | Estimate #{{estimateNumber}} has been signed by you. | The customer signs | Copied. The "attached final copy" line is removed, because the link shows the signed estimate. |
| ACTIVE Invoice Send (`invoice_email`) | Your Invoice: {{invoiceNumber}} from {{businessName}} | Staff send an invoice | Copied |

## Not copied, and why

- **Lead Nurturing: Welcome New Lead:** switched **off** in Movegistics, and it never sent (fired 0 times).
  - Its wording, "Welcome {{firstName}}! Here's What to Expect for Your Move", is kept in the export for when HHMC wants it.
- **Staff notices** go to HHMC staff, not customers:
  - estimate viewed, signed, and acknowledgement to the owner;
  - invoice copy to the owner;
  - crew assignment and availability;
  - claims;
  - task assigned.

  SAI shows these events in the app instead.
- **Crew App ETA, bill of lading, surveys and on-site/virtual appointment emails:** these belong to Movegistics features SAI does not use, such as the crew app, surveys and LiveSwitch.
- **Invoice Reminder** (Movegistics template): no automation sends it. Past due invoice covers the same need.
- **Text messages:** Movegistics' 43 SMS templates were never sent, because no texting number was set up.
- **Tag automations** (Estimate Provided, Closed, Lead Qualified): these add tags and send nothing.

## Sending

Email goes through **Amazon SES** (us-east-1) from `Hired Hands Moving <hiredhands@studentagencies.com>`.
The console service has these settings (see docs/aws.md):
- `EMAIL_PROVIDER=ses`
- `EMAIL_FROM`
- `EMAIL_ALLOWED_RECIPIENTS`

The task role may send only from that address.

**Until the owner approves emailing customers,** `EMAIL_ALLOWED_RECIPIENTS` lists the only
addresses that get real email: only the owner's own test address.
- Every other email is **held**: it is written to the log and not sent, in Live and Test mode alike.
- Each job's **Emails** card lists every email with its recipient and whether it was emailed, held or failed.
- To go live, remove `EMAIL_ALLOWED_RECIPIENTS` from `.env.aws`, run `scripts/aws/console-service.sh`, and switch on **Settings › Send due automatic emails on a schedule** for HHMC Live.

### DNS records (studentagencies.com, hosted at NS1)

Add these records, then SES verifies the domain by itself within about an hour.

| Type | Name | Value | Why |
| --- | --- | --- | --- |
| CNAME | `xr6liavutwzn3s2gu3xcbyii2hc5zhok._domainkey.studentagencies.com` | `xr6liavutwzn3s2gu3xcbyii2hc5zhok.dkim.amazonses.com` | DKIM signature |
| CNAME | `ygm4kxbbf27l3pfummxqky2uonsrqi7z._domainkey.studentagencies.com` | `ygm4kxbbf27l3pfummxqky2uonsrqi7z.dkim.amazonses.com` | DKIM signature |
| CNAME | `xxzz6sajkprra3ju3s3aveozuw54tla4._domainkey.studentagencies.com` | `xxzz6sajkprra3ju3s3aveozuw54tla4.dkim.amazonses.com` | DKIM signature |
| MX | `ses.studentagencies.com` | `10 feedback-smtp.us-east-1.amazonses.com` | Bounces (custom MAIL FROM) |
| TXT | `ses.studentagencies.com` | `"v=spf1 include:amazonses.com ~all"` | SPF for the MAIL FROM domain |

The existing SPF record on `studentagencies.com` (Outlook, Brevo, Zoho, Salesforce) and DMARC
stay as they are: SES mail passes DMARC through DKIM.

**Production access:** requested on 2026-11-20 for transactional email. While SES is in its
sandbox, it delivers only to verified addresses (the owner's test address, once its verification
link has been clicked).
