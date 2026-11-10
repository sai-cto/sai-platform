/**
 * Stripe adapter — TEST MODE ONLY.
 *
 * It refuses to start with anything but a Stripe TEST key (sk_test_...), so this code
 * cannot move real money. The key comes from STRIPE_SECRET_KEY in .env.local and is never
 * stored in the database or the repository.
 *
 * Not yet exercised against Stripe itself (no test key exists yet): see docs/HANDOFF.md.
 */
import Stripe from 'stripe';
import type { PaymentProvider } from './provider';

/** The few Stripe calls we use. Declared so tests can pass a fake. */
export type StripeLike = {
  paymentIntents: {
    create(
      params: Stripe.PaymentIntentCreateParams,
      options: { idempotencyKey: string },
    ): Promise<{ id: string; status: string; last_payment_error?: { message?: string } | null }>;
  };
  refunds: {
    create(
      params: Stripe.RefundCreateParams,
      options: { idempotencyKey: string },
    ): Promise<{ id: string; status: string | null }>;
  };
};

export function assertTestKey(key: string | undefined): string {
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set.');
  if (!key.startsWith('sk_test_')) {
    throw new Error(
      'Refusing to start: STRIPE_SECRET_KEY is not a Stripe TEST key. Only test-mode keys are allowed.',
    );
  }
  return key;
}

export function createStripeProvider(client?: StripeLike): PaymentProvider {
  const stripe: StripeLike = client ?? new Stripe(assertTestKey(process.env.STRIPE_SECRET_KEY));
  return {
    name: 'stripe',
    async charge(request) {
      try {
        const intent = await stripe.paymentIntents.create(
          {
            amount: request.amountCents,
            currency: request.currency,
            description: request.description,
            payment_method: request.paymentMethodToken,
            confirm: true,
            capture_method: request.kind === 'authorization' ? 'manual' : 'automatic',
            automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
          },
          { idempotencyKey: request.idempotencyKey },
        );
        const ok = intent.status === 'succeeded' || intent.status === 'requires_capture';
        if (!ok)
          return {
            ok: false,
            failureReason:
              intent.last_payment_error?.message ?? `Payment not completed (${intent.status}).`,
          };
        return { ok: true, providerRef: intent.id };
      } catch (error) {
        return {
          ok: false,
          failureReason: error instanceof Error ? error.message : 'Payment failed.',
        };
      }
    },
    async refund(request) {
      try {
        const refund = await stripe.refunds.create(
          { payment_intent: request.providerRef, amount: request.amountCents },
          { idempotencyKey: request.idempotencyKey },
        );
        if (refund.status === 'failed' || refund.status === 'canceled')
          return { ok: false, failureReason: `Refund ${refund.status}.` };
        return { ok: true, providerRef: refund.id };
      } catch (error) {
        return {
          ok: false,
          failureReason: error instanceof Error ? error.message : 'Refund failed.',
        };
      }
    },
  };
}
