# Movegistics Reference: How HHMC Uses It

**Purpose:** a workflow reference for rebuilding Hired Hands Moving Company's (HHMC) process in Student Agencies' own software. It describes what each part does, the fields, the statuses and the rules. It does not describe how anything looks.

**How this was gathered:** read-only walkthrough of the staff side of `go.movegistics.com` under the shared "Hired Hands" Super Admin account on 2026-11-10, plus one customer estimate link. Volumes quoted ("1,395 work requests") are what the list pages showed that day. No customer data is included. Customers appear as `[customer]`.

**Legend:** **[unverified]** = seen indirectly, inferred, or could not be opened read-only. **UNUSED** = no or almost no data, or set up but never configured. **DUP** = duplicates something else.

---

## 1. Sitemap

```
Top bar (every page)
├── + (global create): Add Lead · Add Contact · Add Company · Add Work Request · Add Estimate · Add Invoice · Add Work Order · Add Event
├── Global search
├── Shortcut icons: Calendar, Daily Job Chart, "WO" crew check-in, AI assistant, Notifications, Messages [unverified: icons not opened]
├── Settings (gear) → see Settings tree below
├── Profile / Help
└── Support chat bubble (bottom-left)

Sidebar
├── Dashboard                         /dashboard  (tabs: Overview · Sales · Leader Board)
├── Sales
│   ├── Work Requests                 /sales/opportunity      → detail /sales/opportunity/details/{id}
│   │                                                          → pricing editor "Edit Move Pricing"
│   ├── Contacts                      /sales/contact
│   ├── Companies                     /sales/account
│   ├── Leads                         /sales/lead
│   ├── Surveys                       /sales/survey           (Manual Survey · AI Survey)
│   ├── Estimates                     /sales/quotes           → PDF view, customer link
│   ├── Follow Ups                    /sales/followup
│   ├── Pipelines                     /sales/pipeline         (Storage · Billing · Sales · Claims · Long Distance · Contacts)
│   └── Reports                       /sales/reports          (20 canned reports)
├── Operations   (the same 13 items are repeated as a tab strip across the top of every Operations page)
│   ├── Work Orders                   /operations/workorder   → detail /operations/schedule/detail/{id}
│   ├── BOL                           /operations/bol
│   ├── Confirm                       /operations/confirmation
│   ├── Assign                        /operations/dispatch    (note: URL says "dispatch")
│   ├── Dispatch                      /operations/publish     (note: URL says "publish")
│   ├── Manage Trips                  /operations/trips
│   ├── Claims                        /operations/claims
│   ├── Availability                  /operations/overview
│   ├── Weekly Schedule               /operations/forecast
│   ├── Monthly Schedule              /operations/schedule/calendar
│   ├── Pipelines                     /operations/pipelines
│   ├── Crew Tracking                 /operations/trucktracking
│   └── Reports                       /operations/reports     (18 canned reports)
├── Daily Job Chart                   /daily_job_chart
├── Invoices                          /invoices               → invoice editor (drawer)
├── Payments                          /payments               → New Payment: Request · Apply · Receive
├── Events                            /calendar/office
├── Tasks                             /task
├── Conversations
│   ├── Email                         /conversations/email    (Inboxes · Filtering Rule · Signature)
│   └── Texting                       /conversations/texting  (Dashboard · Phone Numbers)
├── Documents                         /document               (auto-filed folders)
└── Sent Items                        /sent_items

Settings (/settings/…)
├── Profile · Organization (Organization · Global Settings · Email/AWS Verification · Provider Key · Reorder Tabs · Resource Sharing)
├── Locations · Users (Users · Permissions) · Dashboard · General · Tags · Commissions
├── Resources: Workers · Contractors · Vehicles · Tools · Equipment
├── Pricing: Categories · Multipliers · Packing · Rate Tables · Tariffs · Travel Charges · Valuation
├── Sales: Estimates · Lead Assignment · Surveys · Pipelines · Follow Ups · Notes · Templates
├── Crew App: General · Crew Activities · Crew Templates · Checklist
├── Work Order: Expenses · BOL (templates) · OT Charges
├── Claims: Chargeback Types · Damage Types · Denial Reasons · Settlement Types
├── Trip: General
├── Payments · Calendars
├── Conversations: Email · SMS/Texting · Templates
├── Automations · Task Templates · Invoices
├── Integrations: QuickBooks · Mailchimp · Open API
├── Marketing: Third Party Lead · HomeAdvisor · TPL with Survey · Forms
└── Objects · Fields

Customer-facing (no login, tokenized link in email)
├── Estimate review   /estimate/review/{estimateId}?token=…   4 steps: Summary → Detail Estimate Preview → E-Sign → Final Confirmation
├── Deposit payment   (from "Pay Deposit" on the Final Confirmation step) [unverified: not opened]
├── Estimate PDF      (Download Estimate PDF, stored on S3)
└── Invoice payment link (invoice option "Generate Payment Link") [unverified: not opened]
```

---

## 2. Job lifecycle (statuses and transitions)

A move is spread across six linked records: **Lead → Work Request (WR) → Estimate → Work Order (WO) + Bill of Lading (BOL) → Invoice → Payment**. Each one has its own status. The WR also sits in a **pipeline stage**, and automation adds **tags** that repeat those stages.

### 2.1 What HHMC does in practice

| # | Step | Record and status change | Who or what triggers it |
|---|------|------------------------------|-------------------|
| 1 | Inquiry arrives | **Lead** created (status `New`). Sources: website form or Lead API, manual entry, third-party lead feeds | Web form / staff |
| 2 | Lead qualified | Lead converted to a **Work Request**. The automation adds tag `Lead Qualified` (trigger: "Lead converted to Work Request"). Sales pipeline stage = `Lead Qualified` | Staff |
| 2b | Lead not pursued | Lead status → `Disqualified` (with Disqualified Reason and Date). Lead automations send "Sorry we missed you", "Didn't connect yet" and "Last check-in" emails | Staff + automation |
| 3 | Price the move | Staff fill in **Move Pricing** on the WR (line items) and click **Create Estimate** | Staff |
| 4 | Send estimate | **Estimate** `Draft → Sent`. Email "Please Sign: [estimate title]" carries the tokenized link. WR stage → `Estimate Provided`, tag `Estimate Provided` added. A PDF is filed in Documents › Estimates | Staff |
| 5 | Follow-up drip | Emails at +2 h ("Same Day"), +1 day ("Is the price giving you pause?"), +3 days ("Quick note on your move date"), +7 days ("Still thinking it over?") | Automation (stage change) |
| 6 | Customer opens link | Estimate `Sent → Viewed`. Staff get a pop-up notice "Estimate … viewed by [customer]" | Customer |
| 7 | Customer signs | Estimate `Viewed → Signed` (e-signature, initials per section). Customer gets "Estimate #… has been signed by you" with the final PDF | Customer |
| 8 | Deposit | The customer pays a 20% deposit on the Final Confirmation step. A **Payment** is created (`Successful`, `Unapplied`) and a "Payment Receipt" email goes out | Customer |
| 9 | Book | Staff click **Book This Move** on the WR. WR shows `Booked · Signed`, stage `Closed Won`, tag `Closed`, Actual Close Date set. A **Work Order** is created (WO status `New`, Ops pipeline `Booked`) and a **BOL** (`Pre Move`, `Created`) is attached. The button then reads **Release Booking** (undo) | Staff [unverified whether booking also happens automatically] |
| 10 | Schedule / crew | The WO is synced to the **Crew App** (notices: "Crew portal updated", "crew members notified by email", "WO synced to Crew App"). In practice no crew, trucks or teams are assigned in Movegistics (see §6) | Staff / system |
| 11 | Job day | The crew works through the Crew App: time per activity, BOL confirmation, tips, "Pay Now" [unverified: Crew App not observed directly] | Crew |
| 12 | Invoice | **Invoice** created with actual hours, then `Sent`. Deposit is subtracted automatically. Past-due reminder fires 8 days after an invoice is sent | Staff / automation |
| 13 | Paid | Invoice `Partially Paid → Paid`. The "How did your move go?" email (with a Google review request) goes out when the invoice is paid in full | Customer / automation |
| 14 | Cancel | Ops pipeline `Cancelled Out`, WO status `Cancelled` | Staff |

