/**
 * HHMC settings: the numbers a manager may need to change without a developer (Settings tab).
 * Sources: ref §4.2 (deposit, 4% charges), §4.1 (15-minute rounding), §4.3 (30-day expiry),
 * §3.12 (capacity), §4.3 (calendar defaults). Percentages are stored as plain numbers (4 = 4%).
 */
import { z } from 'zod';
import { loadModuleSettings } from '@/core/modules/config';
import type { SettingField } from '@/core/modules/contract';
import type { BusinessContext } from '@/core/tenancy/context';

export const settingsSchema = z.object({
  depositPercent: z.number().min(0).max(100),
  serviceTaxPercent: z.number().min(0).max(100),
  convenienceFeePercent: z.number().min(0).max(100),
  serviceTaxOnByDefault: z.boolean(),
  cardFeeOnByDefault: z.boolean(),
  autoSendDueEmails: z.boolean(),
  roundingMinutes: z.number().int().min(1).max(120),
  estimateExpiryDays: z.number().int().min(1).max(365),
  crewCapacityPerDay: z.number().int().min(0).max(200),
  truckCapacityPerDay: z.number().int().min(0).max(50),
  defaultArrivalWindow: z.string().max(60),
  defaultJobHours: z.number().min(0.5).max(24),
  // Estimate builder (managers' requirements, Nov 2026)
  longDistanceMiles: z.number().min(1).max(5000),
  cornellianDiscountPerHour: z.number().min(0).max(1000),
  // Branding on the customer's estimate and invoice pages and documents
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1d4ed8'),
  brandHeaderText: z.string().max(200),
  brandFooterText: z.string().max(500),
  companyAddress: z.string().max(300),
  companyPhone: z.string().max(40),
  companyEmail: z.string().max(200),
  companyWebsite: z.string().max(200),
});

export type HhmcSettings = z.infer<typeof settingsSchema>;

export const settingsDefaults: HhmcSettings = {
  depositPercent: 20,
  serviceTaxPercent: 4,
  convenienceFeePercent: 4,
  // H4 (NEEDS JAI REVIEW): until a manager confirms what the 4% is, new quotes charge no
  // service tax, and the card fee applies only to payments made by card.
  serviceTaxOnByDefault: false,
  cardFeeOnByDefault: true,
  // Off until someone decides automatic emails should go out on a schedule (P5-15).
  autoSendDueEmails: false,
  roundingMinutes: 15,
  estimateExpiryDays: 30,
  crewCapacityPerDay: 12,
  truckCapacityPerDay: 3,
  defaultArrivalWindow: '8:00–9:00 AM',
  defaultJobHours: 4,
  // Managers: "Over roughly 150 miles we apply a long-distance rate" (NEEDS JAI REVIEW: exact cut-off).
  longDistanceMiles: 150,
  // Managers: "unless they are a Cornellian of which they get a $20 an hour discount".
  cornellianDiscountPerHour: 20,
  // NEEDS JAI REVIEW: placeholders until the managers give their brand colour and company details.
  brandColor: '#1d4ed8',
  brandHeaderText: 'Hired Hands Moving Company · a Student Agencies business',
  brandFooterText: 'Questions? Reply to the email this came with. [PLACEHOLDER – manager to replace]',
  companyAddress: '',
  companyPhone: '',
  companyEmail: '',
  companyWebsite: '',
};

// prettier-ignore
export const settingsFields: SettingField[] = [
  { key: 'depositPercent', label: 'Deposit (%)', type: 'number', help: 'Of subtotal + service tax. Paid by card, the card convenience fee is added on top.' },
  { key: 'serviceTaxPercent', label: 'Service tax (%)', type: 'number', help: 'Applied when "Service tax" is ticked on a quote or invoice.' },
  { key: 'convenienceFeePercent', label: 'Card convenience fee (%)', type: 'number', help: 'Applied when ticked on a quote or invoice, and on a deposit paid by card.' },
  { key: 'serviceTaxOnByDefault', label: 'New quotes include service tax', type: 'boolean', help: 'Off until a manager confirms HHMC charges service tax (DECISIONS H4).' },
  { key: 'cardFeeOnByDefault', label: 'New quotes add the card fee to card payments', type: 'boolean', help: 'The fee is only ever added when the customer pays by card. Cash and check never pay it.' },
  { key: 'autoSendDueEmails', label: 'Send due automatic emails on a schedule', type: 'boolean', help: 'Needs the hosting scheduler (daily). Off: due emails go out only when the tech team presses "Run due emails".' },
  { key: 'roundingMinutes', label: 'Bill time in steps of (minutes)', type: 'number' },
  { key: 'estimateExpiryDays', label: 'Estimates expire after (days)', type: 'number' },
  { key: 'crewCapacityPerDay', label: 'Movers available per day', type: 'number' },
  { key: 'truckCapacityPerDay', label: 'Trucks available per day', type: 'number', help: 'Used when no trucks are set up under Schedule.' },
  { key: 'defaultArrivalWindow', label: 'Default arrival window', type: 'text' },
  { key: 'defaultJobHours', label: 'Default length of a job day (hours)', type: 'number' },
  { key: 'longDistanceMiles', label: 'Long distance starts at (miles)', type: 'number', help: 'At or above this distance the estimate builder uses the long-distance truck day fee plus the per-mile rate (set the rates in Settings › Line items; managers price per-mile about $0.10 below U-Haul). Below it, the local truck day fee.' },
  { key: 'cornellianDiscountPerHour', label: 'Cornellian discount ($ per labor hour)', type: 'number', help: 'When "Cornellian" is ticked in the estimate builder, the movers\' hourly rate is this much lower (packing labor is not discounted).' },
  { key: 'brandColor', label: 'Brand colour (customer pages)', type: 'text', help: 'A hex colour such as #1d4ed8, used for the header band and buttons on estimates and invoices.' },
  { key: 'brandHeaderText', label: 'Header line on estimates and invoices', type: 'text' },
  { key: 'brandFooterText', label: 'Footer text on estimates and invoices', type: 'text' },
  { key: 'companyAddress', label: 'Company address', type: 'text' },
  { key: 'companyPhone', label: 'Company phone', type: 'text' },
  { key: 'companyEmail', label: 'Company email', type: 'text' },
  { key: 'companyWebsite', label: 'Company website', type: 'text' },
];

export function loadSettings(ctx: BusinessContext): Promise<HhmcSettings> {
  return loadModuleSettings<HhmcSettings>(ctx);
}

/** A percentage setting as basis points (4 → 400). */
export function bp(percent: number): number {
  return Math.round(percent * 100);
}

/** What customers see on estimates and invoices (managers: more than "a simple logo and gradient"). */
export type Brand = { color: string; header: string; footer: string; contact: string };

export function brandOf(settings: HhmcSettings, businessName: string): Brand {
  // The colour goes into a style attribute: only a plain #rrggbb is ever used.
  const color = /^#[0-9a-fA-F]{6}$/.test(settings.brandColor ?? '') ? settings.brandColor : settingsDefaults.brandColor;
  return {
    color,
    header: settings.brandHeaderText?.trim() || businessName,
    footer: settings.brandFooterText?.trim() ?? '',
    contact: [settings.companyAddress, settings.companyPhone, settings.companyEmail, settings.companyWebsite].map((v) => v?.trim()).filter(Boolean).join(' · '),
  };
}
