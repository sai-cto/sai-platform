/**
 * The customer's pages, opened from an emailed link (src/core/links), no account needed.
 *
 * Estimate link (ref §7.3), four steps: Summary → full Estimate with T&Cs → E-sign (initial
 * Valuation, typed final signature; time, IP and browser are stored) → Confirmation with Pay
 * Deposit. Invoice link: the invoice and Pay the balance.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { NotFoundError } from '@/core/errors';
import type { PortalPageProps } from '@/core/modules/contract';
import { ActionForm } from '@/ui/action-form';
import { cn } from '@/ui/cn';
import { formatDateTime, formatMoney } from '@/ui/format';
import { Card, Field, inputClass } from '@/ui/layout';
import { payDepositLinkAction, payInvoiceLinkAction, signEstimateLinkAction } from '../actions';
import { SERVICE_TYPE_LABELS, TERMS_LABELS } from '../rules';
import type { hhmcEstimates } from '../schema';
import { brandOf, loadSettings, type Brand } from '../settings';
import { PURPOSE } from '../services/common';
import { depositDueByCard, openEstimateByLink } from '../services/estimates';
import { balanceOf, cardBalanceOf, openInvoiceByLink } from '../services/invoices';
import { baseTotalCents, formatQty, lineTotalCents, SECTIONS } from '../services/pricing';
import { AttemptKey } from './attempt-key';
import { formatDay } from './parts';
import { PrintButton } from './print-button';

const STEPS = [
  { key: 'summary', label: 'Summary' },
  { key: 'estimate', label: 'Estimate' },
  { key: 'sign', label: 'Sign' },
  { key: 'confirm', label: 'Confirmation' },
] as const;
type Step = (typeof STEPS)[number]['key'];

const pct = (bp: number) => `${bp / 100}%`;

function TestCardChoice() {
  return (
    <Field label="Card" htmlFor="card" help="Test mode: no real card is charged. Card details will be collected by the card company's own form once it is connected.">
      <select id="card" name="cardToken" defaultValue="" className={inputClass}>
        <option value="">Test card ending 4242 (approved)</option>
        <option value="mock_declined">Test card that is declined</option>
      </select>
    </Field>
  );
}

function Prices({ e }: { e: typeof hhmcEstimates.$inferSelect }) {
  const s = e.snapshot;
  return (
    <dl className="space-y-1 text-sm tabular-nums">
      {SECTIONS.filter((sec) => s.lines.some((l) => l.section === sec.key)).map((sec) => (
        <div key={sec.key} className="flex justify-between"><dt>{sec.label}</dt><dd>{formatMoney(s.sections[sec.key])}</dd></div>
      ))}
      <div className="flex justify-between border-t border-zinc-200 pt-1"><dt>Subtotal</dt><dd>{formatMoney(e.subtotalCents)}</dd></div>
      {s.serviceTaxOn ? <div className="flex justify-between"><dt>{`Service tax ${pct(s.serviceTaxBp)}`}</dt><dd>{formatMoney(e.serviceTaxCents)}</dd></div> : null}
      <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd>{formatMoney(baseTotalCents(e))}</dd></div>
      {s.convenienceFeeOn ? (
        <div className="flex justify-between text-zinc-700"><dt>{`If you pay by card (+${pct(s.convenienceFeeBp)} card fee)`}</dt><dd>{formatMoney(e.totalCents)}</dd></div>
      ) : null}
    </dl>
  );
}

function Shell({ business, title, brand, children }: { business: string; title: string; brand?: Brand; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <header className="space-y-3">
        {brand ? (
          <div className="rounded-md px-4 py-3 text-white" style={{ backgroundColor: brand.color }}>
            <p className="font-medium">{brand.header}</p>
            {brand.contact ? <p className="text-xs opacity-90">{brand.contact}</p> : null}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">{business}</p>
        )}
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{title}</h1>
      </header>
      {children}
      {brand?.footer ? <footer className="border-t border-zinc-200 pt-3 text-xs text-zinc-500">{brand.footer}</footer> : null}
    </div>
  );
}

export async function CustomerPage(props: PortalPageProps) {
  const { ctx } = props;
  if (ctx.link?.purpose === PURPOSE.estimate) return EstimateReview(props);
  if (ctx.link?.purpose === PURPOSE.invoice) return InvoicePay(props);
  // Signed in to the console but no link: there is nothing for you here.
  throw new NotFoundError();
}

async function EstimateReview({ ctx, searchParams, basePath }: PortalPageProps) {
  const { estimate: e, settings, expired } = await openEstimateByLink(ctx);
  const s = e.snapshot;
  const business = ctx.business.name;
  const brand = brandOf(await loadSettings(ctx), business);
  if (e.status === 'void')
    return (
      <Shell business={business} brand={brand} title="This estimate is no longer valid">
        <Card><p className="text-sm">It was replaced or withdrawn. If you were sent a newer one, open the link in that email, or reply to us.</p></Card>
      </Shell>
    );
  const requested = STEPS.find((st) => st.key === searchParams.step)?.key;
  const step: Step = e.status === 'signed' ? (requested === 'estimate' || requested === 'summary' ? requested : 'confirm') : requested === 'confirm' ? 'sign' : (requested ?? 'summary');
  const deposit = depositDueByCard(e);
  const go = (to: Step) => `${basePath}?step=${to}`;

  return (
    <Shell business={business} brand={brand} title={s.title}>
      <ol aria-label="Steps" className="flex flex-wrap gap-1 text-xs print:hidden">
        {STEPS.map((st, i) => (
          <li key={st.key} aria-current={st.key === step ? 'step' : undefined} className={cn('rounded-full px-2.5 py-1', st.key === step ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600')}>
            {`${i + 1}. ${st.label}`}
          </li>
        ))}
      </ol>
      <p className="text-sm text-zinc-600">
        {`Estimate ${e.estimateNumber} (version ${e.version}) · `}
        {e.status === 'signed' ? `signed ${formatDateTime(e.signedAt)}` : `valid until ${formatDateTime(e.expiresAt)}`}
      </p>
      {expired ? <Card><p className="text-sm font-medium text-red-800">This estimate has expired. Reply to our email and we will send a new one.</p></Card> : null}

      {step === 'summary' ? (
        <Card>
          <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-zinc-500">For</dt><dd>{s.customerName}</dd></div>
            <div><dt className="text-xs text-zinc-500">Move date</dt><dd>{`${formatDay(s.moveDate)}${s.arrivalWindow ? ` · arrival ${s.arrivalWindow}` : ''}`}</dd></div>
            <div><dt className="text-xs text-zinc-500">From</dt><dd>{s.originAddress ?? '—'}</dd></div>
            <div><dt className="text-xs text-zinc-500">To</dt><dd>{s.destinationAddress ?? '—'}</dd></div>
            {s.extraStops.length ? <div><dt className="text-xs text-zinc-500">Extra stops</dt><dd>{s.extraStops.join('; ')}</dd></div> : null}
            <div><dt className="text-xs text-zinc-500">Service</dt><dd>{`${SERVICE_TYPE_LABELS[s.serviceType]} · ${s.jobType} · ${s.crewSize} movers, ${s.trucks} truck${s.trucks === 1 ? '' : 's'}`}</dd></div>
          </dl>
          <Prices e={e} />
          <p className="mt-3 text-xs text-zinc-600">{`Deposit to hold your date: ${pct(s.depositBp)} = ${formatMoney(deposit.depositCents)}${s.convenienceFeeOn ? ` (+ ${pct(s.convenienceFeeBp)} card fee ${formatMoney(deposit.cardFeeCents)} = ${formatMoney(deposit.totalDueCents)} by card)` : ''}.`}</p>
          <div className="mt-4 flex justify-end"><Link className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white" href={go('estimate')}>Next: full estimate</Link></div>
        </Card>
      ) : null}

      {step === 'estimate' ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="text-xs text-zinc-500"><th className="py-1">Description</th><th className="py-1 text-right">Qty</th><th className="py-1 text-right">Rate</th><th className="py-1 text-right">Total</th></tr></thead>
              {SECTIONS.filter((sec) => s.lines.some((l) => l.section === sec.key)).map((sec) => (
                <tbody key={sec.key}>
                  <tr><td colSpan={4} className="pt-3 pb-1 text-xs font-semibold text-zinc-700">{sec.label}</td></tr>
                  {s.lines.filter((l) => l.section === sec.key).map((l, i) => (
                    <tr key={i} className="border-t border-zinc-100">
                      <td className="py-1">{l.name}</td>
                      <td className="py-1 text-right whitespace-nowrap">{`${formatQty(l.qtyHundredths)} ${l.unit}`}</td>
                      <td className="py-1 text-right">{formatMoney(l.rateCents)}</td>
                      <td className="py-1 text-right">{formatMoney(lineTotalCents({ ...l, section: l.section }))}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          <div className="mt-3 ml-auto max-w-xs"><Prices e={e} /></div>
          <h2 className="mt-5 text-sm font-semibold">Scope of work</h2>
          <p className="text-sm whitespace-pre-wrap text-zinc-700">{s.scopeOfWork ?? '—'}</p>
          <h2 className="mt-5 text-sm font-semibold">Valuation</h2>
          <p className="text-sm whitespace-pre-wrap text-zinc-700">{s.valuation}</p>
          <h2 className="mt-5 text-sm font-semibold">{s.termsTitle}</h2>
          <p className="max-h-80 overflow-y-auto rounded border border-zinc-200 p-3 text-sm whitespace-pre-wrap text-zinc-700">{s.termsBody}</p>
          <div className="mt-4 flex flex-wrap justify-between gap-2 print:hidden">
            <Link className="rounded-md border border-zinc-300 px-3 py-2 text-sm" href={go('summary')}>Back</Link>
            <PrintButton />
            {e.status !== 'signed' && !expired ? <Link className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white" href={go('sign')}>Next: sign</Link> : <Link className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white" href={go('confirm')}>Confirmation</Link>}
          </div>
        </Card>
      ) : null}

      {step === 'sign' && !expired ? (
        <Card title="Sign your estimate">
          <ActionForm action={signEstimateLinkAction.bind(null, tokenFrom(basePath))} submitLabel="Sign estimate">
            <div className="rounded-md border border-zinc-200 p-3 text-sm">
              <p className="font-medium">Valuation</p>
              <p className="mt-1 text-zinc-700">{s.valuation}</p>
              <Field label="Your initials" htmlFor="initials" className="mt-2 max-w-40"><input id="initials" name="valuationInitials" autoComplete="off" maxLength={6} className={inputClass} /></Field>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="agree" className="mt-0.5 size-4" />
              <span>I have reviewed and initialed each section of this estimate and agree to the terms, pricing and services described in it.</span>
            </label>
            <Field label="Type your full name to sign" htmlFor="signature"><input id="signature" name="signatureName" autoComplete="name" className={inputClass} /></Field>
            <p className="text-xs text-zinc-500">{`We record the time you sign, your IP address and your browser. Total: ${formatMoney(baseTotalCents(e))}${e.snapshot.convenienceFeeOn ? ` (${formatMoney(e.totalCents)} if paid by card)` : ''}.`}</p>
          </ActionForm>
          <div className="mt-3"><Link className="text-sm underline" href={go('estimate')}>Back to the estimate</Link></div>
        </Card>
      ) : null}

      {step === 'confirm' ? (
        <Card title="Estimate review completed">
          <ul className="mb-4 space-y-1 text-sm">
            <li>✓ Reviewed</li>
            <li>{`✓ Signed by ${e.signatureName} on ${formatDateTime(e.signedAt)}`}</li>
            <li>{e.depositPaidCents > 0 ? `✓ Deposit paid (${formatMoney(e.depositPaidCents)})` : '◷ Deposit'}</li>
          </ul>
          {e.depositPaidCents > 0 ? (
            <p className="text-sm text-zinc-700">Thank you! We will confirm your booking shortly.</p>
          ) : (
            <>
              <dl className="mb-4 space-y-1 text-sm tabular-nums">
                <div className="flex justify-between"><dt>{`Deposit amount (${pct(e.snapshot.depositBp)})`}</dt><dd>{formatMoney(deposit.depositCents)}</dd></div>
                {deposit.cardFeeCents > 0 ? <div className="flex justify-between"><dt>{`Card convenience fee (${pct(e.snapshot.convenienceFeeBp)})`}</dt><dd>{formatMoney(deposit.cardFeeCents)}</dd></div> : null}
                <div className="flex justify-between font-semibold"><dt>Total deposit required</dt><dd>{formatMoney(deposit.totalDueCents)}</dd></div>
              </dl>
              <ActionForm action={payDepositLinkAction.bind(null, tokenFrom(basePath))} submitLabel={`Pay deposit ${formatMoney(deposit.totalDueCents)}`}>
                <AttemptKey />
                <TestCardChoice />
              </ActionForm>
              <p className="mt-3 text-xs text-zinc-500">{`The deposit holds your date (${settings.depositPercent}% of the price before any card fee). The rest is invoiced after your move.`}</p>
            </>
          )}
        </Card>
      ) : null}
    </Shell>
  );
}

/** The token is the last part of the base path: "/l/<token>". */
function tokenFrom(basePath: string): string {
  return basePath.split('/').pop() ?? '';
}

