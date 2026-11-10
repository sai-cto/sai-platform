/**
 * The payments interface. Business code calls takePayment()/refundPayment() in
 * payments.ts; those talk to a PaymentProvider. Swapping provider is a config change.
 *
 * Card details never reach our server: the browser gives them to the provider, and we
 * only ever see an opaque paymentMethodToken.
 */
export type ChargeRequest = {
  amountCents: number;
  currency: string;
  description: string;
  /** Same key = same charge. A retry can never charge twice. */
  idempotencyKey: string;
  /** Opaque reference to a card held by the provider. */
  paymentMethodToken?: string;
  /** authorization = place a hold without capturing. */
  kind: 'charge' | 'authorization';
};

export type ChargeResult =
  | { ok: true; providerRef: string; cardBrand?: string; cardLast4?: string }
  | { ok: false; failureReason: string };

export type RefundRequest = { providerRef: string; amountCents: number; idempotencyKey: string };
export type RefundResult = { ok: true; providerRef: string } | { ok: false; failureReason: string };

export interface PaymentProvider {
  name: 'mock' | 'stripe';
  charge(request: ChargeRequest): Promise<ChargeResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
}
