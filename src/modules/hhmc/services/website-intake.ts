/**
 * The quote form on the Hired Hands website becoming a lead (docs/DECISIONS.md, WEB-1).
 * The form is the static site in /hiredhands-site (free-quote.html). Everything it sends is
 * checked again here: the browser's checks are only for the visitor's convenience.
 */
import { z } from 'zod';
import { ValidationError } from '@/core/errors';
import type { BusinessContext } from '@/core/tenancy/context';
import { createLead } from './leads';

const text = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`);

/** What free-quote.html sends (the names of its fields, as JSON). */
export const websiteQuoteInput = z.object({
  'first-name': text(100).min(1, 'Enter your first name'),
  'last-name': text(100).min(1, 'Enter your last name'),
  email: text(200).min(1, 'Enter your email address'),
  'country-code': text(10).default('US'),
  phone: text(40).min(1, 'Enter your mobile number'),
  'move-date': text(10).min(1, 'Enter your move date'),
  'origin-address': text(200).min(1, 'Enter the address you are moving from'),
  'origin-zip': text(10).min(1, 'Enter the zip code you are moving from'),
  'destination-address': text(200).min(1, 'Enter the address you are moving to'),
  'destination-zip': text(10).min(1, 'Enter the zip code you are moving to'),
  'referral-source': text(200).default(''),
  'customer-note': text(4000).default(''),
});

/** The fields of the lead (leadInput in ./leads) that a website quote request fills in. */
export function leadFromWebsiteQuote(raw: unknown) {
  const result = websiteQuoteInput.safeParse(raw);
  if (!result.success) throw new ValidationError(result.error.issues[0].message);
  const q = result.data;
  // "US" and "CA" numbers are typed without a country code; other countries keep theirs.
  const phone = q['country-code'] === 'US' || q['country-code'] === 'CA' ? q.phone : `${q['country-code']} ${q.phone}`;
  return {
    firstName: q['first-name'],
    lastName: q['last-name'],
    email: q.email,
    phone,
    source: 'Website' as const,
    sourceDetail: q['referral-source'] || null,
    moveDate: q['move-date'],
    originAddress: `${q['origin-address']}, ${q['origin-zip']}`,
    destinationAddress: `${q['destination-address']}, ${q['destination-zip']}`,
    customerNote: q['customer-note'] || null,
    internalNote: 'Created from the quote form on the Hired Hands website.',
  };
}

/** Creates the lead. The lead's own rules (a name, an email or phone, a real date) still apply. */
export async function submitWebsiteLead(ctx: BusinessContext, raw: unknown): Promise<void> {
  await createLead(ctx, leadFromWebsiteQuote(raw));
}
