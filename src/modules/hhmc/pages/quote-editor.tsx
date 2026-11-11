'use client';

/**
 * The Quote editor's interactive part, rendered from the server Job page. It shows the lines
 * by section with live totals while a new line is typed (and when the tax / card-fee boxes
 * change). The server prices everything again when it saves; this is only the display.
 */
import { useState } from 'react';
import { ActionForm, type ActionResult } from '@/ui/action-form';
import { ConfirmButton } from '@/ui/confirm-button';
import { Field, inputClass } from '@/ui/layout';
import {
  computeDeposit,
  computeTotals,
  formatQty,
  lineTotalCents,
  parseMoney,
  parseQty,
  SECTIONS,
  type PriceLine,
  type SectionKey,
} from '../services/pricing';

type Action = (previous: ActionResult | null, formData: FormData) => Promise<ActionResult>;

export type EditorLine = PriceLine & { id: string; name: string; unit: string; description: string | null };
export type EditorItem = { id: string; name: string; section: SectionKey; unit: string; rateCents: number; category: string };

const usd = (cents: number) =>
  `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (bp: number) => `${bp / 100}%`;

export function QuoteEditor({
  lines,
  catalog,
  options,
  editable,
  addLine,
  removeLine,
  saveOptions,
}: {
  lines: EditorLine[];
  catalog: EditorItem[];
  options: { serviceTaxOn: boolean; convenienceFeeOn: boolean; serviceTaxBp: number; convenienceFeeBp: number; depositBp: number };
  editable: boolean;
  addLine: Action;
  /** One bound server action per line id (functions cannot cross to the browser otherwise). */
  removeLine: Record<string, () => Promise<ActionResult>> | null;
  saveOptions: Action;
}) {
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('');
  const [rate, setRate] = useState('');
  const [section, setSection] = useState<SectionKey>('transportation_labor');
  const [discountType, setDiscountType] = useState('');
  const [discount, setDiscount] = useState('');
  const [taxOn, setTaxOn] = useState(options.serviceTaxOn);
  const [feeOn, setFeeOn] = useState(options.convenienceFeeOn);

  const item = catalog.find((c) => c.id === itemId);
  const draftQty = parseQty(qty || '0');
  const draftRate = rate ? parseMoney(rate) : (item?.rateCents ?? null);
  const draftDiscount = discountType ? (discountType === 'percent' ? parseQty(discount || '0') : parseMoney(discount || '0')) : null;
  const draft: PriceLine | null =
    draftQty && draftRate !== null
      ? { section: item?.section ?? section, qtyHundredths: draftQty, rateCents: draftRate, discountType: (discountType || null) as PriceLine['discountType'], discountValue: draftDiscount }
      : null;
  const priced = { ...options, serviceTaxOn: taxOn, convenienceFeeOn: feeOn };
  const totals = computeTotals(draft ? [...lines, draft] : lines, priced);
  const deposit = computeDeposit(totals, options.depositBp, { byCard: feeOn, convenienceFeeBp: options.convenienceFeeBp });

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="text-xs text-zinc-500">
              <th className="border-b border-zinc-200 px-3 py-2 font-medium">Item</th>
              <th className="border-b border-zinc-200 px-3 py-2 text-right font-medium">Qty</th>
              <th className="border-b border-zinc-200 px-3 py-2 text-right font-medium">Rate</th>
              <th className="border-b border-zinc-200 px-3 py-2 text-right font-medium">Total</th>
              {editable && removeLine ? <th className="relative border-b border-zinc-200 px-3 py-2"><span className="sr-only">Remove</span></th> : null}
            </tr>
          </thead>
          {SECTIONS.filter((sec) => lines.some((l) => l.section === sec.key)).map((sec) => (
            <tbody key={sec.key}>
              <tr>
                <td colSpan={5} className="bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-700">{sec.label}</td>
              </tr>
              {lines
                .filter((l) => l.section === sec.key)
                .map((l) => (
                  <tr key={l.id}>
                    <td className="border-b border-zinc-100 px-3 py-2">
                      {l.name}
                      {l.discountType && l.discountValue ? (
                        <span className="ml-1 text-xs text-emerald-700">−{l.discountType === 'percent' ? pct(l.discountValue) : usd(l.discountValue)}</span>
                      ) : null}
                      {l.description ? <span className="block text-xs text-zinc-500">{l.description}</span> : null}
                    </td>
                    <td className="border-b border-zinc-100 px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatQty(l.qtyHundredths)} {l.unit}</td>
                    <td className="border-b border-zinc-100 px-3 py-2 text-right tabular-nums">{usd(l.rateCents)}</td>
                    <td className="border-b border-zinc-100 px-3 py-2 text-right tabular-nums">{usd(lineTotalCents(l))}</td>
                    {editable && removeLine ? (
                      <td className="border-b border-zinc-100 px-3 py-2 text-right">
                        <ConfirmButton action={removeLine[l.id]} variant="ghost" title={`Remove ${l.name}`}>Remove</ConfirmButton>
                      </td>
                    ) : null}
                  </tr>
                ))}
              <tr>
                <td colSpan={3} className="px-3 py-1.5 text-right text-xs text-zinc-500">{sec.label} total</td>
                <td className="px-3 py-1.5 text-right text-xs font-medium tabular-nums">{usd(totals.sections[sec.key] - (draft && draft.section === sec.key ? lineTotalCents(draft) : 0))}</td>
              </tr>
            </tbody>
          ))}
        </table>
        {lines.length === 0 ? <p className="px-3 py-4 text-sm text-zinc-500">No lines yet.</p> : null}
      </div>

      {editable ? (
        <div className="border-t border-zinc-200 p-4">
          <ActionForm
            action={addLine}
            submitLabel="Add line"
            onSuccess={() => {
              setItemId('');
              setQty('');
              setRate('');
              setDiscountType('');
              setDiscount('');
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <Field label="Item" htmlFor="ql-item" className="lg:col-span-2">
                <select id="ql-item" name="catalogItemId" value={itemId} onChange={(e) => setItemId(e.target.value)} className={inputClass}>
                  <option value="">Type my own…</option>
                  {catalog.map((c) => (
                    <option key={c.id} value={c.id}>{`${c.name} · ${usd(c.rateCents)}/${c.unit}`}</option>
                  ))}
                </select>
              </Field>
              {item ? (
                <input type="hidden" name="section" value={item.section} />
              ) : (
                <>
                  <Field label="Name" htmlFor="ql-name"><input id="ql-name" name="name" className={inputClass} /></Field>
                  <Field label="Section" htmlFor="ql-section">
                    <select id="ql-section" name="section" value={section} onChange={(e) => setSection(e.target.value as SectionKey)} className={inputClass}>
                      {SECTIONS.map((sec) => <option key={sec.key} value={sec.key}>{sec.label}</option>)}
                    </select>
                  </Field>
                </>
              )}
              <Field label={`Qty${item ? ` (${item.unit})` : ''}`} htmlFor="ql-qty"><input id="ql-qty" name="qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="2.5" className={inputClass} /></Field>
              <Field label="Rate ($)" htmlFor="ql-rate"><input id="ql-rate" name="rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={item ? (item.rateCents / 100).toFixed(2) : '195'} className={inputClass} /></Field>
              <Field label="Discount" htmlFor="ql-dtype">
                <div className="flex gap-1">
                  <select id="ql-dtype" name="discountType" value={discountType} onChange={(e) => setDiscountType(e.target.value)} className={inputClass} aria-label="Discount type">
                    <option value="">None</option>
                    <option value="percent">%</option>
                    <option value="amount">$</option>
                  </select>
                  {discountType ? <input name="discount" aria-label="Discount amount" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} className={inputClass} /> : null}
                </div>
              </Field>
            </div>
            {draft ? <p className="text-xs text-zinc-600">This line: {usd(lineTotalCents(draft))}</p> : null}
          </ActionForm>
        </div>
      ) : null}

      <div className="grid gap-4 border-t border-zinc-200 p-4 sm:grid-cols-2">
        <div>
          {editable ? (
            <ActionForm action={saveOptions} submitLabel="Save options" submitVariant="secondary" resetOnSuccess={false}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="serviceTaxOn" checked={taxOn} onChange={(e) => setTaxOn(e.target.checked)} className="size-4" />
                Service tax {pct(options.serviceTaxBp)}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="convenienceFeeOn" checked={feeOn} onChange={(e) => setFeeOn(e.target.checked)} className="size-4" />
                Card convenience fee {pct(options.convenienceFeeBp)} on card payments
              </label>
            </ActionForm>
          ) : (
            <p className="text-sm text-zinc-600">
              The quote is locked. Service tax {taxOn ? 'on' : 'off'}; card fee {feeOn ? 'on' : 'off'}.
            </p>
          )}
        </div>
        <dl aria-label="Quote totals" className="space-y-1 text-sm tabular-nums">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{usd(totals.subtotalCents)}</dd></div>
          {taxOn ? <div className="flex justify-between"><dt>Service tax {pct(options.serviceTaxBp)}</dt><dd>{usd(totals.serviceTaxCents)}</dd></div> : null}
          <div className="flex justify-between border-t border-zinc-200 pt-1 font-semibold"><dt>Total (cash or check)</dt><dd data-testid="quote-total">{usd(totals.subtotalCents + totals.serviceTaxCents)}</dd></div>
          {feeOn ? (
            <div className="flex justify-between text-zinc-700"><dt>Paid by card (+{pct(options.convenienceFeeBp)} card fee)</dt><dd data-testid="quote-card-total">{usd(totals.totalCents)}</dd></div>
          ) : null}
          <div className="flex justify-between text-xs text-zinc-600">
            <dt>Deposit {pct(options.depositBp)}{feeOn ? ` (by card +${pct(options.convenienceFeeBp)})` : ''}</dt>
            <dd>{feeOn ? `${usd(deposit.depositCents)} + ${usd(deposit.cardFeeCents)} = ${usd(deposit.totalDueCents)}` : usd(deposit.depositCents)}</dd>
          </div>
          {draft ? <p className="text-xs text-amber-700">Includes the line being typed (not saved yet).</p> : null}
        </dl>
      </div>
    </div>
  );
}
