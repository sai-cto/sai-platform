/** The order page's "Charges and payments" card. */
import { can } from '@/core/rbac/permissions';
import type { BusinessContext } from '@/core/tenancy/context';
import { ActionForm } from '@/ui/action-form';
import { Badge } from '@/ui/badge';
import { ConfirmButton } from '@/ui/confirm-button';
import { formatDateTime, formatMoney } from '@/ui/format';
import { Card, EmptyState, Field, Table, Td, Th, inputClass } from '@/ui/layout';
import {
  addChargeAction,
  payOrderAction,
  recalculateAction,
  refundAction,
  removeChargeAction,
} from '../../actions';
import { CORE, P } from '../../permissions';
import { isOrderActive, maxDiscountCents, subtotalCents } from '../../rules';
import type { brssProducts } from '../../schema';
import type { BrssSettings } from '../../settings';
import type { OrderDetail } from '../../services/orders';
import { PaymentForm } from '../forms/payment-form';
import { Select, Warning } from '../parts';
import { Disclosure } from '../disclosure';

export function ChargesCard({
  ctx,
  detail,
  settings,
  problems,
  products,
  idempotencyKey,
}: {
  ctx: BusinessContext;
  detail: OrderDetail;
  settings: BrssSettings;
  problems: string[];
  products: (typeof brssProducts.$inferSelect)[];
  idempotencyKey: string;
}) {
  const { order, items, payments, refunds } = detail;
  const slug = ctx.business.slug;
  const mode = ctx.environment;
  const active = isOrderActive(order.status);
  const canWrite = active && can(ctx, P.ordersWrite);
  const canPay = canWrite && can(ctx, CORE.paymentsWrite);
  const unpaid = items.filter((item) => item.status === 'new');
  const unpaidCents = subtotalCents(unpaid);
  const paidCents = subtotalCents(items.filter((item) => item.status === 'paid'));
  const extras = products.filter(
    (p) => p.isActive && (p.kind === 'supply' || p.kind === 'packing' || p.kind === 'fee'),
  );

  return (
    <Card
      title="Charges and payments"
      description="Storage, shipping and insurance are worked out from the articles. Supplies, packing and fees are added by hand."
      actions={
        canWrite ? (
          <ConfirmButton action={recalculateAction.bind(null, slug, mode, order.id)}>
            Work out charges again
          </ConfirmButton>
        ) : null
      }
      flush
    >
      {problems.length > 0 ? (
        <div className="p-4 pb-0">
          <Warning title="Some charges could not be worked out, so they are not on this order yet">
            <ul className="list-disc pl-5">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Warning>
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState title="No charges yet">
          Charges appear when articles are taken in, or when you add one below.
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="w-full">Charge</Th>
              <Th className="text-right">Qty</Th>
              <Th className="text-right">Each</Th>
              <Th className="text-right">Amount</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <Td className="min-w-56">{item.description}</Td>
                <Td className="text-right tabular-nums">{item.quantity}</Td>
                <Td className="text-right tabular-nums">{formatMoney(item.unitPriceCents)}</Td>
                <Td className="text-right tabular-nums">
                  {formatMoney(item.unitPriceCents * item.quantity)}
                </Td>
                <Td>
                  {item.status === 'paid' ? (
                    <Badge tone="green">Paid</Badge>
                  ) : (
                    <Badge tone="amber">To pay</Badge>
                  )}
                </Td>
                <Td>
                  {canWrite && item.status === 'new' && item.rule === null ? (
                    <ConfirmButton
                      action={removeChargeAction.bind(null, slug, mode, item.id)}
                      confirmTitle="Remove this charge?"
                      confirmBody={item.description}
                      confirmLabel="Remove"
                    >
                      Remove
                    </ConfirmButton>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {items.length > 0 ? (
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 border-t border-zinc-200 px-4 py-3 text-sm sm:ml-auto sm:max-w-sm">
          <dt className="text-zinc-600">Paid so far (before tax, tip and discount)</dt>
          <dd className="text-right tabular-nums">{formatMoney(paidCents)}</dd>
          <dt className="font-medium text-zinc-900">Still to pay (before tax)</dt>
          <dd className="text-right font-semibold text-zinc-900 tabular-nums">
            {formatMoney(unpaidCents)}
          </dd>
        </dl>
      ) : null}

      {order.discountCents + order.tipCents + order.taxCents > 0 ? (
        <p className="border-t border-zinc-200 px-4 py-2 text-xs text-zinc-500">
          Applied at payment so far: tax {formatMoney(order.taxCents)} · tip{' '}
          {formatMoney(order.tipCents)} · discount {formatMoney(order.discountCents)}
        </p>
      ) : null}

      {canWrite && extras.length > 0 ? (
        <Disclosure summary="Add supplies, packing or a fee">
          <ActionForm
            action={addChargeAction.bind(null, slug, mode, order.id)}
            submitLabel="Add charge"
          >
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Product" htmlFor="charge-product" className="sm:col-span-2">
                <Select id="charge-product" name="productId">
                  {extras.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} · {formatMoney(product.unitPriceCents)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Quantity" htmlFor="charge-quantity">
                <input
                  id="charge-quantity"
                  name="quantity"
                  type="number"
                  min="1"
                  max="999"
                  defaultValue="1"
                  className={inputClass}
                />
              </Field>
              <Field
                label="Price each (dollars)"
                htmlFor="charge-price"
                help="Empty = the list price."
              >
                <input id="charge-price" name="price" inputMode="decimal" className={inputClass} />
              </Field>
            </div>
            <Field
              label="Description"
              htmlFor="charge-description"
              help="Empty = the product's name."
            >
              <input
                id="charge-description"
                name="description"
                maxLength={200}
                className={inputClass}
              />
            </Field>
          </ActionForm>
        </Disclosure>
      ) : null}

      {canPay && unpaid.length > 0 ? (
        <div className="border-t border-zinc-200 p-4">
          <h3 className="mb-3 text-sm font-semibold text-zinc-900">Take payment</h3>
          <PaymentForm
            action={payOrderAction.bind(null, slug, mode, order.id)}
            unpaidCents={unpaidCents}
            taxPercent={settings.taxPercent}
            maxDiscountCents={maxDiscountCents(
              unpaidCents,
              can(ctx, P.discountAny),
              settings.maxStaffDiscountPercent,
            )}
            idempotencyKey={idempotencyKey}
            hasUnpriced={problems.length > 0}
          />
        </div>
      ) : null}
      {active && unpaid.length > 0 && !canPay ? (
        <p className="border-t border-zinc-200 px-4 py-3 text-sm text-zinc-500">
          Taking payment needs the &quot;Process orders&quot; and &quot;Take payments and issue
          refunds&quot; permissions.
        </p>
      ) : null}

      <div className="border-t border-zinc-200">
        <h3 className="px-4 pt-3 text-sm font-semibold text-zinc-900">Payments</h3>
        {payments === null ? (
          <p className="px-4 py-3 text-sm text-zinc-500">
            You do not have permission to see payments.
          </p>
        ) : payments.length === 0 ? (
          <p className="px-4 py-3 text-sm text-zinc-500">No payments yet.</p>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>How</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="text-right">Refunded</Th>
                  <Th className="w-full">Result</Th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(payment.createdAt)}</Td>
                    <Td className="whitespace-nowrap capitalize">
                      {payment.method}
                      {payment.cardLast4 ? ` ···· ${payment.cardLast4}` : ''}
                    </Td>
                    <Td className="text-right tabular-nums">{formatMoney(payment.amountCents)}</Td>
                    <Td className="text-right tabular-nums">
                      {payment.refundedCents > 0 ? formatMoney(payment.refundedCents) : '—'}
                    </Td>
                    <Td>
                      {payment.status === 'succeeded' ? (
                        <Badge tone="green">Paid</Badge>
                      ) : (
                        <>
                          <Badge tone="red">Failed</Badge>{' '}
                          <span className="text-xs text-zinc-500">{payment.failureReason}</span>
                        </>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {refunds.length > 0 ? (
              <ul className="space-y-1 px-4 py-2 text-xs text-zinc-600">
                {refunds.map((refund) => (
                  <li key={refund.id}>
                    Refund of {formatMoney(refund.amountCents)} on{' '}
                    {formatDateTime(refund.createdAt)}
                    {refund.status === 'failed' ? ' (failed)' : ''}: {refund.reason}
                  </li>
                ))}
              </ul>
            ) : null}
            {can(ctx, P.ordersWrite) && can(ctx, CORE.paymentsWrite)
              ? payments
                  .filter((p) => p.status === 'succeeded' && p.refundedCents < p.amountCents)
                  .map((payment) => (
                    <Disclosure
                      key={payment.id}
                      summary={`Refund the ${formatMoney(payment.amountCents)} payment of ${formatDateTime(payment.createdAt)}`}
                    >
                      <ActionForm
                        action={refundAction.bind(null, slug, mode, order.id, payment.id)}
                        submitLabel="Send refund"
                        submitVariant="danger"
                      >
                        <div className="grid gap-3 sm:grid-cols-3">
                          <Field
                            label="Amount (dollars)"
                            htmlFor={`refund-amount-${payment.id}`}
                            help={`Up to ${formatMoney(payment.amountCents - payment.refundedCents)}.`}
                          >
                            <input
                              id={`refund-amount-${payment.id}`}
                              name="amount"
                              inputMode="decimal"
                              required
                              className={inputClass}
                            />
                          </Field>
                          <Field
                            label="Reason"
                            htmlFor={`refund-reason-${payment.id}`}
                            className="sm:col-span-2"
                          >
                            <input
                              id={`refund-reason-${payment.id}`}
                              name="reason"
                              required
                              maxLength={300}
                              className={inputClass}
                            />
                          </Field>
                        </div>
                      </ActionForm>
                    </Disclosure>
                  ))
              : null}
          </>
        )}
      </div>
    </Card>
  );
}
