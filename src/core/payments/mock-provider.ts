/**
 * The mock payment provider: no network, no money. Used by default, and ALWAYS in the sandbox.
 * Test cards: the token "mock_declined" is declined; anything else succeeds.
 */
import crypto from 'node:crypto';
import type { PaymentProvider } from './provider';

export const MOCK_DECLINED_TOKEN = 'mock_declined';

const ref = (prefix: string, key: string) =>
  `${prefix}_${crypto.createHash('sha256').update(key).digest('hex').slice(0, 20)}`;

export const mockProvider: PaymentProvider = {
  name: 'mock',
  async charge(request) {
    if (request.paymentMethodToken === MOCK_DECLINED_TOKEN)
      return { ok: false, failureReason: 'Card declined (mock).' };
    return {
      ok: true,
      providerRef: ref('mock_ch', request.idempotencyKey),
      cardBrand: 'Visa',
      cardLast4: '4242',
    };
  },
  async refund(request) {
    return { ok: true, providerRef: ref('mock_re', request.idempotencyKey) };
  },
};
