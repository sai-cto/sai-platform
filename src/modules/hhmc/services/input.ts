/** Small helpers shared by the HHMC services for checking what a form sent. */
import { z } from 'zod';
import { ValidationError } from '@/core/errors';
import { isUuid } from '@/core/ids';
import { isDateText } from '../rules';

/** Checks `raw` against a schema; the first problem becomes a message the person can act on. */
export function parse<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) throw new ValidationError(result.error.issues[0].message);
  return result.data;
}

/** Text that may be left empty: trimmed, and "" becomes null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .nullish()
    .transform((value) => value || null);

export const requiredText = (label: string, max: number) =>
  z.string().trim().min(1, `Enter ${label}`).max(max, `Use at most ${max} characters`);

/** A record id that may be left empty. */
export const optionalId = z
  .string()
  .nullish()
  .transform((value) => value || null)
  .refine((value) => value === null || isUuid(value), 'Choose an item from the list');

export const requiredId = (label: string) =>
  z.string().refine((value) => isUuid(value), `Choose ${label}`);

export const dateText = (label: string) =>
  z.string().refine((value) => isDateText(value), `Enter ${label} as a date`);

/** A whole number from a form field ("" is not a number). */
export const wholeNumber = (label: string, min: number, max: number) =>
  z.coerce
    .number({ message: `Enter ${label} as a number` })
    .int(`Enter ${label} as a whole number`)
    .min(min, `${label[0].toUpperCase()}${label.slice(1)} must be at least ${min}`)
    .max(max, `${label[0].toUpperCase()}${label.slice(1)} must be at most ${max}`);
