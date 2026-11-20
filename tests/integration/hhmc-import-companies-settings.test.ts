/**
 * The Movegistics importer, last two exports: the Companies list (mostly copies of contacts) and
 * HHMC's own settings documents (terms & conditions, email templates). FAKE data only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { customers } from '@/core/db/schema';
import { withScope, type Scope } from '@/core/db/scope';
import { updateRecord } from '@/core/records/records';
import { templateEntity } from '@/modules/hhmc/entities';
import { hhmcEstimates, hhmcImportRefs, hhmcTemplates } from '@/modules/hhmc/schema';
import { sendEstimate } from '@/modules/hhmc/services/estimates';
import { normalizeCompanies } from '../../scripts/hhmc-import/companies';
import { loadIntoHhmc } from '../../scripts/hhmc-import/load';
import { loadTemplates } from '../../scripts/hhmc-import/load-templates';
import { FILE_NAMES, normalize, type Files } from '../../scripts/hhmc-import/movegistics';
import { movegisticsSide, ourSide } from '../../scripts/hhmc-import/reconcile';
import { parseSettingsDocs } from '../../scripts/hhmc-import/settings-docs';
import { gm, newJob } from './hhmc-helpers';
import { systemContext } from './helpers';

const dir = path.resolve(__dirname, '../fixtures/movegistics');
const fixture = Object.fromEntries(Object.entries(FILE_NAMES).map(([k, f]) => [k, fs.readFileSync(path.join(dir, f), 'utf8')])) as Files;

const COMPANY_HEADER =
  '"Company ID","Company Name","Company Type","Company Owner","About","Internal Note","Tags","Company Source","Company Created Date","Company Modified Date","Payment Terms","Account Owner","Company Phone Number","Company Email","Website","Company Fax","Billing Contact Name","Billing Address Line 1","Billing Address Line 2","Billing City","Billing State","Billing Zip Code / Postal Code","Billing Email Address","Billing Contact Number","Shipping Address Line 1","Shipping Address Line 2","Shipping City","Shipping State","Shipping Zip Code / Postal Code","External Reference"';
const cols = COMPANY_HEADER.split(',').map((c) => c.replace(/^"|"$/g, ''));
const companies = (rows: Record<string, string>[]) => [COMPANY_HEADER, ...rows.map((r) => cols.map((c) => `"${r[c] ?? ''}"`).join(','))].join('\n') + '\n';
const company = (id: string, name: string, extra: Record<string, string> = {}) => ({
  'Company ID': id, 'Company Name': name, 'Company Created Date': '04/08/2025', 'Company Modified Date': '04/08/2025', 'Account Owner': 'Hired  Hands', ...extra,
});
/** Avery (CN900001) carries a legacy reference in the fixture-derived contacts below. */
const contactsWithRef = fixture.contacts.replace(/("CN900003",.*),""\n/, '$1,"RLE0003"\n');

const COMPANY_ROWS = companies([
  company('CO900001', 'Avery Fixture', { 'Company Email': 'avery.fixture@example.com', 'Billing City': 'Ithaca' }),
  company('CO900002', 'Blake Sample', { 'Company Email': 'old.blake@example.com', 'External Reference': 'RLE0003' }),
  company('CO900003', 'Fake Widgets Inc', { 'Company Type': 'Corporate', 'Company Email': 'office@fakewidgets.example.com', 'Company Phone Number': '+1 607-555-0190', About: 'A made-up firm', 'Internal Note': 'Pays by check' }),
]);

