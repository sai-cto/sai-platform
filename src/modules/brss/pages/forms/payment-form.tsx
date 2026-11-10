'use client';

/**
 * The payment form. A client component so the tax and total update while the discount and
 * tip are typed. The server works the amounts out again; this is only the display.
 */
import { useState } from 'react';
import { ActionForm, type ActionResult } from '@/ui/action-form';
import { Field, inputClass } from '@/ui/layout';
import { computeTotals, dollarsToCents } from '../../rules';

const money = (cents: number) =>
  `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PaymentForm({
  action,
  unpaidCents,
  taxPercent,
  maxDiscountCents,
  idempotencyKey,
  hasUnpriced,
}: {
  action: (previous: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  unpaidCents: number;
  taxPercent: number;
  /** The largest discount this person may give on this payment. */
  maxDiscountCents: number;
  /** Made by the server for this one form, so pressing twice cannot charge twice. */
  idempotencyKey: string;
  /** Some charges could not be priced: the person must tick a box to go ahead without them. */
  hasUnpriced: boolean;
}) {
  const [discount, setDiscount] = useState('');
  const [tip, setTip] = useState('');
  const [method, setMethod] = useState('card');
  const discountCents = dollarsToCents(discount || '0') ?? 0;
  const tipCents = dollarsToCents(tip || '0') ?? 0;
  const totals = computeTotals({ subtotalCents: unpaidCents, discountCents, tipCents, taxPercent });
  const tooMuch = discountCents > maxDiscountCents;

  return (
    <ActionForm
      action={action}
      submitLabel={totals.totalCents > 0 ? `Take payment of ${money(totals.totalCents)}` : 'Mark as paid'}
    >
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label="Discount (dollars)"
          htmlFor="pay-discount"
          help={`You can give up to ${money(maxDiscountCents)}.`}
        >
          <input
            id="pay-discount"
            name="discount"
            inputMode="decimal"
            placeholder="0.00"
            value={discount}
            onChange={(event) => setDiscount(event.target.value)}
            aria-invalid={tooMuch}
            className={inputClass}
          />
        </Field>
        <Field label="Tip (dollars)" htmlFor="pay-tip" help="Tips are not taxed.">
          <input
            id="pay-tip"
            name="tip"
            inputMode="decimal"
            placeholder="0.00"
            value={tip}
            onChange={(event) => setTip(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Paying by" htmlFor="pay-method">
          <select
            id="pay-method"
            name="method"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            className={inputClass}
          >
            <option value="card">Card</option>
            <option value="cash">Cash</option>
            <option value="check">Check</option>
          </select>
        </Field>
      </div>
      {method === 'card' ? (
        <Field
          label="Test card"
          htmlFor="pay-card"
          help="No card company is connected yet, so no real card can be charged. These two test cards show what happens when a card is approved or declined."
          className="sm:max-w-sm"
        >
          <select id="pay-card" name="cardToken" className={inputClass}>
            <option value="mock_ok">Test card that is approved</option>
            <option value="mock_declined">Test card that is declined</option>
          </select>
        </Field>
      ) : null}
      {hasUnpriced ? (
        <label className="flex items-start gap-2 text-sm text-amber-900">
          <input type="checkbox" name="acceptUnpriced" className="mt-0.5 size-4 rounded border-zinc-300" />
          Take payment without the charges that could not be worked out (listed above)
        </label>
      ) : null}
      <dl className="grid max-w-xs grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-zinc-600">Charges to pay</dt>
        <dd className="text-right tabular-nums">{money(totals.subtotalCents)}</dd>
        <dt className="text-zinc-600">Discount</dt>
        <dd className="text-right tabular-nums">{money(-totals.discountCents)}</dd>
        <dt className="text-zinc-600">Tax ({taxPercent}%)</dt>
        <dd className="text-right tabular-nums">{money(totals.taxCents)}</dd>
        <dt className="text-zinc-600">Tip</dt>
        <dd className="text-right tabular-nums">{money(totals.tipCents)}</dd>
        <dt className="font-semibold text-zinc-900">Total</dt>
        <dd className="text-right font-semibold text-zinc-900 tabular-nums">
          {money(totals.totalCents)}
        </dd>
      </dl>
      {tooMuch ? (
        <p role="alert" className="text-sm text-red-700">
          That discount is more than you can give ({money(maxDiscountCents)}).
        </p>
      ) : null}
    </ActionForm>
  );
}
