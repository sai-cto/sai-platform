/**
 * HHMC's own wording from Movegistics' settings (the export's settings/ folder): the moving
 * contract (Terms & Conditions, one text for every service type) and the email templates HHMC
 * wrote. Each becomes the hhmc_templates row it replaces, with Movegistics' merge fields turned
 * into ours. A merge field we cannot fill would print empty, so it stops the import instead.
 */
import type { TemplateKind } from '../../src/modules/hhmc/schema';

export type NTemplate = { key: string; kind: TemplateKind; name: string; subject: string; body: string; source: string };

const SIGNATURE = 'Best,\nThe Hired Hands Team\n409 College Ave.\nIthaca, NY 14850\nPhone: (607)-524-3150\nhiredhands@studentagencies.com';

/** Movegistics merge field → ours (or plain text). Whole phrases first. */
const PHRASES: [string, string][] = [
  ['{{contact.firstName}} {{contact.lastName}}', '{{customerName}}'],
  ['{{contacts.firstName}} {{contacts.lastName}}', '{{customerName}}'],
  ['{{workRequest.originAddressLineOne}}, {{workRequest.originCity}}, {{workRequest.originState}} {{workRequest.originZipCode}}', '{{originAddress}}'],
  // Our amounts are formatted with their "$" already.
  ['${{amount}}', '{{amount}}'],
  ['$ {{amount}}', '{{amount}}'],
];
const FIELDS: Record<string, string> = {
  'contact.firstName': '{{firstName}}',
  'contacts.firstName': '{{firstName}}',
  firstName: '{{firstName}}',
  'contact.name': '{{customerName}}',
  moveDate: '{{moveDate}}',
  'workRequest.MoveDate': '{{moveDate}}',
  total: '{{invoiceTotal}}',
  dueDate: '{{dueDate}}',
  amount: '{{amount}}',
  paymentDate: '{{paymentDate}}',
  paymentDisplayId: '{{paymentId}}',
  organizationName: '{{businessName}}',
  'company.name': '{{businessName}}',
  'company.companyName': '{{businessName}}',
  displayId: '{{invoiceNumber}}',
  signature: SIGNATURE,
  'owner.name': 'The Hired Hands Team',
};

/** What each way of sending fills in (estimates.ts, automations.ts, invoices.ts, the estimate snapshot). */
const COMMON = ['businessName', 'firstName', 'customerName'];
const FILLS = {
  estimate: [...COMMON, 'estimateTitle', 'estimateNumber', 'estimateTotal', 'link'],
  automation: [...COMMON, 'jobNumber', 'moveDate', 'estimateNumber', 'estimateTotal', 'invoiceNumber', 'invoiceTotal', 'balanceDue', 'dueDate', 'link', 'amount', 'paymentDate', 'paymentId'],
  invoice: [...COMMON, 'invoiceNumber', 'invoiceTotal', 'balanceDue', 'balanceDueByCard', 'dueDate', 'link'],
  terms: ['businessName', 'customerName', 'originAddress', 'moveDate'],
  manual: COMMON,
} as const;

type EmailMap = { key: string; title: string; fills: keyof typeof FILLS; subject?: string; linkAfter?: string };
/** HHMC's template (Movegistics title) → our key. `linkAfter`: the paragraph the customer's link follows. */
const EMAILS: EmailMap[] = [
  { key: 'lead_last_checkin', title: 'Last check-in on your move', fills: 'automation' },
  { key: 'lead_sorry', title: 'Sorry we missed you', fills: 'automation' },
  { key: 'lead_didnt_connect', title: "Didn't Connect Yet", fills: 'automation' },
  { key: 'past_due', title: 'Past due invoice', fills: 'automation', linkAfter: 'to pay the remaining balance' },
  { key: 'booked', title: "You're Booked!", fills: 'automation' },
  { key: 'review_request', title: 'How did your move go?', fills: 'automation' },
  { key: 'drip_day7', title: 'Still thinking it over? - Day 7', fills: 'automation', linkAfter: 'lost in the shuffle' },
  { key: 'drip_day3', title: 'Quick note on your move date - Day 3', fills: 'automation', linkAfter: 'Sign your estimate to secure your crew' },
  { key: 'drip_day2', title: 'Is the price giving you pause? - Day 2', fills: 'automation', linkAfter: 'talk through the estimate' },
  { key: 'drip_same_day', title: 'Same Day', fills: 'automation', linkAfter: 'Sign your estimate and place a deposit' },
  // Movegistics sends the estimate itself as a button; it has no subject of its own.
  { key: 'estimate_email', title: 'Estimate Follow-up', fills: 'estimate', subject: 'Please Sign: {{estimateTitle}}', linkAfter: 'please e-sign the estimate' },
  { key: 'inventory_needed', title: 'Inventory Needed', fills: 'manual', subject: 'A few details for your moving estimate' },
  { key: 'addresses_needed', title: 'Addresses Needed', fills: 'manual', subject: 'Your addresses, to finish your quote' },
  { key: 'payment_receipt', title: 'Payment Receipt', fills: 'automation' },
  { key: 'invoice_email', title: 'ACTIVE Invoice Send', fills: 'invoice', linkAfter: 'using the link below' },
];

