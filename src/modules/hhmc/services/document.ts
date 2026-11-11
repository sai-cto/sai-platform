/**
 * The estimate document (ref §3.5): a self-contained HTML page made from the frozen snapshot,
 * stored through the core's files when an estimate is sent and again when it is signed.
 * HTML, not PDF: no PDF library is approved (DECISIONS A3); a browser prints it to PDF.
 */
import type { hhmcEstimates } from '../schema';
import { computeDeposit, formatQty, SECTIONS } from './pricing';

const esc = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const usd = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const pct = (bp: number) => `${(bp / 100).toString()}%`;

export function estimateDocument(businessName: string, e: typeof hhmcEstimates.$inferSelect): string {
  const snap = e.snapshot;
  const deposit = computeDeposit(e, snap.depositBp, { byCard: snap.convenienceFeeOn, convenienceFeeBp: snap.convenienceFeeBp });
  const sections = SECTIONS.filter((sec) => snap.lines.some((l) => l.section === sec.key))
    .map((sec) => {
      const rows = snap.lines
        .filter((l) => l.section === sec.key)
        .map(
          (l) =>
            `<tr><td>${esc(l.name)}${l.description ? `<br><small>${esc(l.description)}</small>` : ''}</td><td>${formatQty(l.qtyHundredths)}</td><td>${esc(l.unit)}</td><td>${usd(l.rateCents)}</td><td>${usd(l.totalCents)}</td></tr>`,
        )
        .join('');
      return `<h3>${esc(sec.label)}</h3><table><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Total</th></tr>${rows}<tr><td colspan="4"><b>${esc(sec.label)} total</b></td><td><b>${usd(snap.sections[sec.key])}</b></td></tr></table>`;
    })
    .join('');
  const signature = e.signedAt
    ? `<h2>Signature</h2><p>Valuation initialed: <b>${esc(e.valuationInitials)}</b></p><p>Signed by <b>${esc(e.signatureName)}</b> on ${esc(e.signedAt.toISOString())} (IP ${esc(e.signedIp ?? 'unknown')}).</p>`
    : '<p><i>Not signed yet.</i></p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(e.estimateNumber)} v${e.version}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;color:#18181b}table{width:100%;border-collapse:collapse;margin:.5rem 0}td,th{border-bottom:1px solid #e4e4e7;padding:4px;text-align:left}pre{white-space:pre-wrap;font:inherit}</style></head><body>
<h1>${esc(businessName)}</h1>
<h2>${esc(snap.title)}</h2>
<p>Estimate ${esc(e.estimateNumber)}, version ${e.version}. Sent ${esc(e.sentAt?.toISOString().slice(0, 10) ?? '')}; expires ${esc(e.expiresAt?.toISOString().slice(0, 10) ?? '')}.</p>
<p><b>To:</b> ${esc(snap.customerName)}<br><b>From:</b> ${esc(snap.originAddress ?? '—')}<br><b>To address:</b> ${esc(snap.destinationAddress ?? '—')}${snap.extraStops.length ? `<br><b>Extra stops:</b> ${snap.extraStops.map(esc).join('; ')}` : ''}</p>
<p><b>Move date:</b> ${esc(snap.moveDate ?? 'to be set')} · <b>Arrival window:</b> ${esc(snap.arrivalWindow ?? '—')} · <b>Service:</b> ${esc(snap.serviceType)} · ${esc(snap.jobType)} · ${snap.crewSize} movers, ${snap.trucks} truck(s)</p>
${sections}
<table>
<tr><td>Subtotal</td><td>${usd(e.subtotalCents)}</td></tr>
${snap.serviceTaxOn ? `<tr><td>Service tax ${pct(snap.serviceTaxBp)}</td><td>${usd(e.serviceTaxCents)}</td></tr>` : ''}
<tr><td><b>Total</b></td><td><b>${usd(e.subtotalCents + e.serviceTaxCents)}</b></td></tr>
${snap.convenienceFeeOn ? `<tr><td>If paid by card (+${pct(snap.convenienceFeeBp)} card convenience fee)</td><td>${usd(e.totalCents)}</td></tr>` : ''}
</table>
<h2>Deposit</h2>
<p>Deposit ${pct(snap.depositBp)}: ${usd(deposit.depositCents)}.${snap.convenienceFeeOn ? ` Paid by card, a ${pct(snap.convenienceFeeBp)} convenience fee of ${usd(deposit.cardFeeCents)} is added: ${usd(deposit.totalDueCents)}.` : ''}</p>
<h2>Scope of work</h2><pre>${esc(snap.scopeOfWork ?? '—')}</pre>
<h2>Valuation</h2><pre>${esc(snap.valuation)}</pre>
<h2>${esc(snap.termsTitle)}</h2><pre>${esc(snap.termsBody)}</pre>
${signature}
</body></html>`;
}
