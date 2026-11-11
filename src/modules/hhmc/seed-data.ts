/**
 * HHMC settings data: the catalog and rates (ref §4.1), discounts (ref §4.3), templates
 * (ref §9.1, §7.3) and automation rules (ref §9.2). Seeded into every new business
 * environment by seed.ts; staff change them afterwards in the portal's Settings page.
 *
 * Rates are the ones Movegistics showed for HHMC on 2026-11-10 (ref §4.1). Template wording is
 * written fresh for the rebuild (the Movegistics templates were not copied): HHMC's managers
 * should replace it with their own before going live.
 */
import type { AutomationTrigger, CatalogCategory } from './schema';
import type { SectionKey } from './services/pricing';

type Item = { name: string; category: CatalogCategory; section: SectionKey; unit: string; rateCents: number; isDefaultForLocal?: boolean };

const MOVE: Pick<Item, 'category' | 'section'> = { category: 'Move Charges', section: 'transportation_labor' };
const EQUIP: Pick<Item, 'category' | 'section'> = { category: 'Equipment', section: 'transportation_labor' };
const PACK: Pick<Item, 'category' | 'section'> = { category: 'Packing Materials', section: 'packing_materials' };

// prettier-ignore
export const CATALOG: Item[] = [
  { name: '2 Men', ...MOVE, unit: 'hour', rateCents: 19500 },
  { name: '3 Men', ...MOVE, unit: 'hour', rateCents: 24000 },
  { name: '4 Men', ...MOVE, unit: 'hour', rateCents: 28500 },
  { name: "16' Truck Local", ...EQUIP, unit: 'day', rateCents: 19500, isDefaultForLocal: true },
  { name: "22' Truck Local", ...EQUIP, unit: 'day', rateCents: 22500 },
  { name: "26' Truck Local", ...EQUIP, unit: 'day', rateCents: 24500 },
  { name: "16' Truck Long Distance – Day", ...EQUIP, unit: 'day', rateCents: 5500 },
  { name: "16' Truck Long Distance – Mileage", ...EQUIP, unit: 'mile', rateCents: 109 },
  { name: "22' Truck Long Distance – Day", ...EQUIP, unit: 'day', rateCents: 6500 },
  { name: "22' Truck Long Distance – Mileage", ...EQUIP, unit: 'mile', rateCents: 119 },
  { name: "26' Truck Long Distance – Day", ...EQUIP, unit: 'day', rateCents: 7500 },
  { name: "26' Truck Long Distance – Mileage", ...EQUIP, unit: 'mile', rateCents: 119 },
  { name: 'Travel Charges', category: 'Additional Services', section: 'additional_services', unit: 'hour', rateCents: 19500 },
  { name: 'Materials Service Fee', ...PACK, unit: 'each', rateCents: 2500 },
  { name: 'Small Box', ...PACK, unit: 'each', rateCents: 250 },
  { name: 'Medium Box', ...PACK, unit: 'each', rateCents: 350 },
  { name: 'Large Box', ...PACK, unit: 'each', rateCents: 450 },
  { name: 'Wardrobe Box', ...PACK, unit: 'each', rateCents: 1795 },
  { name: 'TV Box', ...PACK, unit: 'each', rateCents: 3995 },
  { name: 'Mirror Box', ...PACK, unit: 'each', rateCents: 1495 },
  { name: 'Packing Tape', ...PACK, unit: 'each', rateCents: 395 },
  { name: 'Bubble Wrap (roll)', ...PACK, unit: 'each', rateCents: 2495 },
  { name: 'Packing Labor', category: 'Packing Labor', section: 'packing_labor', unit: 'hour', rateCents: 19500 },
  { name: 'Basic Coverage ($0.60/lb per article)', category: 'Valuation', section: 'valuation', unit: 'each', rateCents: 0 },
  { name: 'Storage (per month)', category: 'Storage Charges', section: 'storage', unit: 'month', rateCents: 15000 },
  { name: 'Junk Removal', category: 'Additional Services', section: 'additional_services', unit: 'each', rateCents: 15000 },
];