async function InvoicePay({ ctx, basePath }: PortalPageProps) {
  const { invoice, lines } = await openInvoiceByLink(ctx);
  const balance = balanceOf(invoice);
  const byCard = cardBalanceOf(invoice);
  const pctOf = (bp: number) => `${bp / 100}%`;
  return (
    <Shell business={ctx.business.name} brand={brandOf(await loadSettings(ctx), ctx.business.name)} title={`Invoice ${invoice.invoiceNumber}`}>
      <Card>
        <p className="mb-3 text-sm text-zinc-600">{`${formatDay(invoice.invoiceDate)} · ${TERMS_LABELS[invoice.terms]} · due ${formatDay(invoice.dueDate)}`}</p>
        <ul className="space-y-1 text-sm">
          {lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-2"><span>{`${l.name} · ${formatQty(l.qtyHundredths)} ${l.unit}`}</span><span className="tabular-nums">{formatMoney(lineTotalCents(l))}</span></li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1 border-t border-zinc-200 pt-2 text-sm tabular-nums">
          {invoice.serviceTaxOn ? <div className="flex justify-between"><dt>{`Service tax ${pctOf(invoice.serviceTaxBp)}`}</dt><dd>{formatMoney(invoice.serviceTaxCents)}</dd></div> : null}
          <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{formatMoney(baseTotalCents(invoice))}</dd></div>
          <div className="flex justify-between"><dt>Deposit received</dt><dd>{`− ${formatMoney(invoice.depositReceivedCents)}`}</dd></div>
          <div className="flex justify-between"><dt>Payments received</dt><dd>{`− ${formatMoney(invoice.paidCents)}`}</dd></div>
          <div className="flex justify-between text-base font-semibold"><dt>Balance due</dt><dd>{formatMoney(Math.max(balance, 0))}</dd></div>
          {invoice.convenienceFeeOn && balance > 0 ? (
            <div className="flex justify-between text-zinc-700"><dt>{`Paid by card (+${pctOf(invoice.convenienceFeeBp)} card fee)`}</dt><dd>{formatMoney(byCard)}</dd></div>
          ) : null}
        </dl>
      </Card>
      {invoice.status === 'paid' || balance <= 0 ? (
        <Card><p className="text-sm font-medium text-emerald-800">Paid in full. Thank you!</p></Card>
      ) : invoice.status === 'void' ? (
        <Card><p className="text-sm">This invoice was cancelled.</p></Card>
      ) : (
        <Card title="Pay now">
          <ActionForm action={payInvoiceLinkAction.bind(null, tokenFrom(basePath))} submitLabel={`Pay ${formatMoney(byCard)} by card`}>
            <AttemptKey />
            <TestCardChoice />
          </ActionForm>
        </Card>
      )}
    </Shell>
  );
}
