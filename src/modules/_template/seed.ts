/**
 * TEMPLATE — fake data. Used to fill the sandbox (test mode) and the local demo database.
 * Use seedRecords() and the fake-data helpers; never real names, emails or phone numbers.
 * Give every table at least TWO rows: the automatic tests archive one and compare it with another.
 */
import type { Scope } from '@/core/db/scope';
import { customerEntity } from '@/core/records/core-entities';
import { fakePerson, seedRecords, seededRandom } from '@/core/sandbox/seeding';
import { itemEntity } from './entities';

export async function seedDemoData(s: Scope): Promise<void> {
  const random = seededRandom(`${s.ctx.business.code}:${s.ctx.environment}`);
  const customers = await seedRecords(
    s,
    customerEntity,
    Array.from({ length: 5 }, (_, i) => ({
      ...fakePerson(random, i + 1),
      kind: 'person' as const,
    })),
  );
  await seedRecords(s, itemEntity, [
    { name: 'Example item', priceCents: 1500, customerId: customers[0].id },
    { name: 'Another example', priceCents: 2500 },
  ]);
}