const refuse = (why: string): never => {
  throw new Error(`Refusing: settings export: ${why}`);
};

function convert(text: string, fills: readonly string[], what: string): string {
  let out = PHRASES.reduce((t, [from, to]) => t.split(from).join(to), text);
  out = out
    .split('\n')
    .filter((line) => !line.includes('{{paymentDescription}}') && !/Powered by Movegistics/i.test(line))
    .join('\n');
  out = out.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (whole, name: string) => FIELDS[name] ?? whole);
  const left = [...out.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map((m) => m[1]).filter((n) => !fills.includes(n));
  if (left.length) refuse(`"${what}" uses ${[...new Set(left)].map((n) => `{{${n}}}`).join(', ')}, which nothing here fills in.`);
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function addLink(body: string, after: string, what: string): string {
  const paragraphs = body.split('\n\n');
  const at = paragraphs.findIndex((p) => p.includes(after));
  if (at < 0) refuse(`"${what}" no longer has the paragraph "${after}" its link goes after.`);
  return [...paragraphs.slice(0, at + 1), '{{link}}', ...paragraphs.slice(at + 1)].join('\n\n');
}

type Section = { heading: string; title: string; subject: string | null; body: string };

function sectionsOf(markdown: string): Section[] {
  const out: Section[] = [];
  for (const chunk of markdown.split(/^### /m).slice(1)) {
    const [heading, ...rest] = chunk.split('\n');
    const bodyText = rest.join('\n').split(/^## /m)[0];
    const title = heading.split(' — ')[0].split(' › ').at(-1)!.trim();
    const subject = / — subject "(.*)"\s*$/.exec(heading)?.[1] ?? null;
    out.push({ heading: heading.trim(), title, subject, body: bodyText.trim() });
  }
  return out;
}

function emailTemplates(markdown: string): NTemplate[] {
  const sections = sectionsOf(markdown);
  return EMAILS.map((m) => {
    const s = sections.find((x) => x.title === m.title || x.title.startsWith(`${m.title} (`));
    if (!s) return refuse(`no email template "${m.title}".`);
    const fills = FILLS[m.fills];
    const converted = convert(s.body, fills, m.title);
    const body = m.linkAfter ? addLink(converted, m.linkAfter, m.title) : converted;
    const subject = m.subject ?? (s.subject !== null ? convert(s.subject, fills, `${m.title} (subject)`) : refuse(`"${m.title}" has no subject.`));
    const name = s.heading.split(' — ')[0].replace(/ \([^)]*\)$/, '').trim();
    return { key: m.key, kind: 'email' as const, name, subject, body, source: s.heading };
  });
}

function termsTemplates(markdown: string): NTemplate[] {
  const start = markdown.search(/^---\s*$/m);
  if (start < 0) refuse('the terms & conditions have no "---" line before the contract.');
  const contract = convert(markdown.slice(start).replace(/^---\s*\n/, ''), FILLS.terms, 'Terms & Conditions');
  const from = contract.search(/^Valuation Declaration\s*$/m);
  const to = contract.search(/^\{\{businessName\}\} Terms and Conditions\s*$/m);
  if (from < 0 || to < from) refuse('the contract has no "Valuation Declaration" section before its Terms and Conditions.');
  const source = 'Settings › Sales › Estimates › Templates (Terms & Conditions)';
  const terms = (key: string, label: string): NTemplate => ({ key, kind: 'terms', name: `Terms & Conditions – ${label}`, subject: '', body: contract, source });
  return [
    terms('terms_local', 'Local'),
    terms('terms_intrastate', 'Intrastate'),
    terms('terms_interstate', 'Interstate'),
    { key: 'valuation_basic', kind: 'terms', name: 'Valuation – Basic coverage ($0.60 per pound per article)', subject: '', body: contract.slice(from, to).trim(), source },
  ];
}

export function parseSettingsDocs(docs: { emailTemplates: string; terms: string }): NTemplate[] {
  return [...emailTemplates(docs.emailTemplates), ...termsTemplates(docs.terms)];
}
