/**
 * Taking payments and issuing refunds.
 *
 * Order of events (this is deliberate — see docs/brss-analysis/known-issues.md, KI-3):
 *   1. ask the provider to charge, with an idempotency key;
 *   2. write the payment row in the caller's transaction, together with whatever the
 *      caller marks as paid.
 * If the transaction fails after step 1, retrying with the same key returns the same
 * charge, so nobody is charged twice and nothing is ever "paid" without a payment row.
 */
import { and, eq, sql, sum } from 'drizzle-orm';
import { payments, refunds } from '../db/schema';
import { txOf, type Scope } from '../db/scope';
import { ValidationError } from '../errors';
import { authorize } from '../rbac/permissions';
import { customers } from '../db/schema';
import { paymentEntity, refundEntity } from '../records/core-entities';
import { createRecord, getRecord } from '../records/records';
import type { Row } from '../records/types';
import { mockProvider } from './mock-provider';
import type { PaymentProvider } from './provider';
import { createStripeProvider } from './stripe-provider';

let stripeProvider: PaymentProvider | undefined;

/** The sandbox ALWAYS uses the mock provider, whatever is configured. */
export function providerFor(environment: 'live' | 'sandbox'): PaymentProvider {
  if (environment === 'sandbox') return mockProvider;
  if (process.env.PAYMENT_PROVIDER === 'stripe') {
    stripeProvider ??= createStripeProvider();
    return stripeProvider;
  }
  return mockProvider;
}

export type TakePaymentInput = {
  amountCents: number;
  description: string;
  idempotencyKey: string;
  customerId?: string | null;
  method?: 'card' | 'cash' | 'check' | 'other';
  kind?: 'charge' | 'authorization';
  paymentMethodToken?: string;
  subjectType?: string;
  subjectId?: string;
};

/** Makes concurrent calls for the same key wait for each other (released when the transaction ends). */
async function lockKey(s: Scope, key: string): Promise<void> {
  await txOf(s).execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${s.ctx.business.id}:${s.ctx.environment}:${key}`}, 0))`,
  );
}

/**
 * Charges (or records) a payment. Returns the payment row; check row.status.
 * A failed card attempt is recorded with status "failed" so there is a trace of it.
 */
export async function takePayment(
  s: Scope,
  input: TakePaymentInput,
): Promise<Row<typeof payments>> {
  // Permission and input first: nobody without payments.write can reach the provider.
  authorize(s.ctx, 'payments.write');
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0)
    throw new ValidationError('The amount must be more than zero.');
  if (!input.idempotencyKey) throw new ValidationError('A payment needs an idempotency key.');

  // Same key = same payment. The lock makes a second, simultaneous request wait here until
  // the first has finished; it then finds the first one's row and returns it. The unique
  // index on (business, environment, idempotency_key) is the database's own guarantee.
  await lockKey(s, input.idempotencyKey);
  const [existing] = await s.db
    .select()
    .from(payments)
    .where(and(s.where(payments, 'include'), eq(payments.idempotencyKey, input.idempotencyKey)))
    .limit(1);
  if (existing) return existing;

  // Every link is checked BEFORE the card is charged. (The database would refuse a customer
  // from another business or environment anyway, but by then the money would have moved.)
  if (input.customerId) {
    const [customer] = await s.db
      .select({ id: customers.id })
      .from(customers)
      .where(and(s.where(customers, 'include'), eq(customers.id, input.customerId)))
      .limit(1);
    if (!customer) throw new ValidationError('A linked record does not exist in this business.');
  }

  const method = input.method ?? 'card';
  const kind = input.kind ?? 'charge';
  const common = {
    customerId: input.customerId ?? null,
    kind,
    amountCents: input.amountCents,
    currency: 'usd',
    method,
    idempotencyKey: input.idempotencyKey,
    description: input.description,
    subjectType: input.subjectType ?? null,
    subjectId: input.subjectId ?? null,
  };

  // Cash, cheque and other offline payments are simply recorded.
  if (method !== 'card') {
    return createRecord(s, paymentEntity, {
      ...common,
      status: 'succeeded',
      provider: 'manual',
      paidAt: new Date(),
    });
  }

  const provider = providerFor(s.ctx.environment);
  const result = await provider.charge({
    amountCents: input.amountCents,
    currency: 'usd',
    description: input.description,
    idempotencyKey: `${s.ctx.business.id}:${s.ctx.environment}:${input.idempotencyKey}`,
    paymentMethodToken: input.paymentMethodToken,
    kind,
  });
  if (!result.ok) {
    return createRecord(s, paymentEntity, {
      ...common,
      status: 'failed',
      provider: provider.name,
      failureReason: result.failureReason,
    });
  }
  return createRecord(s, paymentEntity, {
    ...common,
    status: 'succeeded',
    provider: provider.name,
    providerRef: result.providerRef,
    cardBrand: result.cardBrand ?? null,
    cardLast4: result.cardLast4 ?? null,
    paidAt: new Date(),
  });
}

