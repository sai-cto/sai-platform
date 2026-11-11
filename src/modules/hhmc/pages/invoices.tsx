/** Invoices (ref §7.1): the list with open / past due / paid, and one invoice. */
import Link from 'next/link';
import type { PortalPageProps } from '@/core/modules/contract';
import { isPilotMode } from '@/core/demo/pilot';
import { can } from '@/core/rbac/permissions';
import { customerName } from '@/core/records/core-entities';
import { ActionForm } from '@/ui/action-form';
import { buttonClass } from '@/ui/button';
import { ConfirmButton } from '@/ui/confirm-button';
import { formatDateTime, formatMoney } from '@/ui/format';
import { Card, EmptyState, Field, PageHeader, Table, Td, Th, inputClass } from '@/ui/layout';
import { Pagination } from '@/ui/pagination';
import {
  addInvoiceLineAction,
  invoiceLinkAction,
  invoiceOptionsAction,
  invoicePaymentAction,
  removeInvoiceLineAction,
  sendInvoiceAction,
  voidInvoiceAction,
} from '../actions';
import { CORE, P } from '../permissions';
import { INVOICE_STATUS_LABELS, isPastDue, localDate, TERMS_LABELS } from '../rules';
import { INVOICE_TERMS, type InvoiceStatus } from '../schema';
import { balanceOf, cardBalanceOf, INVOICES_PAGE_SIZE, listInvoices } from '../services/invoices';
import { baseTotalCents, formatQty, lineTotalCents, SECTIONS, sectionLabel } from '../services/pricing';
import { invoicePage } from '../services/views';
import { AttemptKey } from './attempt-key';
import { CopyLinkButton } from './copy-link';
import { Disclosure } from './disclosure';
import { Check, Fact, InvoiceStatusBadge, Select, formatDay, hrefWith } from './parts';

export async function InvoicesPage({ ctx, searchParams, basePath }: PortalPageProps) {
  const choices = ['open', 'past_due', 'paid', 'all', 'draft', 'sent', 'partially_paid', 'void'] as const;
  const status = choices.find((c) => c === searchParams.status) ?? 'open';
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1);
  const { rows, total, today } = await listInvoices(ctx, { status: status as InvoiceStatus | 'open' | 'past_due' | 'all', page });
  const base = `${basePath}/invoices`;
  return (
    <>
      <PageHeader title="Invoices" description={<>Created from a job once the move is done. <Link className="underline" href={`/console/${ctx.business.slug}/${ctx.environment}/data/core.payment`}>All payments</Link></>} />
      <Card flush>
        <nav aria-label="Invoice status" className="flex flex-wrap gap-1 border-b border-zinc-200 p-2">
          {(['open', 'past_due', 'paid', 'all'] as const).map((c) => (
            <Link key={c} href={hrefWith(base, {}, { status: c === 'open' ? undefined : c })} aria-current={c === status ? 'page' : undefined} className={buttonClass({ variant: c === status ? 'primary' : 'ghost', size: 'sm' })}>
              {c === 'open' ? 'Open' : c === 'past_due' ? 'Past due' : c === 'all' ? 'All' : INVOICE_STATUS_LABELS[c]}
            </Link>
          ))}
        </nav>
        {rows.length === 0 ? (
          <EmptyState title="No invoices here." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Customer</Th>
                <Th>Date</Th>
                <Th>Due</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Balance</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ invoice, job, customer }) => (
                <tr key={invoice.id} className="hover:bg-zinc-50">
                  <Td><Link className="font-medium hover:underline" href={`${base}/${invoice.id}`}>{invoice.invoiceNumber}</Link><span className="block text-xs text-zinc-500">{job.jobNumber}</span></Td>
                  <Td>{customerName(customer)}</Td>
                  <Td className="whitespace-nowrap">{formatDay(invoice.invoiceDate)}</Td>
                  <Td className="whitespace-nowrap">{formatDay(invoice.dueDate)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(baseTotalCents(invoice))}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(Math.max(balanceOf(invoice), 0))}</Td>
                  <Td><InvoiceStatusBadge status={invoice.status} pastDue={isPastDue(invoice.status, invoice.dueDate, today)} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={INVOICES_PAGE_SIZE} total={total} hrefFor={(p) => hrefWith(base, searchParams, { page: p > 1 ? String(p) : undefined })} />
      </Card>
    </>
  );
}

