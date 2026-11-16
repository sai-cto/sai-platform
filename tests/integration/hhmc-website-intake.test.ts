/**
 * The Hired Hands website's quote form becoming a lead (docs/DECISIONS.md, WEB-1): what the form
 * sends is mapped onto the lead, and the intake door holds "add a lead" and nothing else.
 */
import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/core/errors';
import { getModule } from '@/core/modules/registry';
import { P } from '@/modules/hhmc/permissions';
import { leadFromWebsiteQuote } from '@/modules/hhmc/services/website-intake';

const form = {
  'first-name': ' Ada ',
  'last-name': 'Lovelace',
  email: 'ada@example.com',
  'country-code': 'US',
  phone: '607 555 0123',
  'move-date': '2027-06-01',
  'origin-address': '1 East Ave',
  'origin-zip': '14850',
  'destination-address': '2 West St',
  'destination-zip': '14853',
  'referral-source': 'A friend',
  'customer-note': 'Third floor, no elevator.',
};

describe('website quote form -> lead', () => {
  it('maps the form onto a lead from the website', () => {
    const lead = leadFromWebsiteQuote(form);
    expect(lead).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '607 555 0123',
      source: 'Website',
      sourceDetail: 'A friend',
      moveDate: '2027-06-01',
      originAddress: '1 East Ave, 14850',
      destinationAddress: '2 West St, 14853',
      customerNote: 'Third floor, no elevator.',
    });
  });

  it('keeps the country code of a number outside the US and Canada', () => {
    expect(leadFromWebsiteQuote({ ...form, 'country-code': 'GB', phone: '20 7946 0958' }).phone).toBe('GB 20 7946 0958');
  });

  it('refuses a missing field with a message the visitor can act on', () => {
    expect(() => leadFromWebsiteQuote({ ...form, 'first-name': ' ' })).toThrow(ValidationError);
    expect(() => leadFromWebsiteQuote({ ...form, 'first-name': ' ' })).toThrow('Enter your first name');
    expect(() => leadFromWebsiteQuote({})).toThrow(ValidationError);
    expect(() => leadFromWebsiteQuote('not an object')).toThrow(ValidationError);
  });
});

describe('the website intake door', () => {
  it('holds only the permission to add a lead', () => {
    const intake = getModule('hhmc')?.publicIntakes?.find((i) => i.key === 'hhmc.website-lead');
    expect(intake?.permissions).toEqual([P.leadsWrite]);
  });
});