**Not used:** WO statuses after `New`. Every past work order checked was still `New`, and the WO Status control on the WO page is greyed out. The Daily Job Chart's `Confirmed / In Progress / Dispatched / Completed` columns were empty on past job dates. Ops pipeline stages after `Booked` are also unused (8 Booked, 0 in later stages in Nov 2026).

### 2.2 Status lists by record

| Record | Status values seen |
|---|---|
| Lead | `New`, `Disqualified` |
| WR – Sales pipeline stage | `Lead Qualified` → `Survey Scheduled` → `Estimate Provided` → `Negotiation in Progress` → `Closed Won` / `Closed Lost`. Only Estimate Provided and Closed Won hold any jobs |
| WR – booking flag | `Booked`, `Signed` badges on the WR title |
| WR – rating | `Hot`, `Warm`, `Cold` |
| Estimate | `Draft`, `Sent`, `Viewed`, `Signed`, `Void` (list also flags `Booked`) |
| Work Order (status) | `New`, `Confirmed`, `In Progress`, `Dispatched`, `Completed`, `Cancelled` |
| Work Order – Ops pipeline | `Booked` (20%) → `Truck(s) Assigned` (40%) → `Customer Confirmed` (60%) → `Published` (60%) → `Job Started` (80%) → `Closed Out` (Won) / `Cancelled Out` (Lost) |
| WO – customer confirmation | `Pending` (Confirm page); also a "Client Confirmed" toggle on the WO |
| BOL | Type `Pre Move`. Status `Created`, `Sent` |
| Invoice | `Draft`, `Created`, `Sent`, `Partially Paid`, `Paid`, `Void`. QuickBooks sync flag `Synced` / `Not Synced` |
| Payment – payment status | `Closed`, `Unapplied` |
| Payment – transaction status | `Successful`, `Requested`, `Authorized`, `Pending`, `Failed`, `Recorded`, `Session Expired`, `Refunded`, `Partial Refunded` |
| Sent item | `Sent`, `Opened` |
| Other pipelines (all empty) | Storage: Scheduled → In Storage → Delivered → Booked. Billing: Deposit Received → Invoiced → Paid → Storage Recurring (Auto / Invoice). Claims: Opened → Documents Sent → Completed Documents Received → Repair/Replacement In Progress → Settled / Denied. Long Distance: Scheduled → Packing/Loading → In Storage → In Transit → Delivered |

---

## 3. Pages

### 3.1 Dashboard (`/dashboard`)
**Purpose:** sales and money snapshot. **Get there:** sidebar › Dashboard (home page).

- **Overview tab:** cards for Work Requests this month (count / $), Not Booked this month, Closed-Won amount this month, Estimates Sent this month, Work Orders today. Filters: Affiliate, Referral Source, User, From/To date. Panels:
  - Leads: created, converted, disqualified, qualified, plus a by-source breakdown
  - Work Requests: created, estimates sent, surveys scheduled, closed won, by pipeline stage
  - Work Orders: single occurrence count
  - Invoices: open, paid and past-due totals
- **Sales tab:** funnel of Leads → Work Requests → Surveys → Estimates → Closed Won, by count or amount, over 30 days or 12 months, filtered by Affiliate and User. Seen: 53 → 25 (47%) → 0 → 13 (25%) → 11 (21%) [funnel stage labels inferred from the order].
- **Leader Board tab:** Revenue by Sales Rep, Closing Ratio by Sales Rep, Revenue by Lead Source, Closing Ratio by Lead Source, Sales Pipeline by Sales Rep. Revenue is counted by Closed-Won date; ratios by WR created date.

### 3.2 Leads (`/sales/lead`)
**Purpose:** raw inquiries before qualification. **Get there:** Sales › Leads, or + › Add Lead. 613 leads.

List views: All Leads, View 1, By Source, By Owner, plus saved views. Status filter. Import and Export buttons.

**Add Lead form** (two steps: Contact Details → Address; Next / Cancel). No field was marked required on screen; FirstName is required by the Lead API.

| Field | Type | Notes |
|---|---|---|
| First Name, Last Name | text | |
| Email Address | text | |
| Contact Number – Mobile / Home | phone with country picker | |
| Referral Source | dropdown (free-text list) | ~100 values; see §10 |
| Move Date | date | |
| Move type | radio | Residential / Commercial |
| Storage | checkbox | |
| Number Of Bedrooms | dropdown | None, Studio, Up to (Min) 1, Up to & Including 2 … 10 |
| Square Feet, Volume (CFT/FT3), Weight (LBS) | number | |
| Lead Owner | dropdown (users) | |
| Tags | multi-select | |
| External Reference | text | |
| Lead Rating | dropdown | Hot / Warm / Cold |
| Customer Note, Internal Note | textarea | |
| Step 2 – Origin / Destination address | address fields | line 1, unit, line 2, city, state, zip (geocoded to lat/long) [unverified: step 2 not opened] |

Extra list columns: Elapsed Time (since creation), Last Action (call/email icon + date), Lead Status, Qualified Date, Disqualified Reason/Date, UTM Source/Medium/Campaign, GCLID, FBCLID, Google Measurement ID, Survey ID/Date.

### 3.3 Work Requests (`/sales/opportunity`), the main job record
**Purpose:** one record per prospective move. Pricing, estimates, work orders, invoices and payments all hang off it. **Get there:** Sales › Work Requests; + › Add Work Request; or by converting a lead. 1,395 WRs. All-time total $1.51M.