export async function InvoicePage({ ctx, params, basePath }: PortalPageProps) {
  const { invoice, job, customer, lines, payments } = await invoicePage(ctx, params.id);
  const slug = ctx.business.slug;
  const mode = ctx.environment;
  const canWrite = can(ctx, P.invoicesWrite);
  const draft = invoice.status === 'draft';
  const balance = balanceOf(invoice);
  const today = localDate(new Date(), ctx.business.timeZone);
  const pct = (bp: number) => `${bp / 100}%`;

  return (
    <>
      <PageHeader
        title={`Invoice ${invoice.invoiceNumber}`}
        description={<Link href={`${basePath}/jobs/${job.id}`} className="hover:underline">{`← Job ${job.jobNumber}`}</Link>}
        actions={
          <>
            <InvoiceStatusBadge status={invoice.status} pastDue={isPastDue(invoice.status, invoice.dueDate, today)} />
            {canWrite && can(ctx, CORE.notificationsWrite) && (draft || invoice.status === 'sent' || invoice.status === 'partially_paid') ? (
              <ConfirmButton action={sendInvoiceAction.bind(null, slug, mode, invoice.id)} variant={draft ? 'primary' : 'secondary'} confirmTitle={draft ? 'Send this invoice?' : 'Send it again?'} confirmBody={`The customer gets the invoice with a link to pay ${formatMoney(Math.max(balance, 0))}.${draft ? ' A past-due reminder is queued for 8 days later.' : ''}`} confirmLabel="Send">
                {draft ? 'Send invoice' : 'Resend'}
              </ConfirmButton>
            ) : null}
            {canWrite && (invoice.status === 'sent' || invoice.status === 'partially_paid') ? (
              <CopyLinkButton action={invoiceLinkAction.bind(null, slug, mode, invoice.id)} label="Copy payment link" />
            ) : null}
            {canWrite && invoice.paidCents === 0 && (draft || invoice.status === 'sent') ? (
              <ConfirmButton action={voidInvoiceAction.bind(null, slug, mode, invoice.id)} variant="danger" confirmTitle="Void this invoice?" confirmLabel="Void">Void</ConfirmButton>
            ) : null}
          </>
        }
      />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="min-w-0 space-y-5 xl:col-span-2">
          <Card title="Bill to" flush>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 md:grid-cols-4">
              <Fact label="Customer">{customerName(customer)}<span className="block text-xs break-all text-zinc-500">{customer.email ?? 'No email'}</span></Fact>
              <Fact label="Invoice date">{formatDay(invoice.invoiceDate)}</Fact>
              <Fact label="Terms">{`${TERMS_LABELS[invoice.terms]} · due ${formatDay(invoice.dueDate)}`}</Fact>
              <Fact label="PO number">{invoice.poNumber ?? '—'}</Fact>
              {invoice.sentAt ? <Fact label="Sent">{formatDateTime(invoice.sentAt)}</Fact> : null}
              {invoice.paidAt ? <Fact label="Paid in full">{formatDateTime(invoice.paidAt)}</Fact> : null}
              {invoice.remarks ? <Fact label="Remarks">{invoice.remarks}</Fact> : null}
            </dl>
            {canWrite && draft ? (
              <Disclosure summary="Change terms and options">
                <ActionForm action={invoiceOptionsAction.bind(null, slug, mode, invoice.id)} submitLabel="Save" resetOnSuccess={false}>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Invoice date" htmlFor="io-date"><input id="io-date" name="invoiceDate" type="date" defaultValue={invoice.invoiceDate} className={inputClass} /></Field>
                    <Field label="Terms" htmlFor="io-terms">
                      <Select id="io-terms" name="terms" defaultValue={invoice.terms}>
                        {INVOICE_TERMS.map((t) => <option key={t} value={t}>{TERMS_LABELS[t]}</option>)}
                      </Select>
                    </Field>
                    <Field label="Remarks" htmlFor="io-remarks"><input id="io-remarks" name="remarks" defaultValue={invoice.remarks ?? ''} className={inputClass} /></Field>
                  </div>
                  <Check name="serviceTaxOn" label={`Service tax ${pct(invoice.serviceTaxBp)}`} defaultChecked={invoice.serviceTaxOn} />
                  <Check name="convenienceFeeOn" label={`Card convenience fee ${pct(invoice.convenienceFeeBp)} on card payments`} defaultChecked={invoice.convenienceFeeOn} />
                </ActionForm>
              </Disclosure>
            ) : null}
          </Card>

          <Card title="Lines" flush>
            <Table>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th className="text-right">Qty</Th>
                  <Th className="text-right">Rate</Th>
                  <Th className="text-right">Amount</Th>
                  {canWrite && draft ? <Th className="relative"><span className="sr-only">Remove</span></Th> : null}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <Td>{l.name}<span className="block text-xs text-zinc-500">{sectionLabel(l.section)}</span></Td>
                    <Td className="text-right whitespace-nowrap tabular-nums">{`${formatQty(l.qtyHundredths)} ${l.unit}`}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(l.rateCents)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(lineTotalCents(l))}</Td>
                    {canWrite && draft ? <Td className="text-right"><ConfirmButton action={removeInvoiceLineAction.bind(null, slug, mode, invoice.id, l.id)} variant="ghost">Remove</ConfirmButton></Td> : null}
                  </tr>
                ))}
              </tbody>
            </Table>
            {canWrite && draft ? (
              <Disclosure summary="Add a line">
                <ActionForm action={addInvoiceLineAction.bind(null, slug, mode, invoice.id)} submitLabel="Add line">
                  <div className="grid gap-3 sm:grid-cols-5">
                    <Field label="Item" htmlFor="il-name" className="sm:col-span-2"><input id="il-name" name="name" className={inputClass} /></Field>
                    <Field label="Section" htmlFor="il-section">
                      <Select id="il-section" name="section" defaultValue="additional_services">
                        {SECTIONS.map((sec) => <option key={sec.key} value={sec.key}>{sec.label}</option>)}
                      </Select>
                    </Field>
                    <Field label="Qty" htmlFor="il-qty"><input id="il-qty" name="qty" inputMode="decimal" className={inputClass} /></Field>
                    <Field label="Rate ($)" htmlFor="il-rate"><input id="il-rate" name="rate" inputMode="decimal" className={inputClass} /></Field>
                  </div>
                </ActionForm>
              </Disclosure>
            ) : null}
            <dl aria-label="Invoice totals" className="ml-auto max-w-sm space-y-1 p-4 text-sm tabular-nums">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatMoney(invoice.subtotalCents)}</dd></div>
              {invoice.serviceTaxOn ? <div className="flex justify-between"><dt>{`Service tax ${pct(invoice.serviceTaxBp)}`}</dt><dd>{formatMoney(invoice.serviceTaxCents)}</dd></div> : null}
              <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{formatMoney(baseTotalCents(invoice))}</dd></div>
              <div className="flex justify-between"><dt>Deposit received</dt><dd>{`− ${formatMoney(invoice.depositReceivedCents)}`}</dd></div>
              <div className="flex justify-between"><dt>Payments</dt><dd>{`− ${formatMoney(invoice.paidCents)}`}</dd></div>
              <div className="flex justify-between border-t border-zinc-200 pt-1 font-semibold"><dt>Balance due</dt><dd data-testid="balance-due">{formatMoney(Math.max(balance, 0))}</dd></div>
              {invoice.convenienceFeeOn && balance > 0 ? (
                <div className="flex justify-between text-zinc-700"><dt>{`Paid by card (+${pct(invoice.convenienceFeeBp)} card fee)`}</dt><dd data-testid="balance-due-card">{formatMoney(cardBalanceOf(invoice))}</dd></div>
              ) : null}
            </dl>
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          {canWrite && can(ctx, CORE.paymentsWrite) && (invoice.status === 'sent' || invoice.status === 'partially_paid') ? (
            <Card title="Receive a payment">
              <ActionForm action={invoicePaymentAction.bind(null, slug, mode, invoice.id)} submitLabel="Record payment">
                <AttemptKey />
                <Field label="Amount credited ($)" htmlFor="ip-amount" help={invoice.convenienceFeeOn ? `A card payment is charged this plus the ${pct(invoice.convenienceFeeBp)} card fee.` : undefined}><input id="ip-amount" name="amount" inputMode="decimal" defaultValue={(balance / 100).toFixed(2)} className={inputClass} /></Field>
                <Field label="Paid by" htmlFor="ip-method">
                  <Select id="ip-method" name="method" defaultValue="check">
                    <option value="check">Check</option>
                    <option value="cash">Cash</option>
                    {isPilotMode() && ctx.environment === 'live' ? null : <option value="card">Card (test card)</option>}
                  </Select>
                </Field>
              </ActionForm>
            </Card>
          ) : null}
          {payments !== null ? (
            <Card title="Payments">
              {payments.length === 0 ? <p className="text-sm text-zinc-500">None yet.</p> : (
                <ul className="space-y-1 text-sm">
                  {payments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <span>{`${p.method} · ${formatDateTime(p.paidAt ?? p.createdAt)}`}</span>
                      <span className="tabular-nums">{p.status === 'succeeded' ? formatMoney(p.amountCents) : 'Failed'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