/**
 * How much of a payment has already been refunded. Archived refunds count too: archiving a
 * refund hides the row, it does not un-send the money.
 */
export async function refundedCents(s: Scope, paymentId: string): Promise<number> {
  authorize(s.ctx, 'payments.read');
  const [row] = await s.db
    .select({ total: sum(refunds.amountCents) })
    .from(refunds)
    .where(
      and(
        s.where(refunds, 'include'),
        eq(refunds.paymentId, paymentId),
        eq(refunds.status, 'succeeded'),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function refundPayment(
  s: Scope,
  input: { paymentId: string; amountCents: number; reason: string },
): Promise<Row<typeof refunds>> {
  // Permission and input first: nobody without payments.write can reach the provider.
  authorize(s.ctx, 'payments.write');
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0)
    throw new ValidationError('The refund must be more than zero.');
  const payment = await getRecord(s, paymentEntity, input.paymentId);
  if (payment.status !== 'succeeded' || payment.kind !== 'charge')
    throw new ValidationError('Only a completed charge can be refunded.');

  // Lock the payment row so two refunds at the same moment cannot both see "nothing
  // refunded yet" and together give back more than was paid.
  await txOf(s)
    .select({ id: payments.id })
    .from(payments)
    .where(and(s.where(payments), eq(payments.id, payment.id)))
    .for('update');
  const already = await refundedCents(s, payment.id);
  if (already + input.amountCents > payment.amountCents) {
    throw new ValidationError(
      `Only ${((payment.amountCents - already) / 100).toFixed(2)} is left to refund on this payment.`,
    );
  }
  if (payment.provider === 'manual') {
    return createRecord(s, refundEntity, {
      paymentId: payment.id,
      amountCents: input.amountCents,
      reason: input.reason,
      status: 'succeeded',
    });
  }
  // Refund through the provider that took the payment. Never "refund" a Stripe payment
  // through the mock: that would record money as returned when none was.
  const provider = payment.provider === 'mock' ? mockProvider : providerFor(s.ctx.environment);
  if (provider.name !== payment.provider) {
    throw new ValidationError(
      `This payment was taken with ${payment.provider}, which is not the active payment provider. Ask the tech team.`,
    );
  }
  const result = await provider.refund({
    providerRef: payment.providerRef ?? '',
    amountCents: input.amountCents,
    idempotencyKey: `${payment.id}:refund:${already}:${input.amountCents}`,
  });
  return createRecord(s, refundEntity, {
    paymentId: payment.id,
    amountCents: input.amountCents,
    reason: result.ok ? input.reason : `${input.reason} — FAILED: ${result.failureReason}`,
    status: result.ok ? 'succeeded' : 'failed',
    providerRef: result.ok ? result.providerRef : null,
  });
}
