/**
 * Payments HHMC takes outside the software, recorded by staff (Movegistics' "Receive Payment"):
 * cash, check, card via Shopify, other. Recorded only: never sent to a card processor.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ValidationError } from '@/core/errors';
import { MOCK_DECLINED_TOKEN } from '@/core/payments/mock-provider';
import { takePayment } from '@/core/payments/payments';
import { withScope } from '@/core/db/scope';
import { bookJob } from '@/modules/hhmc/services/booking';
import { recordDeposit } from '@/modules/hhmc/services/estimates';
import { balanceOf, createInvoice, recordInvoicePayment, sendInvoice } from '@/modules/hhmc/services/invoices';
import { manualDetails } from '@/modules/hhmc/services/manual-payment';
import { gm, signedJob, tag } from './hhmc-helpers';

const NY = 'America/New_York';

describe('manual payment details', () => {
  const now = new Date('2026-06-15T16:00:00Z'); // noon in Ithaca
  it('a day in the past is recorded at noon that day; today is now; the future and nonsense are refused', () => {
    expect(manualDetails({ method: 'check', paidOn: '2026-06-10', attemptKey: 'k' }, NY, now).paidAt.toISOString()).toBe('2026-06-10T16:00:00.000Z');
    expect(manualDetails({ method: 'cash', attemptKey: 'k' }, NY, now).paidAt).toBe(now);
    expect(() => manualDetails({ method: 'cash', paidOn: '2026-06-16', attemptKey: 'k' }, NY, now)).toThrow(/future/);
    expect(() => manualDetails({ method: 'cash', paidOn: '16/06/2026', attemptKey: 'k' }, NY, now)).toThrow(ValidationError);
    expect(() => manualDetails({ method: 'bitcoin' as never, attemptKey: 'k' }, NY, now)).toThrow(/how it was paid/);
    expect(() => manualDetails({ method: 'other', reference: 'x'.repeat(101), attemptKey: 'k' }, NY, now)).toThrow(/100 characters/);
  });
});

describe('recording payments', () => {
  const was = process.env.PAYMENT_PROVIDER;
  afterEach(() => {
    process.env.PAYMENT_PROVIDER = was;
  });

  it('a deposit paid by card in Shopify is recorded, never charged; the reference and date are kept', async () => {
    const ctx = await gm();
    const { estimate } = await signedJob(ctx);
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toLocaleDateString('en-CA', { timeZone: NY });
    const result = await recordDeposit(ctx, estimate.id, { method: 'card', reference: 'Shopify #1042', paidOn: yesterday, attemptKey: `d${tag()}` });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payment).toMatchObject({ provider: 'manual', method: 'card', status: 'succeeded', providerRef: null });
    expect(result.payment.description).toContain('Card (Shopify)');
    expect(result.payment.description).toContain('ref. Shopify #1042');
    expect(result.payment.paidAt!.toLocaleDateString('en-CA', { timeZone: NY })).toBe(yesterday);
    await expect(recordDeposit(ctx, estimate.id, { method: 'cash', attemptKey: `d${tag()}` })).rejects.toThrow(/already been paid/);
  });

  it('invoice payments: check, cash, Shopify card and other, all recorded; the invoice closes when paid in full', async () => {
    const ctx = await gm();
    const { job, estimate } = await signedJob(ctx);
    await recordDeposit(ctx, estimate.id, { method: 'check', reference: '2201', attemptKey: `d${tag()}` });
    await bookJob(ctx, job.id);
    const invoice = await createInvoice(ctx, job.id);
    await sendInvoice(ctx, invoice.id);
    const balance = balanceOf(invoice);
    const quarter = Math.floor(balance / 4);
    const pay = (method: 'cash' | 'check' | 'card' | 'other', cents: number) =>
      recordInvoicePayment(ctx, invoice.id, { amount: (cents / 100).toFixed(2), method, reference: `${method} ref`, attemptKey: `i${tag()}` });
    const results = [await pay('check', quarter), await pay('cash', quarter), await pay('other', quarter)];
    const last = await pay('card', balance - 3 * quarter);
    expect(last.ok && last.invoice.status).toBe('paid');
    for (const r of [...results, last]) expect(r.ok && r.payment.provider).toBe('manual');
    // Only card pays the card fee (the invoice has it on), as before.
    expect(last.ok && last.payment.amountCents).toBeGreaterThan(balance - 3 * quarter);
  });

  it('recording never reaches a processor, even when one is configured and the token would be declined', async () => {
    process.env.PAYMENT_PROVIDER = 'stripe'; // no key here: the Stripe adapter would throw if it were called
    const ctx = await gm();
    const recorded = await withScope(ctx, 'payments.write', (s) =>
      takePayment(s, { amountCents: 1234, description: 'Recorded card', idempotencyKey: `r${tag()}`, method: 'card', paymentMethodToken: MOCK_DECLINED_TOKEN, recordOnly: true }),
    );
    expect(recorded).toMatchObject({ provider: 'manual', status: 'succeeded' });
    await expect(
      withScope(ctx, 'payments.write', (s) => takePayment(s, { amountCents: 100, description: 'x', idempotencyKey: `r${tag()}`, method: 'cash', paidAt: new Date() })),
    ).rejects.toThrow(/Only a recorded payment/);
  });
});