describe('companies: copies of contacts are linked, real organizations become customers', () => {
  it('links a company row to its contact by email, else by legacy reference; the rest are organizations', () => {
    const n = normalize({ ...fixture, contacts: contactsWithRef });
    const c = normalizeCompanies(COMPANY_ROWS, n.contacts);
    expect(c.links.map((l) => [l.sid, l.contactSid])).toEqual([
      ['CO900001', 'CN900001'],
      ['CO900002', 'CN900003'],
    ]);
    expect(c.links[0].raw['Billing City']).toBe('Ithaca');
    expect(c.organizations).toHaveLength(1);
    expect(c.organizations[0]).toMatchObject({ sid: 'CO900003', name: 'Fake Widgets Inc', email: 'office@fakewidgets.example.com', notes: 'A made-up firm\n\nPays by check', createdOn: '2025-04-08' });
    expect(c.organizations[0].phone).toBeTruthy();
  });

  it('email wins when the email and the legacy reference point at different contacts', () => {
    const n = normalize({ ...fixture, contacts: contactsWithRef });
    const c = normalizeCompanies(companies([company('CO900009', 'Mixed', { 'Company Email': 'avery.fixture@example.com', 'External Reference': 'RLE0003' })]), n.contacts);
    expect(c.links.map((l) => l.contactSid)).toEqual(['CN900001']);
  });

  it('loads: each linked row is kept on its customer; an organization is created once, however often it runs', async () => {
    const ctx = await systemContext('hhmc', 'sandbox');
    const batch = <T,>(fn: (s: Scope) => Promise<T>) => withScope(ctx, 'hhmc.import.run', fn);
    const n = normalize({ ...fixture, contacts: contactsWithRef });
    const withCompanies = { ...n, companies: normalizeCompanies(COMPANY_ROWS, n.contacts) };
    const first = await loadIntoHhmc(batch, withCompanies);
    const refOf = (sid: string) => batch(async (s) => (await s.db.select().from(hhmcImportRefs).where(and(s.where(hhmcImportRefs), eq(hhmcImportRefs.sourceType, 'company'), eq(hhmcImportRefs.sourceId, sid))))[0]);
    expect((await refOf('CO900001')).recordId).toBe(first.ids.get('contact:CN900001'));
    expect((await refOf('CO900001')).sourceData['Billing City']).toBe('Ithaca');
    expect((await refOf('CO900002')).recordId).toBe(first.ids.get('contact:CN900003'));
    const orgId = first.ids.get('company:CO900003')!;
    const org = await batch(async (s) => (await s.db.select().from(customers).where(and(s.where(customers), eq(customers.id, orgId))))[0]);
    expect(org).toMatchObject({ kind: 'organization', organizationName: 'Fake Widgets Inc', email: 'office@fakewidgets.example.com', notes: 'A made-up firm\n\nPays by check' });

    const again = await loadIntoHhmc(batch, withCompanies);
    expect(again.ids.get('company:CO900003')).toBe(orgId);
    expect(again.stats.company).toMatchObject({ created: 0, linked: 0 });
    const ours = await batch((s) => ourSide(s, ctx.business.timeZone));
    expect(ours.companyRows).toBe(movegisticsSide({ ...fixture, companies: COMPANY_ROWS }).companyRows);
  });
});