**List:** views All, View 1, By Owner, By Source, By Service Type, Notes, Work Req, plus saved views. Advanced and quick filters, Kanban view, Edit View (columns), Export. About 70 columns, including: Owner, WR ID, Time To Convert, Time to 1st Action, Last Action, Time To Estimate, Title, Contact, Source, Tentative, Move Date, Estimated Date, Survey ID/Date, Move Type, Storage (Y/N, type), Bedrooms, Sq Ft, Volume, Weight, Pipeline, Stage, Closed Lost Reason, Tags, Rating, the seven pricing-section amounts, WR Amount, Expected/Actual Close Date, Customer Comments, Internal Note, Company, Service Type, Job Type, Move Coordinators, Prevailing Wage, Created/Updated, full origin and destination address with lat/long, and UTM/click IDs.

**Create New Work Request form** (step 1 Contact Details → step 2 Address):

| Field | Type | Options / notes |
|---|---|---|
| Contact Name | searchable dropdown, can create a new contact | required [inferred] |
| Company Name | dropdown | optional link to a Company |
| Work Request Owner | dropdown (users) | defaults to the shared "Hired Hands" user |
| Move Title | text | default pattern "[customer] – Work Request" |
| Work Request Source | dropdown | same ~100-value source list |
| Tentative | checkbox | date not firm |
| Move Date | date | |
| Move type | radio | Residential / Commercial |
| Storage | checkbox | |
| Number Of Bedrooms | dropdown | as Leads |
| Square Feet, Volume (CFT/FT3), Weight (LBS) | number | |
| Pipeline | dropdown | None, Storage, Billing, Sales, Claims, Long Distance, Operations, Contacts |
| Pipeline Stage | dropdown (depends on Pipeline) | Sales: Lead Qualified, Survey Scheduled, Estimate Provided, Negotiation in Progress, Closed Won, Closed Lost |
| Tags | multi-select | Repeat Customer, Multi-Truck Move, Multi-Day Move, Piano, Packing, 26', 16', 22', Labor, Estimate Provided, Lead Qualified, Closed, Combo Move, Test Tag |
| External Reference | text | |
| Work Request Rating | dropdown | Hot / Warm / Cold |
| Work Request Amount | money | normally filled from pricing |
| Expected Close Date, Actual Close Date | date | |
| Customer Comments, Internal Note | textarea | customer comments usually hold the web-form item list |
| Service Type | dropdown | Commercial, International, Interstate, Intrastate, Local |
| Job Type | dropdown (depends on Service Type) | see §9 Job Types |
| Work Request Move Coordinators | multi-select (users) | |
| Prevailing Wage | checkbox | |
| Step 2: Origin, Destination | address blocks | line 1, unit, line 2, city, state, zip, lat/long; extra stops [unverified] |

**WR detail page:**
- **Header actions:** All Work Requests (back) · Email · Text · Note · Task · Log a Call · **Book This Move** / **Release Booking** · Copy (clone WR) · Download. The pipeline progress bar shows e.g. "Sales – Estimate Provided".
- **Left column:**
  - Tags (add/remove) and an "Opt-in to Automation" toggle (lets drip emails run)
  - Contact card (associate company, view, edit)
  - Move Summary: WR #, title, move date with countdown, move type, service type, move size, amount, volume, weight, job type, customer comments, storage/packing/valuation flags
  - Activity Date(s) (date and time window)
  - Origin & Destination with map, distance and duration
  - Sales Summary: Source, WR Owner, Move Coordinator, Expected/Actual Close, Created/Updated, External Reference
- **Middle tabs:** Pricing · Documents · Activity Log · Call Log · Notes · Text · Photos · Automation Log · Field History.
- **Right column panels:** Events (+Add) · Surveys (+New, link) · Estimates (each one expands to View PDF, Estimate Link (copy), Resend Link, Clone, Delete, Void) · Work Orders (+Add) · Invoices (+Add) · Payments (+Add) · Card On File (+Add) · Task (+Add).
- **Activity Log** records: WR updated, note added/deleted, WO created, estimate sent/viewed/signed, emails sent (with open tracking), automation emails, payment created/received, document uploaded. Each entry has timestamp and user. Events done by the customer are logged under a "Crew App" system user.
- **Log a Call** (drawer): phone number (copy), note (with @mention), outcome radio **Spoke to Customer / Left Voice Message / RingCentral Call**, "Add to Note" checkbox. Call logging is manual; see §9.

### 3.4 Move Pricing editor ("Edit Move Pricing #WR…")
**Purpose:** build the price that becomes the estimate. **Get there:** WR › Pricing tab › pencil next to any section. This is a full-screen editor with Cancel / Update.

- **Header:**
  - Distance, Volume, Weight, Survey (dropdown)
  - Read-only Service Type, Job Type and WR Owner
  - **Add/Edit MultiDay Move** button and activity cards (Start/End dates per day)
  - Tags
- **Section list (left):** Transportation Labor · Valuation · Packing Materials · Packing Labor · Crating · Additional Services · Storage · Summary, with the Grand Total.
- **Transportation Labor section:**
  - Rate/Unit, Men, Trucks
  - Pricing Type radio: **Hourly Rate Table / Movegistics Tariff / Manual Pricing**, plus a "Select Method" dropdown (no methods were configured)
  - **Additional Line Items** grid: Category · Item · Unit · Qty · Rate · Discount · Discount Type (%/$) · Total · Description · (delete)
  - "+ Add Discount"; section total
- Pricing math: see §4.

### 3.5 Estimates (`/sales/quotes`)
**Purpose:** customer-facing quotes created from WR pricing. 1,891 estimates. Tabs: All, Sent, Viewed, Signed. Status filter.

Columns: Estimate ID, Title ("Local Estimate for [customer]"), Amount, Status, Owner, Contact, Company, Move Date, Created, Modified, Expiration Date, WR Title, Service Type, Tags.

Clicking a row shows a quick card with **View (PDF)** and **Contact**. Editing happens from the WR.

**Estimate PDF / document (~12 pages):**
1. Header: company block and total; To/From; Origin/Destination; Service Type, Job Type, Created Date, Expiration Date (created + 30 days); Estimate Type, Volume, Weight, Distance; Activity Dates (arrival date, arrival window, completion time); **Overview** text (template, e.g. "16' Truck" crew/truck description)
2. Pricing by section: Description · Qty · Unit · Rate · Total; section totals; Total, Convenience/Service fee, Grand Total; **Deposit** block (deposit, fee on deposit, total deposit, deposit note)
3. **Scope of Work**: free text (item list, pickup and drop-off access notes)
4. **Terms & Conditions**: the HHMC moving contract, picked by service type (Local, Intrastate, Interstate templates)
5. Packing policy (packed-by-owner rules), customer responsibilities, and a list of items the crew won't handle (cribs, trampolines, aquariums, pianos, pool tables, etc.)