export const DISCOUNTS = [
  { name: 'Friends & Family', percentBp: 500 },
  { name: 'Cornellian', percentBp: 500 },
  { name: 'Repeat Customer', percentBp: 500 },
];

const SIGN_OFF = '\n\nThank you,\n{{businessName}}';

// prettier-ignore
export const TEMPLATES: { key: string; kind: 'terms' | 'email'; name: string; subject: string; body: string }[] = [
  { key: 'estimate_email', kind: 'email', name: 'Estimate: please sign', subject: 'Please Sign: {{estimateTitle}}', body: 'Hi {{firstName}},\n\nYour estimate {{estimateNumber}} for {{estimateTotal}} is ready. Review it, sign it and pay the deposit here:\n{{link}}' + SIGN_OFF },
  { key: 'estimate_signed', kind: 'email', name: 'Estimate signed (customer copy)', subject: 'Estimate {{estimateNumber}} has been signed by you', body: 'Hi {{firstName}},\n\nThanks for signing estimate {{estimateNumber}} ({{estimateTotal}}). You can see it, and pay your deposit if you have not yet, here:\n{{link}}' + SIGN_OFF },
  { key: 'drip_same_day', kind: 'email', name: 'Drip: same day', subject: 'Any questions about your estimate?', body: 'Hi {{firstName}},\n\nJust checking you received your estimate. Reply to this email with any questions.\n{{link}}' + SIGN_OFF },
  { key: 'drip_day2', kind: 'email', name: 'Drip: day 2', subject: 'Is the price giving you pause?', body: 'Hi {{firstName}},\n\nIf something in the estimate does not look right, tell us and we will take another look.\n{{link}}' + SIGN_OFF },
  { key: 'drip_day3', kind: 'email', name: 'Drip: day 3', subject: 'Quick note on your move date', body: 'Hi {{firstName}},\n\nDates fill up quickly. Sign your estimate to hold yours.\n{{link}}' + SIGN_OFF },
  { key: 'drip_day7', kind: 'email', name: 'Drip: day 7', subject: 'Still thinking it over?', body: 'Hi {{firstName}},\n\nYour estimate is still waiting for you here:\n{{link}}' + SIGN_OFF },
  { key: 'lead_sorry', kind: 'email', name: 'Lead: sorry we missed you', subject: 'Sorry we missed you', body: 'Hi {{firstName}},\n\nWe tried to reach you about your move. Reply to this email or call us when it suits you.' + SIGN_OFF },
  { key: 'lead_didnt_connect', kind: 'email', name: "Lead: didn't connect", subject: "We haven't connected yet", body: 'Hi {{firstName}},\n\nWe would still love to help with your move. When is a good time to talk?' + SIGN_OFF },
  { key: 'lead_last_checkin', kind: 'email', name: 'Lead: last check-in', subject: 'Last check-in about your move', body: 'Hi {{firstName}},\n\nThis is our last note. If you still need movers, just reply.' + SIGN_OFF },
  { key: 'payment_receipt', kind: 'email', name: 'Payment receipt', subject: 'Payment receipt: {{amount}}', body: 'Hi {{firstName}},\n\nWe received your payment of {{amount}} on {{paymentDate}} (payment {{paymentId}}) for job {{jobNumber}}.' + SIGN_OFF },
  { key: 'booked', kind: 'email', name: "You're booked", subject: "You're Booked! Here's what to expect", body: 'Hi {{firstName}},\n\nYour move ({{jobNumber}}) on {{moveDate}} is booked. Our crew will arrive in the window on your estimate.' + SIGN_OFF },
  { key: 'review_request', kind: 'email', name: 'How did your move go?', subject: 'How did your move go?', body: 'Hi {{firstName}},\n\nThanks for moving with us. We would be grateful for a review on Google.' + SIGN_OFF },
  { key: 'past_due', kind: 'email', name: 'Past-due invoice reminder', subject: 'Reminder: invoice {{invoiceNumber}} is past due', body: 'Hi {{firstName}},\n\nInvoice {{invoiceNumber}} has a balance of {{balanceDue}}. Pay it here:\n{{link}}' + SIGN_OFF },
  { key: 'invoice_email', kind: 'email', name: 'Invoice', subject: 'Invoice {{invoiceNumber}} from {{businessName}}', body: 'Hi {{firstName}},\n\nYour invoice {{invoiceNumber}} totals {{invoiceTotal}}. Balance due: {{balanceDue}} by {{dueDate}}.\n{{link}}' + SIGN_OFF },
  { key: 'terms_local', kind: 'terms', name: 'Terms & Conditions – Local', subject: '', body: 'PLACEHOLDER TERMS (Local moves). Replace with HHMC\'s moving contract before going live.\n\n1. Charges are by the hour from arrival to completion, billed in 15-minute steps.\n2. Items packed by the owner are the owner\'s responsibility.\n3. The crew will not move cribs, trampolines, aquariums, pianos or pool tables.\n4. A 20% deposit holds the date.' },
  { key: 'terms_intrastate', kind: 'terms', name: 'Terms & Conditions – Intrastate', subject: '', body: 'PLACEHOLDER TERMS (Intrastate moves). Replace with HHMC\'s moving contract before going live.' },
  { key: 'terms_interstate', kind: 'terms', name: 'Terms & Conditions – Interstate', subject: '', body: 'PLACEHOLDER TERMS (Interstate moves). Replace with HHMC\'s moving contract before going live.' },
  { key: 'valuation_basic', kind: 'terms', name: 'Valuation – Basic Coverage', subject: '', body: 'Basic Coverage: the mover is liable for up to $0.60 per pound per article. There is no charge for this coverage. Initial to confirm you understand it.' },
];

