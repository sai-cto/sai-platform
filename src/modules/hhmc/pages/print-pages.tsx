/**
 * Printable estimate and invoice: a clean page the browser prints or saves as PDF (Print › Save
 * as PDF). Everything around it (menus, header, navigation) is hidden in print. No PDF library.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { withScope } from '@/core/db/scope';
import { NotFoundError } from '@/core/errors';
import { isUuid } from '@/core/ids';
import type { PortalPageProps } from '@/core/modules/contract';
import { formatDateTime, formatDay, formatMoney, formatPhone } from '@/ui/format';
import { P } from '../permissions';
import { SERVICE_TYPE_LABELS, TERMS_LABELS } from '../rules';
import { brandOf, loadSettings } from '../settings';
import { loadCustomer, loadEstimate, loadJob, personName } from '../services/common';
import { balanceOf } from '../services/invoices';
import { computeDeposit, formatQty, lineTotalCents, SECTIONS, type SectionKey } from '../services/pricing';
import { invoicePage } from '../services/views';
import { PrintButton } from './print-button';

type Line = { section: SectionKey; name: string; unit: string; qtyHundredths: number; rateCents: number; totalCents: number; description?: string | null };
const pct = (bp: number) => `${bp / 100}%`;

function Sheet({ brand, title, number, back, children }: { brand: ReturnType<typeof brandOf>; title: string; number: string; back: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={back} className="inline-flex min-h-11 items-center text-sm text-zinc-600 hover:text-zinc-900 hover:underline">
          ← Back
        </Link>
        <span className="flex items-center gap-2 text-xs text-zinc-500">
          In the print window, choose &quot;Save as PDF&quot; for a PDF.
          <PrintButton label="Print / Save as PDF" />
        </span>
      </div>
      <article data-testid="print-document" className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-900 print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-4 pb-3" style={{ borderColor: brand.color }}>
          <div>
            <div className="text-lg font-semibold">{brand.header}</div>
            {brand.contact ? <div className="text-xs text-zinc-600">{brand.contact}</div> : null}
          </div>
          <div className="text-right">
            <h1 className="text-lg font-semibold">{title}</h1>
            <div className="text-xs text-zinc-600">{number}</div>
          </div>
        </header>
        {children}
        {brand.footer ? <footer className="mt-6 border-t border-zinc-200 pt-2 text-xs text-zinc-600">{brand.footer}</footer> : null}
      </article>
    </div>
  );
}

function Lines({ lines }: { lines: Line[] }) {
  return (
    <table className="mt-4 w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-zinc-300 text-xs text-zinc-600">
          <th className="py-1 pr-2 font-medium">Item</th>
          <th className="py-1 pr-2 text-right font-medium">Qty</th>
          <th className="py-1 pr-2 text-right font-medium">Rate</th>
          <th className="py-1 text-right font-medium">Amount</th>
        </tr>
      </thead>
      {SECTIONS.filter((sec) => lines.some((l) => l.section === sec.key)).map((sec) => (
        <tbody key={sec.key} className="break-inside-avoid">
          <tr>
            <th colSpan={4} className="pt-3 pb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              {sec.label}
            </th>
          </tr>
          {lines
            .filter((l) => l.section === sec.key)
            .map((l, i) => (
              <tr key={`${sec.key}-${i}`} className="border-b border-zinc-100 align-top">
                <td className="py-1 pr-2">
                  {l.name}
                  {l.description ? <span className="block text-xs text-zinc-500">{l.description}</span> : null}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums whitespace-nowrap">{`${formatQty(l.qtyHundredths)} ${l.unit}`}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatMoney(l.rateCents)}</td>
                <td className="py-1 text-right tabular-nums">{formatMoney(l.totalCents)}</td>
              </tr>
            ))}
        </tbody>
      ))}
    </table>
  );
}

function Totals({ rows }: { rows: [string, string, boolean?][] }) {
  return (
    <dl className="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm tabular-nums">
      {rows.map(([label, value, strong]) => (
        <div key={label} className={`flex justify-between gap-4 ${strong ? 'border-t border-zinc-300 pt-1 font-semibold' : ''}`}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Parties({ customer, from, to, extra }: { customer: { name: string; email: string | null; phone: string | null }; from: string | null; to: string | null; extra: [string, string][] }) {
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2 print:grid-cols-2">
      <div>
        <div className="text-xs font-semibold text-zinc-500 uppercase">Customer</div>
        <div className="font-medium">{customer.name}</div>
        {customer.email ? <div>{customer.email}</div> : null}
        {customer.phone ? <div>{formatPhone(customer.phone)}</div> : null}
      </div>
      <dl className="space-y-0.5">
        <div><dt className="inline text-zinc-500">From: </dt><dd className="inline">{from ?? '—'}</dd></div>
        <div><dt className="inline text-zinc-500">To: </dt><dd className="inline">{to ?? '—'}</dd></div>
        {extra.map(([k, v]) => (
          <div key={k}><dt className="inline text-zinc-500">{k}: </dt><dd className="inline">{v}</dd></div>
        ))}
      </dl>
    </div>
  );
}

/** /estimates/:id/print — the estimate exactly as sent (its frozen snapshot). */
export async function EstimatePrintPage({ ctx, params, basePath }: PortalPageProps) {
  if (!isUuid(params.id)) throw new NotFoundError();
  const settings = await loadSettings(ctx);
  const brand = brandOf(settings, ctx.business.name);
  const { e, customer } = await withScope(ctx, P.jobsRead, async (s) => {
    const e = await loadEstimate(s, params.id);
    const job = await loadJob(s, e.jobId);
    return { e, customer: await loadCustomer(s, job.customerId) };
  });
  const snap = e.snapshot;
  const deposit = computeDeposit(e, snap.depositBp, { byCard: snap.convenienceFeeOn, convenienceFeeBp: snap.convenienceFeeBp });
  return (
    <Sheet brand={brand} title="Estimate" number={`${e.estimateNumber} · version ${e.version}`} back={`${basePath}/jobs/${e.jobId}`}>
      <Parties
        customer={{ name: snap.customerName || personName(customer), email: snap.customerEmail ?? customer.email, phone: customer.phone }}
        from={snap.originAddress}
        to={snap.destinationAddress}
        extra={[
          ...(snap.extraStops.length ? ([['Extra stops', snap.extraStops.join('; ')]] as [string, string][]) : []),
          ['Move date', snap.moveDate ? formatDay(snap.moveDate) : 'To be set'],
          ['Arrival window', snap.arrivalWindow ?? '—'],
          ['Service', `${SERVICE_TYPE_LABELS[snap.serviceType]} · ${snap.jobType} · ${snap.crewSize} movers, ${snap.trucks} truck${snap.trucks === 1 ? '' : 's'}`],
          ['Sent', e.sentAt ? formatDateTime(e.sentAt) : 'Not sent'],
          ...(e.expiresAt && !e.signedAt ? ([['Valid until', formatDateTime(e.expiresAt)]] as [string, string][]) : []),
        ]}
      />
      <Lines lines={snap.lines} />
      <Totals
        rows={[
          ['Subtotal', formatMoney(e.subtotalCents)],
          ...(snap.serviceTaxOn ? ([[`Service tax ${pct(snap.serviceTaxBp)}`, formatMoney(e.serviceTaxCents)]] as [string, string][]) : []),
          ['Total', formatMoney(e.subtotalCents + e.serviceTaxCents), true],
          ...(snap.convenienceFeeOn ? ([[`If paid by card (+${pct(snap.convenienceFeeBp)})`, formatMoney(e.totalCents)]] as [string, string][]) : []),
          [`Deposit (${pct(snap.depositBp)})`, formatMoney(deposit.depositCents)],
        ]}
      />
      {snap.scopeOfWork ? (
        <section className="mt-5 break-inside-avoid">
          <h2 className="text-sm font-semibold">Scope of work</h2>
          <p className="whitespace-pre-wrap">{snap.scopeOfWork}</p>
        </section>
      ) : null}
      <section className="mt-5">
        <h2 className="text-sm font-semibold">Valuation</h2>
        <p className="whitespace-pre-wrap">{snap.valuation}</p>
      </section>
      {snap.termsBody ? (
        <section className="mt-5">
          <h2 className="text-sm font-semibold">{snap.termsTitle}</h2>
          <p className="text-xs whitespace-pre-wrap text-zinc-700">{snap.termsBody}</p>
        </section>
      ) : null}
      <section className="mt-5 break-inside-avoid border-t border-zinc-200 pt-3">
        {e.signedAt ? (
          <p>
            Signed by <strong>{e.signatureName}</strong> on {formatDateTime(e.signedAt)}
            {e.valuationInitials ? ` · valuation initialed ${e.valuationInitials}` : ''}.
          </p>
        ) : (
          <p className="text-zinc-500">Not signed yet.</p>
        )}
      </section>
    </Sheet>
  );
}