### 3.6 Contacts (`/sales/contact`) and Companies (`/sales/account`)
- **Contacts** (2,944): ID, First/Last Name, Email, Mobile, Home, Owner, Company, Tags, Source, Created/Modified, Credit Amount, Date of Birth, Pipeline Stage, Address, Move Date, Internal Note, Card On File, External Reference. Views: All, By Owner, By Source, By Company. Kanban view, import, export.
- **Companies** (1,220): Name, Type, Owner, About, Internal Note, Tags, Source, Payment Terms, Account Owner, Phone, Email, Website, Fax, Billing Contact and address, Shipping address, External Reference. Used for B2B billing ("Send Invoice To Company", PO Number on invoices).

### 3.7 Surveys (`/sales/survey`), UNUSED
In-home or virtual inventory survey: Manual Survey or AI Survey. Columns: Survey ID, Name, WR, Date, Surveyor, Source, Volume, Weight, Rooms, Shipping, Excluded, CP, PBO (packed by owner), Crating, Tags. **Only 2 surveys exist.** A survey can feed Volume/Weight into pricing.

### 3.8 Follow Ups (`/sales/followup`), UNUSED
Board with Current / Missed / Upcoming tabs; columns "Follow Up 1–5" with totals; filter by slot and user. All empty. HHMC uses email automations instead (§9).

### 3.9 Sales Pipelines (`/sales/pipeline`)
Kanban by month with tabs Storage, Billing, Sales, Claims, Long Distance, Contacts. Each stage shows a win probability (%) and a $ total. Only **Sales** has cards.

### 3.10 Work Orders (`/operations/workorder`)
**Purpose:** the scheduled job. Created when a WR is booked; one WR can have several (multi-day). 883 WOs; total $856K.

