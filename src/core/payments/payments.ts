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
import { and, eq, sum } from 'drizzle-orm';
import { payments, refunds } from '../db/schema';
import type { Scope } from '../db/scope';
import { ValidationError } from '../errors';
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

/**
 * Charges (or records) a payment. Returns the payment row; check row.status.
 * A failed card attempt is recorded with status "failed" so there is a trace of it.
 */
export async function takePayment(
  s: Scope,
  input: TakePaymentInput,
): Promise<Row<typeof payments>> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0)
    throw new ValidationError('The amount must be more than zero.');
  if (!input.idempotencyKey) throw new ValidationError('A payment needs an idempotency key.');

  const [existing] = await s.db
    .select()
    .from(payments)
    .where(and(s.where(payments, 'include'), eq(payments.idempotencyKey, input.idempotencyKey)))
    .limit(1);
  if (existing) return existing;

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

/** How much of a payment has already been refunded. */
export async function refundedCents(s: Scope, paymentId: string): Promise<number> {
  const [row] = await s.db
    .select({ total: sum(refunds.amountCents) })
    .from(refunds)
    .where(
      and(s.where(refunds), eq(refunds.paymentId, paymentId), eq(refunds.status, 'succeeded')),
    );
  return Number(row?.total ?? 0);
}

export async function refundPayment(
  s: Scope,
  input: { paymentId: string; amountCents: number; reason: string },
): Promise<Row<typeof refunds>> {
  const payment = await getRecord(s, paymentEntity, input.paymentId);
  if (payment.status !== 'succeeded' || payment.kind !== 'charge')
    throw new ValidationError('Only a completed charge can be refunded.');
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0)
    throw new ValidationError('The refund must be more than zero.');
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
  const provider = payment.provider === 'stripe' ? providerFor(s.ctx.environment) : mockProvider;
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
