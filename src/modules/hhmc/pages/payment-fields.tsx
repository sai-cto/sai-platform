import { Field, inputClass } from '@/ui/layout';
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod } from '../services/manual-payment';
import { Select } from './parts';

/**
 * How a payment taken outside the software was paid: method, reference, date. Nothing here
 * charges a card: card payments are taken in Shopify and only recorded.
 */
export function ManualPaymentFields({ id, today, amountFor }: { id: string; today: string; amountFor?: (method: PaymentMethod) => string }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
      <Field label="Paid by" htmlFor={`${id}-method`}>
        <Select id={`${id}-method`} name="method" defaultValue="check">
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>{amountFor ? `${PAYMENT_METHOD_LABELS[m]} · ${amountFor(m)}` : PAYMENT_METHOD_LABELS[m]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Reference (optional)" htmlFor={`${id}-ref`} help="Check no. or Shopify order no.">
        <input id={`${id}-ref`} name="reference" maxLength={100} className={inputClass} />
      </Field>
      <Field label="Paid on" htmlFor={`${id}-date`}>
        <input id={`${id}-date`} name="paidOn" type="date" max={today} defaultValue={today} className={inputClass} />
      </Field>
    </div>
  );
}
