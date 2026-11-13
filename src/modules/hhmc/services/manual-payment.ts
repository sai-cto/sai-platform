/**
 * Payments HHMC takes outside the software (Movegistics' "Receive Payment"): cash, a check, a card
 * through Shopify, or anything else. Staff record them on a deposit or an invoice; nothing is ever
 * sent to a card processor from these forms.
 */
import { ValidationError } from '@/core/errors';
import { isDateText, localDate, localTime } from '../rules';

export const PAYMENT_METHODS = ['cash', 'check', 'card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = { cash: 'Cash', check: 'Check', card: 'Card (Shopify)', other: 'Other' };

export type ManualPaymentInput = {
  method: PaymentMethod;
  /** Check number, Shopify order number, or a short note. */
  reference?: string;
  /** The local day it was received (YYYY-MM-DD); default today. */
  paidOn?: string;
  attemptKey: string;
};

export function isPaymentMethod(v: string): v is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(v);
}

/** Checks the method, reference and date; returns what the payment record gets. */
export function manualDetails(input: ManualPaymentInput, timeZone: string, now: Date = new Date()): { paidAt: Date; reference: string | null } {
  if (!isPaymentMethod(input.method)) throw new ValidationError('Choose how it was paid.');
  const reference = (input.reference ?? '').trim();
  if (reference.length > 100) throw new ValidationError('Keep the reference to 100 characters.');
  const today = localDate(now, timeZone);
  const day = (input.paidOn ?? '').trim() || today;
  if (!isDateText(day)) throw new ValidationError('Enter the date it was paid.');
  if (day > today) throw new ValidationError('The payment date cannot be in the future.');
  if (day < '2015-01-01') throw new ValidationError('Enter a payment date from 2015 on.');
  // Today: the moment it is recorded. An earlier day: noon that day, so it never slips a day.
  return { paidAt: day === today ? now : localTime(day, '12:00', timeZone), reference: reference || null };
}

export function describeManual(base: string, method: PaymentMethod, reference: string | null): string {
  return [base, PAYMENT_METHOD_LABELS[method], reference ? `ref. ${reference}` : null].filter(Boolean).join(' · ');
}
