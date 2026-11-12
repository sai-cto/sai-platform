/**
 * Taking payments and issuing refunds.
 *
 * Order of events (this is deliberate — see docs/DECISIONS.md, P1-8):
 *   1. ask the provider to charge, with an idempotency key;
 *   2. write the payment row in the caller's transaction, together with whatever the
 *      caller marks as paid.
 * If the transaction fails after step 1, retrying with the same key returns the same
 * charge, so nobody is charged twice and nothing is ever "paid" without a payment row.
 */
import { and, eq, sql } from 'drizzle-orm';
import { payments, refunds } from '../db/schema';
import { txOf, type Scope } from '../db/scope';
import { NotFoundError, ValidationError } from '../errors';
import { isUuid } from '../ids';
import { authorize } from '../rbac/permissions';
import { customers } from '../db/schema';
import { paymentEntity, refundEntity } from '../records/core-entities';
import { createRecord, updateRecord } from '../records/records';
import type { Row } from '../records/types';
import { isDemoMode } from '../demo/demo';
import { isPilotMode } from '../demo/pilot';
import { mockProvider } from './mock-provider';
import type { PaymentProvider } from './provider';
import { createStripeProvider } from './stripe-provider';

let stripeProvider: PaymentProvider | undefined;

/** The sandbox ALWAYS uses the mock provider, whatever is configured. */
export function providerFor(environment: 'live' | 'sandbox'): PaymentProvider {
  // The sandbox and the hosted demo site ALWAYS use the mock provider.
  if (environment === 'sandbox' || isDemoMode()) return mockProvider;
  if (process.env.PAYMENT_PROVIDER === 'stripe') {
    stripeProvider ??= createStripeProvider();
    return stripeProvider;
  }
  return mockProvider;
}

/** True if any of the texts holds a character the database cannot store (the NUL byte). */
function hasControlCharacters(...texts: (string | undefined)[]): boolean {
  return texts.some((text) => text !== undefined && text.includes('\u0000'));
}

/** The most one payment may be: $1,000,000. Far above anything real; well inside what the database can store. */
export const MAX_PAYMENT_CENTS = 100_000_000;

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
  /**
   * Money already taken outside the platform (cash, a check, a card through another system such
   * as Shopify): recorded as it is, never sent to a card processor, whatever the method.
   */
  recordOnly?: boolean;
  /** When a recorded payment was received (default now). Only with recordOnly; never in the future. */
  paidAt?: Date;
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
  // Everything the database could refuse is checked here, BEFORE the card is charged.
  if (input.amountCents > MAX_PAYMENT_CENTS)
    throw new ValidationError('That amount is too large for a single payment.');
  if (input.customerId != null && !isUuid(input.customerId))
    throw new ValidationError('A linked record does not exist in this business.');
  if (input.subjectId !== undefined && !isUuid(input.subjectId))
    throw new ValidationError('A linked record does not exist in this business.');
  if (input.idempotencyKey.length > 200 || input.description.length > 1000)
    throw new ValidationError('The payment description or key is too long.');
  if (hasControlCharacters(input.description, input.idempotencyKey, input.subjectType))
    throw new ValidationError('The payment text contains characters that cannot be stored.');

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
  if (input.paidAt !== undefined) {
    if (!input.recordOnly) throw new ValidationError('Only a recorded payment can carry its own date.');
    if (Number.isNaN(input.paidAt.getTime()) || input.paidAt.getTime() > Date.now() + 60_000)
      throw new ValidationError('The payment date cannot be in the future.');
  }
  // Pilot (real data, not yet live): no card processor is connected, so a live card payment
  // would only pretend. Refused before anything is recorded. Test mode still uses test cards.
  // (A card payment taken elsewhere and only recorded here is fine.)
  if (isPilotMode() && method === 'card' && !input.recordOnly && s.ctx.environment === 'live')
    throw new ValidationError('Card payments are not connected yet. Record a cash or check payment instead.');
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

  // Cash, cheque, other offline payments and anything taken outside the platform are simply recorded.
  if (method !== 'card' || input.recordOnly) {
    return createRecord(s, paymentEntity, {
      ...common,
      status: 'succeeded',
      provider: 'manual',
      paidAt: input.paidAt ?? new Date(),
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
 * How much of a payment has already been refunded. Read from the running total kept on the
 * payment itself, so archiving — or permanently deleting — a refund row can never make the
 * money refundable again.
 */
export async function refundedCents(s: Scope, paymentId: string): Promise<number> {
  authorize(s.ctx, 'payments.read');
  if (!isUuid(paymentId)) return 0;
  const [row] = await s.db
    .select({ total: payments.refundedCents })
    .from(payments)
    .where(and(s.where(payments, 'include'), eq(payments.id, paymentId)))
    .limit(1);
  return row?.total ?? 0;
}

export async function refundPayment(
  s: Scope,
  input: { paymentId: string; amountCents: number; reason: string },
): Promise<Row<typeof refunds>> {
  // Permission and input first: nobody without payments.write can reach the provider.
  authorize(s.ctx, 'payments.write');
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0)
    throw new ValidationError('The refund must be more than zero.');
  if (!isUuid(input.paymentId)) throw new NotFoundError();
  if (input.reason.length > 500 || hasControlCharacters(input.reason))
    throw new ValidationError(
      'The refund reason is too long or contains characters that cannot be stored.',
    );

  // Load AND lock the payment in one step, so two refunds at the same moment cannot both
  // see "nothing refunded yet" and together give back more than was paid.
  const [payment] = await txOf(s)
    .select()
    .from(payments)
    .where(and(s.where(payments), eq(payments.id, input.paymentId)))
    .for('update');
  if (!payment) throw new NotFoundError();
  if (payment.status !== 'succeeded' || payment.kind !== 'charge')
    throw new ValidationError('Only a completed charge can be refunded.');
  const already = payment.refundedCents;
  if (already + input.amountCents > payment.amountCents) {
    throw new ValidationError(
      `Only ${((payment.amountCents - already) / 100).toFixed(2)} is left to refund on this payment.`,
    );
  }

  let providerRef: string | null = null;
  let failure: string | null = null;
  if (payment.provider !== 'manual') {
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
    if (result.ok) providerRef = result.providerRef;
    else failure = result.failureReason;
  }

  if (failure === null) {
    await updateRecord(s, paymentEntity, payment.id, {
      refundedCents: already + input.amountCents,
    });
  }
  return createRecord(s, refundEntity, {
    paymentId: payment.id,
    amountCents: input.amountCents,
    reason: failure === null ? input.reason : `${input.reason} — FAILED: ${failure}`,
    status: failure === null ? 'succeeded' : 'failed',
    providerRef,
  });
}
