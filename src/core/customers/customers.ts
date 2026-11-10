/** Customers: each business has its own, strictly separate list. */
import { z } from 'zod';
import { withScope } from '../db/scope';
import { ValidationError } from '../errors';
import { customerEntity } from '../records/core-entities';
import { createRecord, listRecords, updateRecord, type ListOptions } from '../records/records';
import type { BusinessContext } from '../tenancy/context';

export const customerInput = z.object({
  kind: z.enum(['person', 'organization']).default('person'),
  firstName: z.string().trim().max(100).default(''),
  lastName: z.string().trim().max(100).default(''),
  organizationName: z.string().trim().max(200).nullish(),
  email: z
    .union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email address')])
    .nullish(),
  phone: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

function parse(raw: unknown) {
  const parsed = customerInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  const v = parsed.data;
  if (v.kind === 'person' && !v.firstName && !v.lastName)
    throw new ValidationError('Enter a first or last name.');
  if (v.kind === 'organization' && !v.organizationName)
    throw new ValidationError('Enter the organization name.');
  return {
    ...v,
    email: v.email || null,
    phone: v.phone || null,
    notes: v.notes || null,
    organizationName: v.organizationName || null,
  };
}

export function listCustomers(ctx: BusinessContext, options: ListOptions = {}) {
  return withScope(ctx, 'customers.read', (s) => listRecords(s, customerEntity, options));
}

export function createCustomer(ctx: BusinessContext, raw: unknown) {
  return withScope(ctx, 'customers.write', (s) => createRecord(s, customerEntity, parse(raw)));
}

export function updateCustomer(ctx: BusinessContext, id: string, raw: unknown) {
  return withScope(ctx, 'customers.write', (s) => updateRecord(s, customerEntity, id, parse(raw)));
}