/** /invoices/:id/print — the invoice with its lines, payments made and the balance due. */
export async function InvoicePrintPage({ ctx, params, basePath }: PortalPageProps) {
  if (!isUuid(params.id)) throw new NotFoundError();
  const settings = await loadSettings(ctx);
  const brand = brandOf(settings, ctx.business.name);
  const { invoice, job, customer, lines } = await invoicePage(ctx, params.id);
  const base = invoice.subtotalCents + invoice.serviceTaxCents;
  const balance = invoice.status === 'void' ? 0 : Math.max(balanceOf(invoice), 0);
  const asLine = (l: (typeof lines)[number]): Line => ({ ...l, description: l.serviceDate ? formatDay(l.serviceDate) : null, totalCents: lineTotalCents(l) });
  return (
    <Sheet brand={brand} title={invoice.status === 'void' ? 'Invoice (void)' : 'Invoice'} number={invoice.invoiceNumber} back={`${basePath}/invoices/${invoice.id}`}>
      <Parties
        customer={{ name: personName(customer), email: customer.email, phone: customer.phone }}
        from={job.originAddress}
        to={job.destinationAddress}
        extra={[
          ['Work request', job.jobNumber],
          ['Move date', job.moveDate ? formatDay(job.moveDate) : '—'],
          ['Invoice date', formatDay(invoice.invoiceDate)],
          ['Terms', TERMS_LABELS[invoice.terms]],
          ['Due', formatDay(invoice.dueDate)],
          ...(invoice.poNumber ? ([['PO', invoice.poNumber]] as [string, string][]) : []),
        ]}
      />
      <Lines lines={lines.map(asLine)} />
      <Totals
        rows={[
          ['Subtotal', formatMoney(invoice.subtotalCents)],
          ...(invoice.serviceTaxOn ? ([[`Service tax ${pct(invoice.serviceTaxBp)}`, formatMoney(invoice.serviceTaxCents)]] as [string, string][]) : []),
          ['Total', formatMoney(base), true],
          ...(invoice.depositReceivedCents ? ([['Deposit received', `−${formatMoney(invoice.depositReceivedCents)}`]] as [string, string][]) : []),
          ...(invoice.paidCents ? ([['Payments received', `−${formatMoney(invoice.paidCents)}`]] as [string, string][]) : []),
          ['Balance due', formatMoney(balance), true],
        ]}
      />
      {invoice.remarks ? (
        <section className="mt-5">
          <h2 className="text-sm font-semibold">Notes</h2>
          <p className="whitespace-pre-wrap">{invoice.remarks}</p>
        </section>
      ) : null}
      <p className="mt-5 text-xs text-zinc-600">
        {balance > 0 ? `Please pay ${formatMoney(balance)} by ${formatDay(invoice.dueDate)}.` : 'Paid in full. Thank you!'}
      </p>
    </Sheet>
  );
}