// A made-up export in the same layout as data/movegistics/<date>/settings/ (fake wording).
const EMAILS = `# Movegistics › Settings › Conversations › Templates — Email templates (copied, read-only)

## Bodies (HHMC's own)

### Lead Nurturing › Last check-in on your move — subject "Last check-in, {{firstName}}"

Hi {{firstName}},

Last note from us.

### Lead Nurturing › Sorry we missed you — subject "Sorry, {{firstName}}!"

Hi {{firstName}}, we missed you.

### Lead Nurturing › Didn't Connect Yet — subject "Still here, {{firstName}}"

Hi {{firstName}}, still here.

### Past Due Invoice › Past due invoice — subject "Invoice reminder"

Hi {{contact.firstName}},

Invoice Amount: {{total}} Due date: {{dueDate}}

Please call us to pay the remaining balance.

### Pre-move post signature › You're Booked! — subject "Booked, {{contact.firstName}}"

See you on {{moveDate}}.

### Post Move › How did your move go? — subject "How did it go, {{contact.firstName}}?"

Leave us a review.

### Post Estimate Follow-up › Still thinking it over? - Day 7 — subject "Still thinking it over?"

Just checking your estimate didn't get lost in the shuffle.

### Post Estimate Follow-up › Quick note on your move date - Day 3 — subject "Quick note"

Your date {{moveDate}} is filling up. Sign your estimate to secure your crew.

### Post Estimate Follow-up › Is the price giving you pause? - Day 2 — subject "Price?"

Reply if you want to talk through the estimate.

### Post Estimate Follow-up › Same Day — subject "{{contact.firstName}}, your estimate is ready"

Sign your estimate and place a deposit to lock in your date.

### Post Estimate Follow-up › Estimate Follow-up — Hired Hands Moving Company (Estimates)

Dear {{contact.firstName}},

When ready, please e-sign the estimate so our team can book your move.

{{signature}}

### Post Estimate Follow-up › INACTIVE Estimate Follow Up — Hired Hands Moving Company (Estimates)

Old text.

### Pre-estimate Inventory Request › Inventory Needed — Hired Hands Moving Company (Work Request)

Dear {{contact.firstName}}, send us your inventory.

{{signature}}

### Addresses Needed — Hired Hands Moving Company (Work Request, no folder)

Hi {{contact.firstName}}, update your addresses.

{{signature}}

### Payment Receipt (Payments, no folder) — subject "Payment Receipt"

Dear {{contact.firstName}} {{contact.lastName}},

You paid \${{amount}}

to {{organizationName}} on {{paymentDate}}

Payment ID : {{paymentDisplayId}}
Total : $ {{amount}}
Remark : {{paymentDescription}}

### ACTIVE Invoice Send (Invoices, no folder) — subject "Your Invoice: {{displayId}} from {{company.name}}"

Dear {{contact.name}},

You can pay securely using the link below:

Kind Regards,

{{owner.name}}

Powered by Movegistics.com

## The other 97 (stock / system), titles and subjects only
`;

const TERMS = `# Movegistics › Terms & Conditions (copied, read-only)

Three templates, identical wording.

---

MADE-UP MOVING CONTRACT

{{company.companyName}} and {{contacts.firstName}} {{contacts.lastName}}, origin {{workRequest.originAddressLineOne}}, {{workRequest.originCity}}, {{workRequest.originState}} {{workRequest.originZipCode}}, on {{workRequest.MoveDate}}.

Valuation Declaration

Basic coverage: $0.60 per pound per article.

{{company.companyName}} Terms and Conditions

Payment is due on completion.
`;