- **List columns:** WO ID, Status, Activity, Start/End Date, Title, Volume, Weight, Crew, Assigned Vehicle, Contractor, Pipeline, Stage, Service Type, Job Type, Created, Earliest/Latest Date, Estimate Title, Contact, Company, WR, Owner, Tags, Dispatched (Y/N), Origin/Destination City, Last Invoice Date, Balance Due, Invoice Id/Amount/Status. Kanban view.
- **Detail page** (open with double-click):
  - Header: Email, Text, Note, Task, Log a Call, view Estimate, view Work Request, WO Summary (download)
  - Left column:
    - Tags and a Crew App toggle
    - **WO Status** block: status, Service/Job Type, Activity, Last Activity Date, Start/End
    - Customer Info
    - **Work Order Info**: WO #, linked WR, Move type, Move size, Earliest/Latest date, Lead source, Volume, Weight, Created, External reference, Owner, addresses
  - Middle tabs:
    - **Dispatch**: "Client Confirmed" toggle; **Assign Team** (Existing Team / Assign); **Assign Tools & Equipment**; Packing Materials; **Dispatch Summary** (date, time window, service type, distance, volume, weight); notifications status; **Dispatch** button
    - **Pricing**: a copy of the WR pricing sections, editable
    - **Income** and **Expenses**: disabled on booked jobs
    - **Docs, Photos, Notes, Logs** (Activities, Call Log, Automation Log, Field History)
  - Right column: **Bill of Lading** (amount, BOL #, status, View PDF), Events, Invoices, Payments, Rating & Review, Claims, Task.
- **Assign Resources drawer:** Team Name; counts of workers, contractors and vehicles; Move Supervisor (dropdown); Work Orders in this team; Worker Note; pickers for Workers, Contractors and Vehicles (search and filter). Save / Cancel.

### 3.11 BOL (`/operations/bol`)
List: BOL ID, Type (`Pre Move`), Status, Work Order, WR Title, Service Type, Job Type, Move Date, Contact, Origin/Destination City, Tags, Created. Only **15 BOLs**, all created since Oct 2026 (one per new WO). See §5.

### 3.12 Other Operations pages

| Page | What it is | Observed use |
|---|---|---|
| Confirm | Day-by-day list of WOs: WO ID, Title, Activity, **Customer Status** (`Pending`), Start/End time | Lists jobs; confirmation status stays Pending |
| Assign (`/dispatch`) | Day timeline (12 AM–11 PM) of crew teams. Add New Team, Templates, Load Template, Save | No teams on any day checked. **UNUSED** |
| Dispatch (`/publish`) | Day list of WOs ready to publish to crew | "No work orders to publish" even on job days. **UNUSED** |
| Manage Trips | Long-distance trips (multi-job truck runs) | 0 trips. **UNUSED** |
| Claims | Damage claims | 0 claims. **UNUSED** |
| Availability | Month grid. Per day: $ booked, % used, crew booked/available, trucks booked/available (0/3). Booked/Available toggle; "+" per day | Read-only capacity view |
| Weekly Schedule | Resource × day grid (AM/PM). Tabs Workers / Vehicles / Contractors / Equipment. Shows M (men) and T (trucks) per job vs capacity; "Unassigned Jobs" row | Only 1 worker resource; all jobs show as unassigned |
| Monthly Schedule | Month calendar of WOs labeled "time [customer] (M:men / T:trucks / H:hours or days)". Filters; Google/Outlook calendar sign-in (not connected) | Main visual schedule (DUP with Daily Job Chart, Events) |
| Ops Pipelines | Kanban of WO stages (see §2.2) | Only Booked / Cancelled Out used |
| Crew Tracking | Live map of crews and trucks for today's WOs | Empty. **UNUSED** |
| Ops Reports | 18 canned reports (§8) | Mostly not opened since 2025 |

### 3.13 Daily Job Chart (`/daily_job_chart`)
- Mini calendar (dots on days with jobs).
- **Staff Availability:** Men and Absent totals, booked and available.
- **Truck Availability:** Trucks and Out of Service totals, booked and available.
- Buttons: GPS Tracking, **Download BOL(s)**, Export, **Mark as Sold Out** (blocks the date).
- Quick links: Workers Daily Roster, Absent Workers Today, Vehicle Daily Roster, Out of Service Vehicles, Recurring Availability.
- Job lists grouped by WO status **New / Confirmed / In Progress / Dispatched / Completed / Cancelled**. Columns: WO Id, Title, Customer, Email, Activity, Job Type, Service Type, Crew App On/Off, Team, Workers, Contractors, Vehicles, Move Date, Reporting Time, Start, End, Preview.

### 3.14 Invoices, Payments, Events, Tasks, Conversations, Documents, Sent Items
See §7 for invoices and payments. The rest:
- **Events** (`/calendar/office`): office calendar (day/week) for appointments and activities. Event fields seen in the logs: Title, Activity, Date, Time, Notification Reminder (e.g. 10 minutes), Note, linked WO.
- **Tasks** (`/task`): 0 tasks. **UNUSED** (Task Templates exist in settings).
- **Email** (`/conversations/email`): one connected Gmail inbox ("Personal" visibility). Filtering Rules and Signature tabs. The Email button on records sends through this inbox or the system sender.
- **Texting** (`/conversations/texting`): **no phone numbers bought, 0 messages.** In-app SMS is **UNUSED**, though a Text button and a Text tab exist on every record.
- **Documents** (`/document`): auto-filed folders. Estimates (1,830 PDFs), Work Order (71), Work Requests (5), and empty Claims, Trip, Resources, Contacts, Leads, Companies.
- **Sent Items** (`/sent_items`): log of every outgoing email: Recipient, Communication Type, Module (Estimate / Work Request / Payment / Invoice), Module ID, Sent By (System Generated / Automation / user), Status (Sent / Opened), Sent At. 302 items.

---

## 4. Pricing logic

### 4.1 Building blocks (Settings › General › Line Items, Rate Tables, Taxes)

| Line item | Category | Unit | Rate |
|---|---|---|---|
| 2 Men | Move Charges | per hour | $195 |
| 3 Men | Move Charges | per hour | $240 |
| 4 Men | Move Charges | per hour | $285 |
| Men (generic, no rate) | Move Charges | – | – |
| 16' Truck Local | Equipment | per day | $195 |
| 22' Truck Local | Equipment | per day | $225 |
| 26' Truck Local | Equipment | per day | $245 |
| 16' Truck Long Distance – Day / – Mileage | Equipment | per day / per mile | $55 / $1.09 |
| 22' Truck Long Distance – Day / – Mileage | Equipment | per day / per mile | $65 / $1.19 |
| 26' Truck Long Distance – Day / – Mileage | Equipment | per day / per mile | $75 / $1.19 |
| Travel Charges | Additional Services | per hour | $195 |
| Materials Service Fee | Packing Materials | each | $25 |
| ~17 packing supplies (boxes, bubble, tape, TV and mirror boxes, wardrobe, kits) | Packing Materials | each | $1.50–$39.95 |

- **Default line item:** "16' Truck Local" is added automatically to Local jobs' Transportation Labor.
- **Categories → pricing section:** Move Charges and Equipment → Transportation Labor. Packing Materials → Packing Materials. Packing Labor → Packing Labor. Storage Charges → Storage. Additional Services and Junk Removal Services → Additional Services.
- **Rate Tables** (hourly by crew size, by day of week): Standard Rates 16' Local (default), 16' Intrastate (default), 26' Local, 26' Intrastate, and two inactive "Max 4 Straight Time – Territory A/B". Local service type defaults to **Rate Table** pricing; the other service types default to **Movegistics Tariff**, but no tariffs exist.
- **Travel Charges:** "Standard – Local" and "Standard – Intrastate", charged by duration.
- **Time rounding:** 15 minutes (estimates and Crew App).

### 4.2 Formula as seen on real jobs

```
Section line total  = Qty × Rate − Discount(% or $)
Section total       = Σ line totals          (7 sections: Transportation Labor, Valuation, Packing Materials,
                                               Packing Labor, Crating, Additional Services, Storage)
Sub Total           = Σ section totals
+ Service Tax 4%    (setting "Service Tax", applied on some jobs)          ┐ the same 4% shows up under one of
+ Convenience Fee 4% (card-payment surcharge, applied on other jobs)       ┘ two names (see §10)
= Grand Total
Deposit             = 20% of total (Service Type setting: Deposit Type %, Amount 20 for all types)
                      + 4% convenience fee on the deposit when paid by card
```

**Worked example A, local, 2 movers:** 2 Men 2.5 h × $195 = $487.50, plus 16' truck 1 day × $195 = $682.50. Convenience fee 4% = $27.30. **Grand total $709.80.** Deposit 20% of $682.50 = $136.50 + 4% fee $5.46 = **$141.96**.

**Worked example B, intrastate, ~283 miles:**
- 16' LD truck 1 day × $55 = $55.00
- 283 mi × $1.09 = $308.47
- 2 Men in three hourly lines at $195: 2.5 h + 5 h + 2.5 h (likely load / drive / unload) = $1,950.00
- Sub total $2,313.47 + Service Tax 4% $92.54 = **$2,406.01**. Deposit paid **$481.20** (20% of the grand total).

**Worked example C, invoice after the job:** 2 Men 1 h × $195 = $195.00 + convenience fee 4% $7.80 = $202.80. Less deposit received $40.56 (20%) = $162.24. Less payment received = **balance $0.00**.

### 4.3 Other pricing inputs
- **Discounts** (pick on a line or the whole estimate): Friends & Family 5%, Cornellian 5%, Repeat Customer 5%.
- **Valuation** (liability coverage): "Basic Coverage" at $0.60 per lb per article, $0 charge. This is the default on every service type. Estimates show it as a section that needs initials. Per-$100 and per-$1,000 variants exist.
- **Multipliers** (39, all seed data): stairs (1 flight w/ turn … 3 flights), access, bulky items, white glove, other, applied as %. **UNUSED** [unverified].
- **Crating:** minimum crating amount blank, multiplier 0. **UNUSED**.
- **Estimate options:** e-signature required; expiration 30 days (on); estimate-type selection off; show minimum move charge (min hours × rate) off; hide sales rep off; resource type/qty fields off; valuation not added to deposit; multi-language off.
- **Calendar defaults used by pricing and scheduling:** WO duration 4 h, event 60 min, 30-minute slots, arrival window [value not captured].

---

## 5. Bill of lading (BOL) and inventory

- **When created:** one BOL is created automatically with each new WO (type `Pre Move`, status `Created`). It moves to `Sent` when emailed: template "Send PreMove BOL", module Work Request.
- **What it holds:** the job's priced total (equals the WR/WO grand total), linked WO, WR, customer, service and job type, move date, origin and destination. The layout comes from a template per service type (BOL Local, Intrastate, Interstate, International, Commercial). The detailed sections (inventory, signatures, start/stop times) **[unverified]**: the PDF button reported "BOL PDF Generated Successfully" but no viewer opened.
- **Where it shows up:**
  - Operations › BOL list
  - WO detail (Bill of Lading panel, View PDF)
  - Daily Job Chart ("Download BOL(s)" for the day)
  - Crew App: a BOL confirmation pop-up, configurable per multi-day job (first / last / all days)
- **Inventory:** no structured item inventory is used. Item lists live in free text: the web-form "Customer Comments" and the estimate's **Scope of Work** (e.g. "Loveseat (1), TVs (2), Boxes, mostly packed…", plus access notes). The structured inventory tools (Surveys with rooms/items, Volume/Weight, Packing Materials catalog of 91 cartons, CP/PBO/Crating) exist but are almost unused (2 surveys; Volume/Weight are 0 on sampled jobs).

---

## 6. Crew, hours and payroll

- **Resources in Movegistics:** 1 worker record, 3 vehicles (Van, 26' straight truck, 16' straight truck, no plate, VIN or service data), 0 contractors. Availability pages show capacity as "Men 1, Trucks 3".
- **Worker record fields:**
  - Identity and contact: Employee #, First/Last, Phone, Alt Phone, Email, Alt Email, Home Address, Emergency Contact (name/phone/email)
  - Employment: Crew App User (Y/N), Military Approved, Hire/Termination Date, Department, Worker Type
  - Pay: **Pay Rate**, **Pay Rate Type**, **Target Hours**, **OT Applicable**, **Prevailing Wage Rate**, commissions
  - Other: Tags, Internal Note, Active, Owner
- **Vehicle record fields:**
  - Number, Title, Type, Plate, VIN, Tare Weight, Color, GVWR
  - Registration and Insurance dates (and renewals)
  - Last/Next Service date and odometer
  - Pay Rate and Type, Tags, Note, Owner
- **Crew App:** WOs are synced to the Crew App and crew get an email. Settings:
  - Approval: send for approval; approval mandatory
  - Estimate signature mandatory; time rounding
  - Tip pop-up, BOL confirmation pop-up and **Pay Now** button for multi-day jobs (first / last / all days)
  - App permissions; tip configuration
  - Crew Templates; Checklists (before/after an activity)
- **Crew time tracking:** the crew logs time against **Crew Activities**: Pre-Job, Pack, Load, Drive, Unload, Unpack, Post-Job (per service type). Each activity is flagged Billable and Double Drive and can have checklists. This is how actual hours reach the invoice [unverified: Crew App not observed].
- **Payroll and hours reports:** Worker Hourly Report (opened Nov 2026, returned no data), Worker Payroll, Worker Payroll Detail, Worker Absence, Worker and Contractor Commission. OT Charges, Expenses and Commissions settings are empty.
- **Conclusion:** HHMC's real crew roster, assignment and payroll **are not managed in Movegistics** [unverified where they live]. Movegistics only holds the job, its time window and (via the Crew App) on-site time and payment.

---

## 7. Payments and customer pages

### 7.1 Invoices (`/invoices`)
781 invoices. Views: All, October, saved views. Status filter. Export.

- **List columns:** Invoice ID with QuickBooks sync flag, QB Client ID, QB Invoice ID, Date, Amount, Balance Due, Status, Due Date, Contact, Contact Email/Phone, Invoice Type (`Move Invoice`), Method, Created, Tags, Modified, WR Title, WO ID, Owner, Company, PO Number.
- **Row card:** Edit, Print, Download.
- **Invoice editor ("Update Invoice")**, with Cancel / Update / Next (Next goes on to sending):

| Area | Fields |
|---|---|
| Customer & Invoice Info | Contact* (required), Company, Invoice Date, Terms (Due On Receipt / Net 7 / Net 15 / Net 30 / Net 60), Contact Email, Company Email, Due Date, PO Number, CC Emails (comma-separated), Send From Email, Tags, Contact Phone, Send Invoice To Company (checkbox), Work Request, Work Orders, Billing Address, Estimate |
| Line Items | # · Service Date · Category · Line Item · Product/Service (QuickBooks item) · Unit Type · Qty · Rate · Discount · Discount Type · Tax · Amount. Buttons: + Add Line, Add Subtotal, Clear All |
| Options | **Generate Payment Link** (on by default); Remarks template (default "Google Review" thank-you text with merge fields); attachments |
| Totals | Line Item Total → + Sales Tax % → − Discount → Sub Total → + Service Tax (select) → Sub Total 2 → + Convenience Fees % → **Total** → − Deposit Received → **Grand Total** → − Payment Received → **Balance Due** |

- **Invoice settings:** default terms Due On Receipt; default remarks template; 2-decimal rates and quantities; payment link on by default; packing-materials consolidation and section consolidation off.

### 7.2 Payments (`/payments`)
1,454 payments. Views: All, Transaction Status, plus personal saved views ("Paid thru 10/29", a person's name). **Disable Card Payments** switch. Export.

- **Columns:** Payment Date, Payment ID (+ QuickBooks sync flag), Amount Received, **Convenience Fee**, Actual Payment, Applied, Credits, Payment Mode, Deposit (Y/N), Contact, Company, Invoice No., Payment Status, Transaction Status, Card Last 4, Card Type, Refund Reason, Description, Created, Modified.
- **New Payment** offers three actions:
  - **Request Payment**: sends the customer a pay link [unverified: form not opened]
  - **Apply Payment**: applies an existing unapplied payment or credit (e.g. the deposit) to an invoice [unverified]
  - **Receive Payment**: record a payment. Fields: Contact, Work Request, Work Order, Payment Mode (**Others, Check, Cash, Card (Other), Card, ACH**), Payment Date, Deposit (Yes/No), Amount, Remark. Submit / Cancel
- **Deposit flow:** the deposit lands as an `Unapplied` payment on the WR (visible in the WR Payments panel) and is subtracted on the invoice as "Deposit Received".
- **Gateway:** Authorize.net is the active processor (two accounts named "Remedy"; webhook active). A Stripe setup page exists but isn't completed, though a Stripe script loads on pages. Card types seen: Visa, MasterCard, AmEx. Cards can be saved ("Card On File" on WR and contact).
- **Payment Method settings:** each mode has "Collecting Proof of Payment" and "Convenience Fees" settings [values not captured]. In practice card payments carry 4%.

### 7.3 Customer-facing pages
- **Estimate email:**
  - Subject "Please Sign: [estimate title]", with the tokenized link and the PDF attached
  - Confirmation after signing: "Estimate #… has been signed by you" with the final PDF
  - Separate automation: "[customer], Your Hired Hands Estimate is Ready"
- **Estimate review page** (no login; header shows company block and grand total; Download Estimate PDF on every step):
  1. **Summary:** estimate #, title, To/From, addresses, service and job type, expiry date, volume, weight, distance, activity dates, price by section, total, convenience fee, grand total. Back/Next.
  2. **Detail Estimate Preview:** the full PDF (all pages, including T&Cs) in a viewer.
  3. **E-Sign:** each signable section (e.g. Valuation) is shown and initialed or signed with a timestamp ("Signed On …"). Then **Final Signature** with the line "I have reviewed and initialed each section… and agree to the terms, pricing, and services…" and the customer's name and timestamp.
  4. **Final Confirmation:** "Estimate Review Completed", checklist Reviewed ✓ / Signed ✓ / Deposit ◷, a **Pay Deposit** button, and a breakdown: Deposit Amount (20%), Convenience Fee (4%), Total Deposit Required, deposit note.
- **Deposit payment page:** not opened. The tool blocked the click so no payment flow was started. **[unverified]**
- **Invoice payment link:** **[unverified]**.
- **Other customer emails:** Payment Receipt (amount, payment ID, date, remark), "You're Booked! Here's what to expect", Past-due invoice reminder, "How did your move go?" (Google review link).

---

## 8. Reports and dashboard

Dashboard: see §3.1. Report pages list each report with Last Exported and Last Viewed dates. Each report opens in a new tab with filters, Export and a chart toggle.

| Sales reports (20) | Last viewed |
|---|---|
| Completed Survey | Nov 2026 |
| Leads Report, Lead Lifecycle, Survey Report | Aug–Sep 2026 |
| Sales Performance By Rep; Released Bookings; Opportunities By State; Neglected Opportunities (No Estimates); Neglected Opportunities (Neither Won Nor Lost); Monthly Sales By Rep ($ Sold / # Bookings); Monthly Sales by Lead Source ($ Bookings / $ Sold); Lost Opportunities By Rep; Leads & Opportunities By Source; Lead First Response Duration; Leads Not Converted; Daily Sales To Date; Conversion Ratio by Rep; Conversion Ratio by Lead Source | Sep 2025 (not since) |

| Operations reports (18) | Last viewed |
|---|---|
| Worker Hourly Report | Nov 2026 (no data) |
| Margin Report, Margin Per Activity, Sales Commission, Actual vs Estimated by Move Coordinator | Aug 2026 |
| Actual vs Estimated by Rep, Worker Payroll Detail | Jul 2026 |
| Sales Tax Report, Sales Tax by Work Request | Jun 2026 |
| Contractor Commission, Worker Commission | Apr 2026 |
| Trip Costing, Material Sold Summary, Worker Payroll, Trucks Out Of Service, Unbilled Customers, Worker Absence, Actual Income | 2025 |

**Metrics the rebuild needs**, judging from what the dashboard surfaces and what was recently opened:
- leads by source and conversion rate
- time to first action, to estimate and to convert
- estimates sent, viewed and signed
- bookings and revenue by month, rep and source
- open, paid and past-due invoice totals
- sales tax collected
- actual vs estimated (hours or $)
- margin

---

## 9. Settings and integrations

### 9.1 Workflow-shaping settings

| Setting | HHMC configuration |
|---|---|
| Service Types | Local (pricing load: Rate Table), Intrastate, Interstate, International, Commercial (Movegistics Tariff). All: deposit 20% |
| Job Types | Local: Local with Storage, Local Full Service Move, Onsite Labor Only, Commercial Move, Junk Removal, Packing. Intrastate: Intrastate Move. Interstate: Interstate Move |
| WO Activities | 12 seed activities tied to a missing job type "Intrastate with Storage": Local – Billed Hourly, Load & Unload, Load Only, Unload Only, Storage In/Out, Unpacking, Pack/Move Same Day, Onsite, Packing, LD – Interstate, LD – CA Intrastate |
| Categories / Line Items / Default Line Items | see §4.1 |
| Packing Materials catalog | 91 cartons (PK-##) with type and unit, separate from the 32 line items |
| Product/Service | 164 QuickBooks items, including other Student Agencies businesses (yearbook shipping, postering, tutoring) |
| Discounts | 3 × 5% |
| Taxes / Sales Tax | Service Tax 4%; no sales-tax table |
| Lead Sources | ~100 values, mostly free text typed by web visitors |
| UTM Source/Medium/Campaign, Affiliate, TSP, Rank, Franchise Partner | list tables; Affiliate, TSP, Rank and Franchise Partner are empty |
| Tags | 14 (see §3.3) |
| Pipelines (Sales) | 6 Sales stages; 5 other pipelines defined |
| Lead Assignment | Round robin by shift, **off** |
| Estimates | 8 templates: Terms & Conditions per service type (Local, Intrastate LD, Interstate LD), Remarks ("Standard buyer comment"), Deposit Notes ("20% deposit required…"), Overview (16' Truck default, 26' Truck), Scope of Work ("Standard work note"). Signature config per section and service type (all "Signature Required – No"); e-signature required overall; 30-day expiry |
| Calendars | workday hours, 30-minute increments, 60-minute events, 4-hour WO default, WO start time, arrival-window length, end time shown on estimate |
| Users | 4 users: 1 Super Admin (the shared "Hired Hands" login, which does nearly all work), others with **Move Coordinator** permission (Leads, Contacts, Companies, WRs, Pipelines, Estimates, Invoices). Two users never logged in |
| Fields | 286 field definitions (Module, Group, Field Type, Display In Form, Required, System/Custom). UTM and click-ID fields are flagged Required on the first page; the full required-field list was not paged through **[unverified]** |
| Automations | see 9.2 |
| Email templates | 114 templates in folders: Lead Nurturing, Post Estimate Follow-up, Pre-move post signature, Post Move, Past Due Invoice, System Generated (invoice reminder, claim notices, Send PreMove BOL, resource leave/availability), Payment Receipt. Merge fields like `{{firstName}}`, `{{contact.firstName}}` |
| Invoices | see §7.1 |
| Crew App | see §6 |
| Claims settings | chargeback, damage, denial and settlement types (claims unused) |

### 9.2 Automations (14 rules, all active; "occurrences" = times fired)

| Rule | Type | Module | Trigger | Delay | Fired |
|---|---|---|---|---|---|
| Lead Qualified (tag) | Tag | WR | Lead converted to WR | immediately | 145 |
| Estimate Provided (tag) | Tag | WR | Pipeline/stage change | immediately | 135 |
| Closed (tag) | Tag | WR | Pipeline/stage change | immediately | 104 |
| Same Day Estimate Follow Up | Email | WR | Stage change (→ Estimate Provided) | 2 h | 296 |
| Is the price giving you pause? (Day 2) | Email | WR | Stage change | 1 day | 227 |
| Quick note on your move date (Day 3) | Email | WR | Stage change | 3 days | 156 |
| Still thinking it over? (Day 7) | Email | WR | Stage change | 7 days | 128 |
| Sorry we missed you | Email | Lead | Tag applied to lead | immediately | 55 |
| Didn't Connect | Email | Lead | Tag applied to lead | 24 h | 25 |
| Last Check In | Email | Lead | Tag applied to lead | 2 days | 20 |
| Lead Nurturing: Welcome New Lead | Email | Lead | New lead from website / … | immediately | **0** |
| Payment Receipt Automation | Email | Payment | Payment received / online payment received | immediately | 743 |
| How did your move go? | Email | Invoice | Invoice paid in full | immediately | 266 |
| Past Due Reminder | Email | Invoice | Invoice sent | 8 days | **0** |

The drip stops once the WR leaves Estimate Provided [inferred: the booked example stopped receiving drips after signing]. A WR-level "Opt-in to Automation" toggle controls whether these run.

### 9.3 Integrations

| Integration | Status |
|---|---|
| **QuickBooks Online** | Connected. Sync Invoices and Sync Payments are both on. Mapping screens: Default Product/Service, Product/Service, Tax, Line Item, Payment; Errors tab. Customers have QB Client IDs, but recent invoices show "Not Synced" and payments are mixed. **Sync looks broken or partial** |
| **Authorize.net** | Active card processor (webhook active); two duplicate accounts |
| Stripe | Setup page only (not onboarded) |
| **Gmail** | One inbox connected for sending and receiving |
| Google / Outlook Calendar | Offered on Monthly Schedule; not connected |
| **RingCentral** | **No integration found** in Settings › Integrations or Organization. RingCentral appears only as a manual call-log outcome ("RingCentral Call"). Calls are logged by hand |
| In-app SMS | Not set up (0 numbers) |
| Mailchimp, Open API | listed; status not checked [unverified] |
| Lead API / Web Forms | JSON POST lead API documented (FirstName required; LastName, Phone, Email, Website, MoveDate YYYYMMDD, MoveSize, addresses…). 2 web forms under Marketing › Forms. The website form feeds leads (UTM/GCLID captured) |
| HomeAdvisor, Third-Party Lead, TPL with Survey | lead-feed setup pages [usage unverified] |
| Google review link | in invoice remarks and post-move email |

---

## 10. Clutter and redundancy notes

**Navigation**
- **Operations has 13 items and the same 13 repeat as a tab strip.** Seven are empty or unused at HHMC: Assign, Dispatch, Manage Trips, Claims, Crew Tracking, Weekly Schedule (1 resource) and Ops Pipelines past "Booked". Confirm and BOL have very little data. Recommend replacing them with one **Schedule** view and one **Job** page.
- **Naming mismatch:** the sidebar "Assign" goes to `/operations/dispatch` and "Dispatch" goes to `/operations/publish`.
- **Three or four overlapping calendars:** Monthly Schedule, Daily Job Chart, Availability and Events. Weekly Schedule is a fifth. Recommend one calendar with day/week/month views.
- **Pipelines and Reports appear twice** (Sales and Operations). Of the six Sales pipelines only Sales is used; of 38 reports, about 10 were opened in 2026.
- **Unused sidebar items:** Surveys (2 records), Follow Ups (all 0), Tasks (0), Texting (no numbers), Claims, Trips.

**Records**
- **Pricing is copied three times** (WR Move Pricing → Estimate → WO Pricing → Invoice line items), and the copies can drift. One sampled WR showed $0 in Move Pricing while its sent estimate was $709.80. Recommend one quote with versioned estimates.
- **Duplicate estimates per WR are common** (two Sent or Viewed estimates for the same customer with different totals).
- **Tags repeat pipeline stages** (Lead Qualified, Estimate Provided and Closed tags are set by automation on stage change).
- **Status fields that aren't kept up:** WO status stays `New` for every job; Ops pipeline stays `Booked`. The Daily Job Chart status columns are empty.
- **Duplicate contacts** (the same person appears 2–3 times in the contact picker).

**Catalogs and settings**
- **The 4% charge appears under two names:** "Service Tax (4%)" on some jobs and "Convenience Fees (4%)" on others. Decide whether it is a tax or a card surcharge. That changes reporting and whether it applies to cash or check payments.
- **Lead source list:** about 100 free-text values with near-duplicates ("Google", "google", "Google search", "Google search!", "google search", "Internet", "Online search"…), some sentences and some personal names. Recommend a fixed picklist plus a free-text "details" field.
- **Two product catalogs:** 32 Line Items vs 91 Packing Materials, plus 164 QuickBooks Products/Services, including non-HHMC Student Agencies products. Several TV-box items have identical names.
- **Seed or demo configuration never cleaned up:**
  - 39 stair, access and bulky multipliers
  - "LD – CA Intrastate" activity; 12 WO activities tied to a job type that doesn't exist
  - inactive "Territory A/B" rate tables
  - duplicate per-$100 and per-$1,000 valuation tables
  - International and Commercial service types with no jobs
  - "Test Tag"
- **Two Authorize.net gateway entries** with the same name; Stripe half set up.
- **Empty settings:** Commissions, OT Charges, WO Expenses, Tariffs; Crating set to 0; Lead Assignment off.
- **WO Income and Expenses tabs** are present but disabled.
- **Personal saved views** on shared lists ("Paid thru 10/29", a person's name).
- **One shared Super Admin login** does nearly all work, so per-user reports (by rep, leaderboard) can't mean much.

---

## 11. Open questions

1. **Where do crew scheduling, rosters and payroll actually happen?** Movegistics has 1 worker and no team assignments. The crew apparently works only through the Crew App, which I couldn't observe.
2. **Crew App:** which screens the crew uses (clock in/out per activity, BOL signature, tip, Pay Now), and whether actual hours flow automatically into invoices or are typed in.
3. **Booking trigger:** is "Book This Move" always clicked by staff, or does signing plus deposit auto-book? In the sample the WO was created the day after signing, by staff.
4. **The 4% charge:** sales/service tax or card convenience fee? Should it apply to cash, check and ACH?
5. **Deposit payment page and invoice pay link:** fields and behavior not viewed (would have started a payment flow). Is a saved card charged later for the balance?
6. **BOL content:** the template and PDF contents weren't viewable. Clicking View PDF on one WO only showed a "BOL PDF Generated" notice. Is the BOL used by crews at all?
7. **QuickBooks:** recent invoices show "Not Synced" although sync is on. What's the intended accounting flow, and should the new system sync invoices, payments or both?
8. **RingCentral:** no integration exists in Movegistics. Is RingCentral used separately (calls and texts), with only a manual "RingCentral Call" note here? Should the new system integrate it?
9. **Required fields:** the full list per module (286 field definitions) wasn't paged through. Step 2 (address) of the WR and Lead forms wasn't opened.
10. **Estimate signature configuration:** shows "Signature Required – No" for every section, yet customers initial Valuation and sign a final signature. Which sections must they sign?
11. **Rate Table contents** (hourly rate by crew size and day) couldn't be opened. Rates above come from line items and real estimates.
12. **Mailchimp, Open API, HomeAdvisor and third-party lead feeds:** connected or not? Which web form(s) are live on the HHMC site?
13. **Surveys / AI Survey and structured inventory:** do the managers want them in the rebuild, or is the free-text scope of work enough?
14. **Top-bar shortcuts** (crew check-in "WO" icon, AI assistant) weren't opened.

---

### Side effects of this walkthrough (for transparency)
- I opened one customer's signed estimate link as staff. Movegistics may log this as a view, but the estimate was already Signed, so its status didn't change.
- Clicking **View PDF** on one work order's BOL showed "BOL PDF Generated Successfully". It may have regenerated that BOL's PDF file. Nothing was sent.
- In the pricing editor, opening a line-item dropdown blanked its display value on screen. I clicked **Cancel** and the WR total was unchanged ($2,406.01). The invoice editor, Assign Resources, Receive Payment, Log a Call, Add Lead and Add Work Request forms were all closed with Cancel. Nothing was saved, sent, booked or charged.
