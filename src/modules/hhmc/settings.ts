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
];

export function loadSettings(ctx: BusinessContext): Promise<HhmcSettings> {
  return loadModuleSettings<HhmcSettings>(ctx);
}

/** A percentage setting as basis points (4 → 400). */
export function bp(percent: number): number {
  return Math.round(percent * 100);
}