describe('settings documents: terms and email templates', () => {
  const docs = () => parseSettingsDocs({ emailTemplates: EMAILS, terms: TERMS });
  const byKey = (key: string) => docs().find((t) => t.key === key)!;

  it('maps each HHMC template to its key, with our merge fields and a link where the email needs one', () => {
    expect(docs().map((t) => t.key).sort()).toEqual(
      ['addresses_needed', 'booked', 'drip_day2', 'drip_day3', 'drip_day7', 'drip_same_day', 'estimate_email', 'inventory_needed', 'invoice_email', 'lead_didnt_connect', 'lead_last_checkin', 'lead_sorry', 'past_due', 'payment_receipt', 'review_request', 'terms_interstate', 'terms_intrastate', 'terms_local', 'valuation_basic'].sort(),
    );
    expect(byKey('past_due')).toMatchObject({ kind: 'email', subject: 'Invoice reminder' });
    expect(byKey('past_due').body).toBe('Hi {{firstName}},\n\nInvoice Amount: {{invoiceTotal}} Due date: {{dueDate}}\n\nPlease call us to pay the remaining balance.\n\n{{link}}');
    expect(byKey('estimate_email').body).toContain('please e-sign the estimate so our team can book your move.\n\n{{link}}\n\n');
    expect(byKey('estimate_email').subject).toBe('Please Sign: {{estimateTitle}}');
    expect(byKey('booked').subject).toBe('Booked, {{firstName}}');
    expect(byKey('payment_receipt').body).toBe('Dear {{customerName}},\n\nYou paid {{amount}}\n\nto {{businessName}} on {{paymentDate}}\n\nPayment ID : {{paymentId}}\nTotal : {{amount}}');
    expect(byKey('invoice_email')).toMatchObject({ subject: 'Your Invoice: {{invoiceNumber}} from {{businessName}}' });
    expect(byKey('invoice_email').body).toBe('Dear {{customerName}},\n\nYou can pay securely using the link below:\n\n{{link}}\n\nKind Regards,\n\nThe Hired Hands Team');
    expect(byKey('inventory_needed').body).not.toContain('{{signature}}');
    expect(docs().every((t) => !/PLACEHOLDER|Movegistics/i.test(`${t.name} ${t.subject} ${t.body}`))).toBe(true);
  });

  it('the contract is the same for every service type; the valuation is its Valuation Declaration section', () => {
    expect(byKey('terms_local').body).toBe(byKey('terms_interstate').body);
    expect(byKey('terms_local').body).toContain('{{businessName}} and {{customerName}}, origin {{originAddress}}, on {{moveDate}}.');
    expect(byKey('terms_local').body.startsWith('MADE-UP MOVING CONTRACT')).toBe(true);
    expect(byKey('valuation_basic').body).toBe('Valuation Declaration\n\nBasic coverage: $0.60 per pound per article.');
  });

  it('refuses a merge field it cannot fill (it would print empty), and a missing template', () => {
    expect(() => parseSettingsDocs({ emailTemplates: EMAILS.replace('Last note from us.', 'Your rep: {{contact.ownerName}}'), terms: TERMS })).toThrow(/Refusing.*contact\.ownerName/);
    expect(() => parseSettingsDocs({ emailTemplates: EMAILS.replace('### Post Move › How did your move go?', '### Post Move › Something else'), terms: TERMS })).toThrow(/Refusing.*How did your move go/);
  });

  it('loads over the placeholders, keeps a template a manager edited, and changes nothing on a re-run', async () => {
    const ctx = await systemContext('hhmc', 'sandbox');
    const batch = <T,>(fn: (s: Scope) => Promise<T>) => withScope(ctx, 'hhmc.import.run', fn);
    const template = (key: string) => batch(async (s) => (await s.db.select().from(hhmcTemplates).where(and(s.where(hhmcTemplates), eq(hhmcTemplates.key, key))))[0]);
    const managerCtx = await gm('sandbox');
    const edited = await template('review_request');
    await withScope(managerCtx, 'hhmc.catalog.write', (s) => updateRecord(s, templateEntity, edited.id, { body: 'Our own review wording.' }));
    const before = await template('lead_sorry');

    const first = await loadTemplates(batch, docs());
    expect(first.kept).toBeGreaterThanOrEqual(1);
    expect((await template('review_request')).body).toBe('Our own review wording.');
    const sorry = await template('lead_sorry');
    expect(sorry.id).toBe(before.id);
    expect(sorry).toMatchObject({ name: 'Lead Nurturing › Sorry we missed you', subject: 'Sorry, {{firstName}}!', body: 'Hi {{firstName}}, we missed you.' });
    expect((await template('inventory_needed')).kind).toBe('email');

    const again = await loadTemplates(batch, docs());
    expect(again).toMatchObject({ created: 0, updated: 0 });
  });

  it("an estimate's terms and valuation are filled in for the customer when it is sent", async () => {
    const ctx = await gm('sandbox');
    const batch = <T,>(fn: (s: Scope) => Promise<T>) => withScope(ctx, 'hhmc.catalog.write', fn);
    const terms = await batch(async (s) => (await s.db.select().from(hhmcTemplates).where(and(s.where(hhmcTemplates), eq(hhmcTemplates.key, 'terms_local'))))[0]);
    await batch((s) => updateRecord(s, templateEntity, terms.id, { body: '{{businessName}} and {{customerName}}, from {{originAddress}} on {{moveDate}}.' }));
    try {
      const job = await newJob(ctx);
      const estimate = await sendEstimate(ctx, job.id);
      const [row] = await withScope(ctx, 'hhmc.jobs.read', (s) => s.db.select().from(hhmcEstimates).where(and(s.where(hhmcEstimates), eq(hhmcEstimates.id, estimate.id))));
      expect(row.snapshot.termsBody).toBe(`${ctx.business.name} and ${row.snapshot.customerName}, from 1 Test St, Ithaca, NY on ${job.moveDate}.`);
    } finally {
      await batch((s) => updateRecord(s, templateEntity, terms.id, { body: terms.body }));
    }
  });
});
