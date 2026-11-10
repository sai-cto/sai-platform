/**
 * seedRecords(): bulk-inserts FAKE data. It skips the per-row activity log (a sandbox reset
 * writes one summary entry instead), so it is locked down: it only works in the sandbox, or
 * for the system actor used by the local seed script. It can never write live data for a
 * real person.
 */
import { txOf, type Scope } from '../db/scope';
import type { EntityDef } from '../modules/contract';
import { authorize } from '../rbac/permissions';
import type { NewValues, Row, TenantTable } from '../records/types';

/** Fake rows may be back-dated, so charts and date filters have something to show. */
export type SeedRow<T extends TenantTable> = NewValues<T> & { createdAt?: Date };

export async function seedRecords<T extends TenantTable>(
  s: Scope,
  entity: EntityDef<T>,
  rows: SeedRow<T>[],
): Promise<Row<T>[]> {
  authorize(s.ctx, entity.writePermission);
  const isSystem = s.ctx.actor.id === null;
  if (s.ctx.environment !== 'sandbox' && !isSystem) {
    throw new Error('seedRecords() can only write sandbox data (or run from the seed script).');
  }
  if (rows.length === 0) return [];
  const inserted = await txOf(s)
    .insert(entity.table)
    .values(
      rows.map((row) => ({
        ...row,
        businessId: s.ctx.business.id,
        environment: s.ctx.environment,
        createdBy: s.ctx.actor.id,
        updatedBy: s.ctx.actor.id,
      })) as never,
    )
    .returning();
  return inserted as Row<T>[];
}

/** A small repeatable random-number generator, so fake data is the same on every run. */
export function seededRandom(seed: string): () => number {
  let state = 0;
  for (const char of seed) state = (Math.imul(state, 31) + char.charCodeAt(0)) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FAKE_FIRST_NAMES = [
  'Avery',
  'Jordan',
  'Riley',
  'Morgan',
  'Casey',
  'Quinn',
  'Rowan',
  'Skyler',
  'Emerson',
  'Finley',
  'Harper',
  'Reese',
  'Sage',
  'Tatum',
  'Dakota',
  'Elliot',
  'Kendall',
  'Logan',
  'Parker',
  'Sydney',
];
export const FAKE_LAST_NAMES = [
  'Testerson',
  'Sample',
  'Placeholder',
  'Demo',
  'Mockingbird',
  'Example',
  'Fixture',
  'Sandbox',
  'Tryout',
  'Prototype',
  'Specimen',
  'Dummy',
  'Fakename',
  'Notreal',
  'Madeup',
  'Pretend',
];

export function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

/** A clearly fake person. Emails use example.com and phones the reserved 555-01xx range. */
export function fakePerson(
  random: () => number,
  index: number,
): { firstName: string; lastName: string; email: string; phone: string } {
  const firstName = pick(random, FAKE_FIRST_NAMES);
  const lastName = pick(random, FAKE_LAST_NAMES);
  return {
    firstName,
    lastName,
    email: `${firstName}.${lastName}.${index}@example.com`.toLowerCase(),
    phone: `607-555-01${String(index % 100).padStart(2, '0')}`,
  };
}
