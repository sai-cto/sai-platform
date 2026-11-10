/**
 * Generic fake data for the shared core tables (customers, payments, appointments).
 * Used for businesses whose module does not provide its own seedDemoData — i.e. the
 * scaffolded modules — so their console tabs and the executive dashboard have something
 * to show. Everything here is invented.
 */
import type { Scope } from '../db/scope';
import {
  appointmentEntity,
  customerEntity,
  paymentEntity,
  resourceEntity,
} from '../records/core-entities';
import { fakePerson, pick, seedRecords, seededRandom } from './seeding';

const DAY = 24 * 60 * 60 * 1000;

export async function seedCoreDemoData(s: Scope): Promise<void> {
  const random = seededRandom(`${s.ctx.business.code}:${s.ctx.environment}`);
  const now = Date.now();

  const customers = await seedRecords(
    s,
    customerEntity,
    Array.from({ length: 12 }, (_, i) => ({
      ...fakePerson(random, i + 1),
      kind: 'person' as const,
      notes: 'Fake demo customer',
    })),
  );

  await seedRecords(
    s,
    paymentEntity,
    Array.from({ length: 24 }, (_, i) => {
      const paidAt = new Date(
        now - Math.floor(random() * 84) * DAY - Math.floor(random() * 8) * 60 * 60 * 1000,
      );
      return {
        customerId: pick(random, customers).id,
        kind: 'charge' as const,
        amountCents: 2500 + Math.floor(random() * 30) * 500,
        status: 'succeeded' as const,
        method: 'card' as const,
        provider: 'mock' as const,
        providerRef: `mock_ch_demo_${s.ctx.business.code.toLowerCase()}_${i}`,
        cardBrand: 'Visa',
        cardLast4: '4242',
        description: 'Demo payment',
        paidAt,
        createdAt: paidAt,
      };
    }),
  );

  const [resource] = await seedRecords(s, resourceEntity, [{ kind: 'team', name: 'Demo team' }]);

  await seedRecords(
    s,
    appointmentEntity,
    Array.from({ length: 8 }, (_, i) => {
      const startsAt = new Date(now + (i - 3) * DAY);
      startsAt.setUTCHours(14 + (i % 3) * 2, 0, 0, 0);
      return {
        customerId: pick(random, customers).id,
        kind: 'visit',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000),
        status: i < 3 ? ('completed' as const) : ('confirmed' as const),
        resourceId: resource.id,
        notes: 'Demo appointment',
      };
    }),
  );
}