// prettier-ignore
export const RULES: { key: string; name: string; trigger: AutomationTrigger; delayMinutes: number; templateKey: string; respectsOptIn: boolean }[] = [
  { key: 'drip_same_day', name: 'Same Day Estimate Follow Up', trigger: 'estimate_sent', delayMinutes: 120, templateKey: 'drip_same_day', respectsOptIn: true },
  { key: 'drip_day2', name: 'Is the price giving you pause? (Day 2)', trigger: 'estimate_sent', delayMinutes: 1440, templateKey: 'drip_day2', respectsOptIn: true },
  { key: 'drip_day3', name: 'Quick note on your move date (Day 3)', trigger: 'estimate_sent', delayMinutes: 4320, templateKey: 'drip_day3', respectsOptIn: true },
  { key: 'drip_day7', name: 'Still thinking it over? (Day 7)', trigger: 'estimate_sent', delayMinutes: 10080, templateKey: 'drip_day7', respectsOptIn: true },
  { key: 'lead_sorry', name: 'Sorry we missed you', trigger: 'lead_no_contact', delayMinutes: 0, templateKey: 'lead_sorry', respectsOptIn: false },
  { key: 'lead_didnt_connect', name: "Didn't Connect", trigger: 'lead_no_contact', delayMinutes: 1440, templateKey: 'lead_didnt_connect', respectsOptIn: false },
  { key: 'lead_last_checkin', name: 'Last Check In', trigger: 'lead_no_contact', delayMinutes: 2880, templateKey: 'lead_last_checkin', respectsOptIn: false },
  { key: 'payment_receipt', name: 'Payment Receipt', trigger: 'payment_received', delayMinutes: 0, templateKey: 'payment_receipt', respectsOptIn: false },
  { key: 'booked', name: "You're Booked", trigger: 'job_booked', delayMinutes: 0, templateKey: 'booked', respectsOptIn: false },
  { key: 'review_request', name: 'How did your move go?', trigger: 'invoice_paid', delayMinutes: 0, templateKey: 'review_request', respectsOptIn: true },
  { key: 'past_due', name: 'Past Due Reminder', trigger: 'invoice_sent', delayMinutes: 8 * 1440, templateKey: 'past_due', respectsOptIn: false },
];
