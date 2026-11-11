/**
 * BRSS settings: the numbers a manager may need to change without a developer. Edited in the
 * console's Settings tab. In Salesforce these lived in the BRSS_HierarchySettings__c custom
 * setting and in constants inside Apex classes (sources are cited in rules.ts).
 */
import { z } from 'zod';
import { loadModuleSettings } from '@/core/modules/config';
import type { SettingField } from '@/core/modules/contract';
import type { BusinessContext } from '@/core/tenancy/context';

export const settingsSchema = z.object({
  taxPercent: z.number().min(0).max(100),
  maxStaffDiscountPercent: z.number().min(0).max(100),
  appointmentLeadDays: z.number().int().min(0).max(60),
  dimensionalDivisor: z.number().int().min(1).max(1000),
  overweightThresholdLb: z.number().int().min(1).max(1000),
  maxBillableWeightLb: z.number().int().min(1).max(1000),
  insurancePercent: z.number().min(0).max(100),
});

export type BrssSettings = z.infer<typeof settingsSchema>;

export const settingsDefaults: BrssSettings = {
  taxPercent: 8,
  maxStaffDiscountPercent: 5,
  appointmentLeadDays: 2,
  dimensionalDivisor: 139,
  overweightThresholdLb: 70,
  maxBillableWeightLb: 150,
  insurancePercent: 10,
};

// prettier-ignore
export const settingsFields: SettingField[] = [
  { key: 'taxPercent', label: 'Sales tax (%)', type: 'number', help: 'Applied to the whole subtotal after any discount. Tips are not taxed.' },
  { key: 'maxStaffDiscountPercent', label: 'Largest discount without special permission (%)', type: 'number', help: 'People with "Give a discount above the staff limit" can go up to 100%.' },
  { key: 'appointmentLeadDays', label: 'Days of notice needed for an appointment', type: 'number', help: 'An appointment sooner than this needs the "blocked time or short notice" permission.' },
  { key: 'dimensionalDivisor', label: 'Dimensional weight divisor', type: 'number', help: 'Dimensional weight = length × width × height ÷ this number.' },
  { key: 'overweightThresholdLb', label: 'A box is overweight from (lb)', type: 'number', help: 'Billable weight at or above this uses the overweight storage price.' },
  { key: 'maxBillableWeightLb', label: 'Heaviest box accepted (lb, billable weight)', type: 'number' },
  { key: 'insurancePercent', label: 'Extra insurance price (% of declared value)', type: 'number' },
];

export function loadSettings(ctx: BusinessContext): Promise<BrssSettings> {
  return loadModuleSettings<BrssSettings>(ctx);
}
