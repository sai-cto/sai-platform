'use client';

/**
 * The article intake form. It is a client component because the fields depend on the kind
 * of article chosen, and because the billable weight is shown while the sizes are typed.
 * The server works everything out again when the form is saved; this is only the display.
 */
import { useState } from 'react';
import { ActionForm, type ActionResult } from '@/ui/action-form';
import { Button } from '@/ui/button';
import { Field, inputClass } from '@/ui/layout';
import { ARTICLE_TYPES, INSURANCE_OPTIONS_CENTS, billableWeight, labelOf } from '../../rules';
import type { ArticleType } from '../../schema';

export type IntakeProduct = {
  id: string;
  name: string;
  kind: string;
  role: string | null;
  unitPriceCents: number;
};

export type IntakeValues = {
  type: ArticleType;
  description: string;
  weightLb: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  productId: string;
  insuranceCents: number;
  otherStoragePrice: string;
  cornellShippingAccount: boolean;
  receivedFromZip: string;
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function IntakeForm({
  action,
  types,
  products,
  toCornell,
  divisor,
  maxBillableLb,
  initial,
  submitLabel,
}: {
  action: (previous: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  /** The kinds of article this order accepts. */
  types: ArticleType[];
  products: IntakeProduct[];
  /** A ship-to-Cornell order asks which shipping account each box came on. */
  toCornell: boolean;
  divisor: number;
  maxBillableLb: number;
  /** Present when correcting an existing article. */
  initial?: IntakeValues;
  submitLabel: string;
}) {
  const [type, setType] = useState<ArticleType>(initial?.type ?? types[0]);
  const [size, setSize] = useState({
    lengthIn: initial?.lengthIn || 0,
    widthIn: initial?.widthIn || 0,
    heightIn: initial?.heightIn || 0,
    weightLb: initial?.weightLb || 0,
  });
  const [onCornellAccount, setOnCornellAccount] = useState(
    initial?.cornellShippingAccount ?? toCornell,
  );
  const [productId, setProductId] = useState(initial?.productId ?? '');

  const sized = type === 'standard_box' && (!toCornell || onCornellAccount);
  const choices = products.filter((p) =>
    type === 'non_boxed' ? p.kind === 'storage_item' : p.kind === 'flat_rate_box',
  );
  const isOther = choices.find((p) => p.id === productId)?.role === 'other_non_boxed';
  const rounded = {
    lengthIn: Math.ceil(size.lengthIn),
    widthIn: Math.ceil(size.widthIn),
    heightIn: Math.ceil(size.heightIn),
    weightLb: Math.ceil(size.weightLb),
  };
  const complete = Object.values(rounded).every((value) => value > 0);
  const billable = complete ? billableWeight(rounded, divisor) : null;
  const sizeInput = (key: keyof typeof size, label: string) => (
    <Field label={label} htmlFor={`intake-${key}`}>
      <input
        id={`intake-${key}`}
        name={key}
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        required
        value={size[key] || ''}
        onChange={(event) => setSize({ ...size, [key]: Number(event.target.value) })}
        className={inputClass}
      />
    </Field>
  );

  return (
    <ActionForm action={action} submitLabel={submitLabel} resetOnSuccess={!initial}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind of article" htmlFor="intake-type">
          <select
            id="intake-type"
            name="type"
            value={type}
            onChange={(event) => {
              setType(event.target.value as ArticleType);
              setProductId('');
            }}
            className={inputClass}
          >
            {types.map((key) => (
              <option key={key} value={key}>
                {labelOf(ARTICLE_TYPES, key)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description" htmlFor="intake-description">
          <input
            id="intake-description"
            name="description"
            maxLength={200}
            defaultValue={initial?.description}
            placeholder="Winter clothes, desk lamp…"
            className={inputClass}
          />
        </Field>
      </div>

      {toCornell && type === 'standard_box' ? (
        <label className="flex items-center gap-2 text-sm text-zinc-800">
          <input
            type="checkbox"
            name="cornellShippingAccount"
            checked={onCornellAccount}
            onChange={(event) => setOnCornellAccount(event.target.checked)}
            className="size-4 rounded border-zinc-300"
          />
          Sent on the Cornell shipping account (untick for a third-party shipper)
        </label>
      ) : null}

      {sized ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {sizeInput('lengthIn', 'Length (in)')}
            {sizeInput('widthIn', 'Width (in)')}
            {sizeInput('heightIn', 'Height (in)')}
            {sizeInput('weightLb', 'Weight (lb)')}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setSize({ ...size, lengthIn: 18, widthIn: 18, heightIn: 18 })}
            >
              Large box (18 × 18 × 18)
            </Button>
            <span
              className={
                billable !== null && (billable < 1 || billable > maxBillableLb)
                  ? 'text-red-700'
                  : 'text-zinc-600'
              }
            >
              Billable weight:{' '}
              <strong className="tabular-nums">{billable === null ? '—' : `${billable} lb`}</strong>
              {billable !== null && billable > maxBillableLb
                ? ` (the most we accept is ${maxBillableLb} lb)`
                : ''}
            </span>
          </div>
          {toCornell ? (
            <Field
              label="Zip the box was sent from"
              htmlFor="intake-zip"
              help="Used to price the shipping."
              className="sm:max-w-xs"
            >
              <input
                id="intake-zip"
                name="receivedFromZip"
                inputMode="numeric"
                maxLength={10}
                required
                defaultValue={initial?.receivedFromZip}
                className={inputClass}
              />
            </Field>
          ) : null}
        </>
      ) : null}

      {type !== 'standard_box' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={type === 'non_boxed' ? 'What kind of item' : 'Flat rate box'}
            htmlFor="intake-product"
          >
            <select
              id="intake-product"
              name="productId"
              required
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              className={inputClass}
            >
              <option value="">Choose…</option>
              {choices.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                  {product.role === 'other_non_boxed'
                    ? ''
                    : ` · ${money(product.unitPriceCents)} a month`}
                </option>
              ))}
            </select>
          </Field>
          {type === 'flat_rate_box' && !initial ? (
            <Field label="How many" htmlFor="intake-quantity" help="Each box becomes its own article.">
              <input
                id="intake-quantity"
                name="quantity"
                type="number"
                min="1"
                max="50"
                defaultValue="1"
                className={inputClass}
              />
            </Field>
          ) : null}
          {isOther ? (
            <Field label="Storage price a month (dollars)" htmlFor="intake-other-price">
              <input
                id="intake-other-price"
                name="otherStoragePrice"
                inputMode="decimal"
                required
                defaultValue={initial?.otherStoragePrice}
                className={inputClass}
              />
            </Field>
          ) : null}
        </div>
      ) : null}

      <Field
        label="Extra insurance (declared value)"
        htmlFor="intake-insurance"
        className="sm:max-w-xs"
      >
        <select
          id="intake-insurance"
          name="insurance"
          defaultValue={String((initial?.insuranceCents ?? 0) / 100)}
          className={inputClass}
        >
          {INSURANCE_OPTIONS_CENTS.map((cents) => (
            <option key={cents} value={cents / 100}>
              {cents === 0 ? 'None' : `$${(cents / 100).toLocaleString('en-US')}`}
            </option>
          ))}
        </select>
      </Field>
    </ActionForm>
  );
}
