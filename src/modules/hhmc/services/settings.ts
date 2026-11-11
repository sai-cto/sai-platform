/** Changing the settings data: catalog rates, templates. (Rules: automations.ts updateRule.) */
import { withScope } from '@/core/db/scope';
import { ValidationError } from '@/core/errors';
import { updateRecord } from '@/core/records/records';
import type { BusinessContext } from '@/core/tenancy/context';
import { catalogItemEntity, templateEntity } from '../entities';
import { P } from '../permissions';
import { parseMoney } from './pricing';

export async function updateCatalogItem(ctx: BusinessContext, id: string, input: { rate: string; isActive: boolean }) {
  const rateCents = parseMoney(input.rate);
  if (rateCents === null || rateCents > 10_000_000) throw new ValidationError('Enter the rate in dollars, e.g. 195 or 1.09.');
  return withScope(ctx, P.catalogWrite, (s) => updateRecord(s, catalogItemEntity, id, { rateCents, isActive: input.isActive }));
}

export async function updateTemplate(ctx: BusinessContext, id: string, input: { subject: string; body: string }) {
  if (!input.body.trim()) throw new ValidationError('A template cannot be empty.');
  if (input.subject.length > 200 || input.body.length > 20_000) throw new ValidationError('That template is too long.');
  return withScope(ctx, P.catalogWrite, (s) => updateRecord(s, templateEntity, id, { subject: input.subject, body: input.body }));
}
