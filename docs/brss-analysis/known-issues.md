# BRSS Salesforce: known issues we are not copying

These are behaviours of the current BRSS Salesforce org that look like defects or unsafe practice.
The new platform does **not** reproduce them. Each entry says what the org does today, where that is
in the source (`sai-cto/brss-salesforce` at commit `233cf40`, paths under `force-app/main/default/`),
and what the new platform does instead.

The first three were confirmed by the CTO at Checkpoint 1 ("do NOT copy them"). The rest follow the
same reasoning and are marked for review in `docs/DECISIONS.md`.

## Confirmed: do not copy

### KI-1. "Storage Delivery By" comes out one year late

- **Today:** the formula adds `floor((start month + term) / 12)` to the year. When start month + term
  is an exact multiple of 12 the month resolves to December but the year has already been pushed
  forward by one. April + 8 months, June + 6 months and August + 4 months all give December of the
  *following* year. The only correction in the formula covers December starts with terms of 12 or more.
- **Source:** `objects/Order/fields/StorageDeliveryBy__c.field-meta.xml:6-9`
- **Why it matters:** this date drives the delivery deadline and the "schedule your delivery" reminder.
- **New platform:** plain calendar-month addition (the same thing the org's other formula,
  `Storage_Expiration_Date__c`, does with `ADDMONTHS`:
  `objects/Order/fields/Storage_Expiration_Date__c.field-meta.xml:5`). April + 8 months = December of
  the same year. One function, `storageExpirationDate()`, with tests for every month and term.

### KI-2. Billable weight uses two different divisors (÷166 on the phone, ÷139 for the price)

- **Today:** the crew's phone screen and its 1–150 lb pre-check compute dimensional weight as
  length × width × height ÷ 166. The stored billable weight, which pricing and the 150 lb database
  rule read, uses ÷ 139. A box can be billed at a higher weight than the crew saw, and a box the
  phone accepts can still be rejected on save.
- **Source:** `classes/BRSS_ArticleDAO.cls:14` (166) versus
  `objects/Article__c/fields/BillableWeight__c.field-meta.xml:6` (139)
- **New platform:** one function, `billableWeight()`, used for display, validation and pricing. The
  divisor is 139, because that is what customers are actually charged on today. It is a module
  setting, so a manager can change it in one place.

### KI-3. Records are saved before the card is charged

- **Today:** every paid operation is two requests. The first commits the order lines (marked Paid),
  links and discounts. The second charges the card. If the second request never arrives (lost phone
  signal, closed tab), lines stay marked Paid with no payment. When the charge is attempted and
  fails, an undo runs by hand: it deletes new records, restores old values and re-inserts deleted
  lines with new ids, ignoring errors at every step. Articles created during processing are never
  undone.
- **Source:** `classes/BRSS_BasicOrderEditorController.cls:333-414`,
  `classes/BRSS_TransactionManager.cls:90-164`
- **New platform:** one server action in one database transaction. The payment is attempted first,
  with an idempotency key; lines are marked paid and the payment row is written only if it succeeds.
  If anything fails, the whole transaction rolls back. There is no hand-written undo.

## Also not copied (needs review)

### KI-4. Card numbers and the Stripe key pass through the application

- **Today:** raw card number and CVC are posted to the server, and the Stripe secret key is stored in
  a plain-text custom setting.
- **Source:** `classes/BRSS_PaymentManager.cls:126-143`, `classes/BRSS_StripeRequest.cls:25-29`
- **New platform:** card details never reach our server (the provider collects them). The key is read
  from the environment (`.env.local`) and is never stored in the database or the repository.

### KI-5. Missing price data means the customer is silently not charged

- **Today:** if there is no storage-term product at or below the term, no active price entry, no zone
  for the zip, or no rate row for the zone and weight, the line is simply not generated.
- **Source:** `classes/BRSS_SettingsUtils.cls:175-188`, `classes/BRSS_OrderItemUtils.cls:129-170`
- **New platform:** pricing returns an explicit "no price found" result and the staff screen shows it.
  Nothing is billed at zero by accident.

### KI-6. Appointment rules are enforced only in the customer's browser

- **Today:** the lead time before an appointment, unavailability, and a hard-coded Ithaca College date
  window are checked in JavaScript on the booking form. The server inserts whatever it receives.
- **Source:** `components/BRSS_Form_Appointment.component:117-148`, `classes/BRSS_OrderUtils.cls:59-61`
- **New platform:** unavailability is checked on the server when an appointment is created or moved.
  Staff with permission can override, and the override is logged.

### KI-7. Campus category treats everything except North Campus as Off-Campus

- **Today:** the active flow's Off-Campus rule is an OR that includes "Region is not North Campus", so
  West Campus is always Off-Campus and the flow's 15-building list has no effect.
- **Source:** `flows/Appointment_Trigger_After_Save.flow-meta.xml:160-165`
- **New platform:** each building carries its own campus category as editable data. The seed data
  reproduces today's outcome (North Campus = On-Campus, everything else = Off-Campus) so reports stay
  comparable, but a manager can correct any building without a developer.

### KI-8. Reminder emails depend on someone saving the record on the right day

- **Today:** rules such as "appointment date = tomorrow" and "days until delivery = 20" are evaluated
  only when a record is saved, so they fire rarely or more than once.
- **Source:** `workflows/Appointment__c.workflow-meta.xml:158-182,203-227`,
  `workflows/Order.workflow-meta.xml:294`
- **New platform:** confirmation emails are sent at the moment the event happens. Day-before reminders
  need a scheduler, which is out of scope until hosting is decided (see `docs/HANDOFF.md`).
