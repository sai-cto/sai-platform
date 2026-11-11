/**
 * THE JOB PAGE: everything about one move on one page (prompt "Job page"; ref §10 "one Job
 * page"). Summary, addresses, the quote with live totals, estimates, booking, job days,
 * invoices, payments, notes and calls, emails and activity.
 */
import Link from 'next/link';
import type { PortalPageProps } from '@/core/modules/contract';
import { can } from '@/core/rbac/permissions';
import { customerName } from '@/core/records/core-entities';
import { ActionForm } from '@/ui/action-form';
import { Badge } from '@/ui/badge';
import { ConfirmButton } from '@/ui/confirm-button';
import { formatDateTime, formatMoney } from '@/ui/format';
import { Card, EmptyState, Field, PageHeader, Table, Td, Th, inputClass } from '@/ui/layout';
import {
  actualTimeAction,
  addJobDayAction,
  addJobNoteAction,
  addQuoteLineAction,
  bookJobAction,
  cancelJobAction,
  createInvoiceAction,
  estimateLinkAction,
  markLostAction,
  optInAction,
  quoteDiscountAction,
  quoteOptionsAction,
  recordDepositAction,
  releaseBookingAction,
  removeJobDayAction,
  removeQuoteLineAction,
  reopenJobAction,
  resendEstimateAction,
  sendEstimateAction,
  updateJobAction,
  voidEstimateAction,
} from '../actions';
import { CORE, P } from '../permissions';
import { CALL_OUTCOME_LABELS, quoteEditable, SERVICE_TYPE_LABELS, TERMS_LABELS } from '../rules';
import { INVOICE_TERMS } from '../schema';
import { depositDueByCard } from '../services/estimates';
import { balanceOf } from '../services/invoices';
import { baseTotalCents } from '../services/pricing';
import { jobActivity, jobPage } from '../services/views';
import { CopyLinkButton } from './copy-link';
import { AttemptKey } from './attempt-key';
import { Disclosure } from './disclosure';
import { JobFields, areaClass } from './jobs';
import { EstimateStatusBadge, Fact, InvoiceStatusBadge, Note, Select, StageBadge, formatDay, formatTime } from './parts';
import { QuoteEditor } from './quote-editor';
import { ACCESS_LABELS, EstimateBuilder } from './estimate-builder';
import { loadSettings } from '../settings';
import { mapsConfigured } from '../services/maps';

export async function JobPage({ ctx, params, basePath }: PortalPageProps) {
  const data = await jobPage(ctx, params.id);
  const { job, customer, quote, estimates, liveEstimate, days, booked, invoices, notes, queue } = data;
  const activity = await jobActivity(ctx, job.id, [...estimates.map((e) => e.id), ...(invoices ?? []).map((i) => i.id)]);
  const slug = ctx.business.slug;
  const mode = ctx.environment;
  const tz = ctx.business.timeZone;
  const canWrite = can(ctx, P.jobsWrite);
  const canBook = can(ctx, P.jobsBook) && canWrite;
  const canEstimate = can(ctx, P.estimatesWrite);
  const canInvoice = can(ctx, P.invoicesWrite);
  const signedEstimate = estimates.some((e) => e.status === 'signed');
  const editable = canWrite && quoteEditable(job.stage) && !signedEstimate;
  const openInvoice = (invoices ?? []).find((i) => i.status !== 'void');
  const signed = liveEstimate?.status === 'signed' ? liveEstimate : null;
  const settings = await loadSettings(ctx);
  const access = (flags: string[], notes: string | null) =>
    [flags.map((f) => ACCESS_LABELS[f as keyof typeof ACCESS_LABELS] ?? f).join(', '), notes].filter(Boolean).join(' — ');

  return (
    <>
      <PageHeader
        title={`${job.jobNumber} · ${customer ? customerName(customer) : 'Customer'}`}
        description={
          <>
            <Link href={`${basePath}/jobs`} className="hover:underline">← All work requests</Link>
            {customer ? <>{' · '}<Link href={`${basePath}/contacts/${customer.id}`} className="hover:underline">Contact</Link></> : null}
          </>
        }
        actions={
          <>
            <StageBadge stage={job.stage} />
            {data.readyToBook ? <Badge tone="green">Ready to book</Badge> : null}
            {canEstimate && (job.stage === 'qualified' || job.stage === 'estimate_sent') && !signed ? (
              <ConfirmButton
                action={sendEstimateAction.bind(null, slug, mode, job.id)}
                variant="primary"
                confirmTitle={liveEstimate ? `Send version ${liveEstimate.version + 1}?` : 'Send the estimate?'}
                confirmBody={
                  <>
                    The customer gets a &quot;Please Sign&quot; email with their link, for {formatMoney(baseTotalCents(quote.totals))}{quote.options.convenienceFeeOn ? ` (${formatMoney(quote.totals.totalCents)} by card)` : ''}.
                    {liveEstimate ? ` Version ${liveEstimate.version} will be voided.` : ''} Follow-up emails are queued{job.automationOptIn ? '' : ' (opt-in is off: none will be sent)'}.
                  </>
                }
                confirmLabel="Send estimate"
              >
                {liveEstimate ? 'Send new version' : 'Send estimate'}
              </ConfirmButton>
            ) : null}
            {canBook && job.stage === 'estimate_sent' && signed && days.length === 0 ? (
              <span className="text-xs text-amber-800">Add a job day (the move date) below before booking.</span>
            ) : null}
            {canBook && job.stage === 'estimate_sent' && signed && days.length > 0 ? (
              <ConfirmButton
                action={bookJobAction.bind(null, slug, mode, job.id)}
                variant="primary"
                confirmTitle="Book this move?"
                confirmBody={`Books ${days.length} job day${days.length === 1 ? '' : 's'} on the schedule and emails "You're booked".${signed.depositPaidCents > 0 ? '' : ' The deposit has NOT been paid yet.'}`}
                confirmLabel="Book"
              >
                Book this move
              </ConfirmButton>
            ) : null}
            {canBook && job.stage === 'booked' ? (
              <ConfirmButton action={releaseBookingAction.bind(null, slug, mode, job.id)} confirmTitle="Release the booking?" confirmBody="Its appointments are cancelled and the job goes back to Estimate Sent." confirmLabel="Release booking">
                Release booking
              </ConfirmButton>
            ) : null}
            {canWrite && job.stage === 'lost' ? <ConfirmButton action={reopenJobAction.bind(null, slug, mode, job.id)}>Reopen</ConfirmButton> : null}
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="min-w-0 space-y-5 xl:col-span-2">
          <Card title="Move" flush>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 md:grid-cols-4">
              <Fact label="Customer">
                {customer ? (
                  <>
                    <Link className="hover:underline" href={`${basePath}/contacts/${customer.id}`}>{customerName(customer)}</Link>
                    <span className="block text-xs break-all text-zinc-500">{customer.email ?? 'No email'}</span>
                    <span className="block text-xs text-zinc-500">{customer.phone ?? 'No phone'}</span>
                  </>
                ) : (
                  'Hidden'
                )}
              </Fact>
              <Fact label="Move date">
                {formatDay(job.moveDate)}
                {job.tentative ? <span className="block text-xs text-amber-700">Tentative</span> : null}
                <span className="block text-xs text-zinc-500">{job.arrivalWindow ?? ''}</span>
              </Fact>
              <Fact label="Service">{`${SERVICE_TYPE_LABELS[job.serviceType]} · ${job.jobType}`}</Fact>
              <Fact label="Crew">{`M:${job.crewSize} / T:${job.trucks}${job.bedrooms ? ` · ${job.bedrooms}` : ''}`}</Fact>
              <Fact label="From">{job.originAddress ?? '—'}{access(job.originAccess, job.originNotes) ? <span className="block text-xs text-zinc-500">{access(job.originAccess, job.originNotes)}</span> : null}</Fact>
              <Fact label="To">{job.destinationAddress ?? '—'}{access(job.destinationAccess, job.destinationNotes) ? <span className="block text-xs text-zinc-500">{access(job.destinationAccess, job.destinationNotes)}</span> : null}</Fact>
              <Fact label="Distance">{job.distanceTenths !== null ? `${(job.distanceTenths / 10).toFixed(1)} mi${job.driveMinutes !== null ? ` · ${job.driveMinutes} min` : ''}` : '—'}{job.ownTruck ? <span className="block text-xs text-zinc-500">Customer&apos;s own truck</span> : null}{job.cornellian ? <span className="block text-xs text-zinc-500">Cornellian</span> : null}</Fact>
              {job.extraStops.length ? <Fact label="Extra stops">{job.extraStops.join('; ')}</Fact> : null}
              <Fact label="Source">{`${job.source}${job.sourceDetail ? ` · ${job.sourceDetail}` : ''}`}{data.lead ? <Link className="block text-xs hover:underline" href={`${basePath}/leads/${data.lead.id}`}>{`From lead ${data.lead.leadNumber}`}</Link> : null}</Fact>
              <Fact label="Owner">{job.ownerName ?? '—'}{job.coordinators.length ? <span className="block text-xs text-zinc-500">{`Coordinators: ${job.coordinators.join(', ')}`}</span> : null}</Fact>
              {job.companyName || job.poNumber ? <Fact label="Company / PO">{[job.companyName, job.poNumber].filter(Boolean).join(' · ')}</Fact> : null}
              {job.lostReason ? <Fact label="Lost because">{job.lostReason}</Fact> : null}
              {job.cancelledReason ? <Fact label="Cancelled because">{job.cancelledReason}</Fact> : null}
              {job.customerComments ? <Fact label="Customer comments">{job.customerComments}</Fact> : null}
              {job.scopeOfWork ? <Fact label="Scope of work">{job.scopeOfWork}</Fact> : null}
              {job.internalNotes ? <Fact label="Internal notes">{job.internalNotes}</Fact> : null}
              <Fact label="Follow-up emails">
                {job.automationOptIn ? 'On' : 'Off'}
                {canWrite ? (
                  <span className="ml-2">
                    <ConfirmButton action={optInAction.bind(null, slug, mode, job.id, !job.automationOptIn)} variant="ghost">{job.automationOptIn ? 'Turn off' : 'Turn on'}</ConfirmButton>
                  </span>
                ) : null}
              </Fact>
            </dl>
            {canWrite && job.stage !== 'closed' && job.stage !== 'cancelled' ? (
              <Disclosure summary="Change details">
                <ActionForm action={updateJobAction.bind(null, slug, mode, job.id)} submitLabel="Save" resetOnSuccess={false}>
                  <JobFields job={job} />
                </ActionForm>
              </Disclosure>
            ) : null}
            {canWrite && ['qualified', 'estimate_sent'].includes(job.stage) ? (
              <Disclosure summary="Mark lost">
                <ActionForm action={markLostAction.bind(null, slug, mode, job.id)} submitLabel="Mark lost" submitVariant="danger">
                  <Field label="Reason" htmlFor="lost-reason"><input id="lost-reason" name="reason" required className={inputClass} placeholder="e.g. Price, went with another mover" /></Field>
                </ActionForm>
              </Disclosure>
            ) : null}
            {canWrite && ['qualified', 'estimate_sent', 'booked'].includes(job.stage) && (job.stage !== 'booked' || can(ctx, CORE.schedulingWrite)) ? (
              <Disclosure summary="Cancel job">
                <ActionForm action={cancelJobAction.bind(null, slug, mode, job.id)} submitLabel="Cancel job" submitVariant="danger">
                  <Field label="Reason" htmlFor="cancel-reason"><input id="cancel-reason" name="reason" required className={inputClass} /></Field>
                </ActionForm>
              </Disclosure>
            ) : null}
          </Card>

          <Card title="Quote" description={editable ? 'The one price for this move. Sending makes a frozen, versioned estimate.' : 'Locked: the signed estimate is the price.'} flush>
            {editable ? (
              <Disclosure summary="Build the estimate from the move details" startOpen={quote.lines.length === 0}>
                <EstimateBuilder
                  slug={slug}
                  mode={mode}
                  job={job}
                  catalog={data.catalog.map((c) => ({ id: c.id, name: c.name, section: c.section, unit: c.unit, rateCents: c.rateCents, category: c.category }))}
                  hasLines={quote.lines.length > 0}
                  mapsReady={mapsConfigured()}
                  longDistanceMiles={settings.longDistanceMiles}
                  cornellianPerHour={settings.cornellianDiscountPerHour}
                />
              </Disclosure>
            ) : null}
            <QuoteEditor
              lines={quote.lines.map((l) => ({ id: l.id, section: l.section, name: l.name, unit: l.unit, qtyHundredths: l.qtyHundredths, rateCents: l.rateCents, discountType: l.discountType, discountValue: l.discountValue, description: l.description }))}
              catalog={data.catalog.map((c) => ({ id: c.id, name: c.name, section: c.section, unit: c.unit, rateCents: c.rateCents, category: c.category }))}
              options={quote.options}
              editable={editable}
              addLine={addQuoteLineAction.bind(null, slug, mode, job.id)}
              removeLine={editable ? Object.fromEntries(quote.lines.map((l) => [l.id, removeQuoteLineAction.bind(null, slug, mode, job.id, l.id)])) : null}
              saveOptions={quoteOptionsAction.bind(null, slug, mode, job.id)}
            />
            {editable && data.discounts.length ? (
              <Disclosure summary="Apply a discount to every line">
                <ActionForm action={quoteDiscountAction.bind(null, slug, mode, job.id)} submitLabel="Apply" submitVariant="secondary">
                  <Field label="Discount" htmlFor="q-discount">
                    <Select id="q-discount" name="discountId">
                      {data.discounts.map((d) => <option key={d.id} value={d.id}>{`${d.name} (${d.percentBp / 100}%)`}</option>)}
                    </Select>
                  </Field>
                </ActionForm>
              </Disclosure>
            ) : null}
          </Card>

          <Card title="Estimates" description="Frozen snapshots of the quote. Only one is ever in force." flush>
            {estimates.length === 0 ? (
              <EmptyState title="No estimate sent yet." />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {estimates.map((e) => {
                  const due = depositDueByCard(e);
                  const waiting = e.status === 'sent' || e.status === 'viewed';
                  return (
                    <li key={e.id} className="space-y-2 px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{`${e.estimateNumber} v${e.version}`}</span>
                        <EstimateStatusBadge status={e.status} />
                        <span className="tabular-nums">{formatMoney(baseTotalCents(e))}{e.snapshot.convenienceFeeOn ? <span className="text-xs text-zinc-500">{` (card ${formatMoney(e.totalCents)})`}</span> : null}</span>
                        <span className="text-xs text-zinc-500">
                          {[e.createdByName ? `Made by ${e.createdByName}` : null, `Sent ${formatDateTime(e.sentAt)}`, e.viewedAt ? `viewed ${formatDateTime(e.viewedAt)}` : null, e.signedAt ? `signed ${formatDateTime(e.signedAt)} by ${e.signatureName}` : null, e.expiresAt && waiting ? `expires ${formatDateTime(e.expiresAt)}` : null].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      {e.status === 'signed' ? (
                        e.depositPaidCents > 0 ? (
                          <Note tone="green" title={`Deposit paid: ${formatMoney(e.depositPaidCents)}`} />
                        ) : (
                          <Note title={`Deposit not paid yet (${formatMoney(due.totalDueCents)} by card)`}>
                            {can(ctx, CORE.paymentsWrite) && canWrite && can(ctx, P.estimatesWrite) && (job.stage === 'estimate_sent' || job.stage === 'booked') && !openInvoice ? (
                              <ActionForm action={recordDepositAction.bind(null, slug, mode, e.id)} submitLabel="Record deposit" submitVariant="secondary">
                                <AttemptKey />
                                <Field label="Paid by" htmlFor={`dep-${e.id}`}>
                                  <Select id={`dep-${e.id}`} name="method" defaultValue="card">
                                    <option value="card">{`Card (test card) · ${formatMoney(due.totalDueCents)}`}</option>
                                    <option value="cash">{`Cash · ${formatMoney(due.depositCents)}`}</option>
                                    <option value="check">{`Check · ${formatMoney(due.depositCents)}`}</option>
                                  </Select>
                                </Field>
                              </ActionForm>
                            ) : null}
                          </Note>
                        )
                      ) : null}
                      {e.status === 'void' && e.voidReason ? <p className="text-xs text-zinc-500">{e.voidReason}</p> : null}
                      {canEstimate && (waiting || e.status === 'signed') ? (
                        <div className="flex flex-wrap gap-2">
                          <CopyLinkButton action={estimateLinkAction.bind(null, slug, mode, e.id)} />
                          {waiting ? <ConfirmButton action={resendEstimateAction.bind(null, slug, mode, e.id)}>Resend</ConfirmButton> : null}
                          {waiting ? (
                            <ConfirmButton action={voidEstimateAction.bind(null, slug, mode, e.id)} variant="danger" confirmTitle="Void this estimate?" confirmBody="The customer's link stops working and its follow-up emails are cancelled." confirmLabel="Void">
                              Void
                            </ConfirmButton>
                          ) : null}
                          {e.documentFileId && can(ctx, CORE.filesRead) ? (
                            <Link className="text-xs text-zinc-600 underline" href={`/console/${slug}/${mode}/data/core.file/${e.documentFileId}`}>Stored document</Link>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Job days" description="Each day of the move. Booking puts them on the schedule, one appointment per truck." flush>
            {days.length === 0 ? (
              <EmptyState title="No days yet." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Day</Th>
                    <Th>Start</Th>
                    <Th>Hours</Th>
                    <Th>Crew</Th>
                    <Th>Booked</Th>
                    <Th>Actual</Th>
                    <Th className="relative"><span className="sr-only">Actions</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => {
                    const appts = booked.filter((b) => b.appointment.subjectId === d.id && b.appointment.status !== 'canceled');
                    return (
                      <tr key={d.id}>
                        <Td className="whitespace-nowrap">{formatDay(d.dayDate)}</Td>
                        <Td>{d.startTime}</Td>
                        <Td>{(d.durationMinutes / 60).toFixed(1)}</Td>
                        <Td className="whitespace-nowrap">{`M:${d.crewSize} / T:${d.trucks}`}</Td>
                        <Td>{appts.length ? appts.map((a) => `${formatTime(a.appointment.startsAt, tz)} ${a.truck ?? 'no truck free'}`).join(', ') : '—'}</Td>
                        <Td>
                          {canWrite && (job.stage === 'booked' || job.stage === 'completed') && !openInvoice ? (
                            <ActionForm action={actualTimeAction.bind(null, slug, mode, job.id, d.id)} submitLabel="Save" submitVariant="ghost" resetOnSuccess={false} className="flex items-center gap-2 space-y-0">
                              <input aria-label={`Actual hours ${d.dayDate}`} name="hours" inputMode="decimal" defaultValue={d.actualMinutes !== null ? String(d.actualMinutes / 60) : ''} placeholder="h" className={`${inputClass} w-16`} />
                            </ActionForm>
                          ) : d.actualMinutes !== null ? (
                            `${(d.actualMinutes / 60).toFixed(2)} h`
                          ) : (
                            '—'
                          )}
                        </Td>
                        <Td className="text-right">
                          {canWrite && quoteEditable(job.stage) ? <ConfirmButton action={removeJobDayAction.bind(null, slug, mode, job.id, d.id)} variant="ghost">Remove</ConfirmButton> : null}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
            {canWrite && quoteEditable(job.stage) ? (
              <Disclosure summary="Add a day (multi-day move)">
                <ActionForm action={addJobDayAction.bind(null, slug, mode, job.id)} submitLabel="Add day">
                  <div className="grid gap-3 sm:grid-cols-5">
                    <Field label="Day" htmlFor="jd-day"><input id="jd-day" name="dayDate" type="date" required defaultValue={job.moveDate ?? ''} className={inputClass} /></Field>
                    <Field label="Start" htmlFor="jd-start"><input id="jd-start" name="startTime" type="time" defaultValue="08:00" className={inputClass} /></Field>
                    <Field label="Hours" htmlFor="jd-hours"><input id="jd-hours" name="hours" inputMode="decimal" defaultValue="4" className={inputClass} /></Field>
                    <Field label="Movers" htmlFor="jd-crew"><input id="jd-crew" name="crewSize" type="number" min={1} defaultValue={job.crewSize} className={inputClass} /></Field>
                    <Field label="Trucks" htmlFor="jd-trucks"><input id="jd-trucks" name="trucks" type="number" min={0} defaultValue={job.trucks} className={inputClass} /></Field>
                  </div>
                </ActionForm>
              </Disclosure>
            ) : null}
          </Card>

          {invoices !== null ? (
            <Card title="Invoices" flush>
              {invoices.length === 0 ? (
                <EmptyState title="No invoice yet.">Created after the move, from the signed estimate and the actual hours.</EmptyState>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {invoices.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                      <Link className="font-medium hover:underline" href={`${basePath}/invoices/${i.id}`}>{i.invoiceNumber}</Link>
                      <InvoiceStatusBadge status={i.status} />
                      <span className="tabular-nums">{formatMoney(baseTotalCents(i))}</span>
                      <span className="text-xs text-zinc-500">{`Balance ${formatMoney(Math.max(balanceOf(i), 0))} · due ${formatDay(i.dueDate)}`}</span>
                    </li>
                  ))}
                </ul>
              )}
              {canInvoice && canWrite && (job.stage === 'booked' || job.stage === 'completed') && !openInvoice ? (
                <div className="border-t border-zinc-200 p-4">
                  <ActionForm action={createInvoiceAction.bind(null, slug, mode, job.id)} submitLabel="Create invoice">
                    <Field label="Terms" htmlFor="inv-terms" help="Uses the signed estimate and the actual hours entered above; the deposit is subtracted.">
                      <Select id="inv-terms" name="terms" defaultValue="due_on_receipt">
                        {INVOICE_TERMS.map((t) => <option key={t} value={t}>{TERMS_LABELS[t]}</option>)}
                      </Select>
                    </Field>
                  </ActionForm>
                </div>
              ) : null}
            </Card>
          ) : null}
        </div>

        <div className="min-w-0 space-y-5">
          <Card title="Log a call or note">
            {canWrite ? (
              <ActionForm action={addJobNoteAction.bind(null, slug, mode, job.id)} submitLabel="Save">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Kind" htmlFor="jn-kind">
                    <Select id="jn-kind" name="kind" defaultValue="call">
                      <option value="call">Call</option>
                      <option value="note">Note</option>
                    </Select>
                  </Field>
                  <Field label="Call outcome" htmlFor="jn-outcome">
                    <Select id="jn-outcome" name="callOutcome" defaultValue="spoke">
                      {Object.entries(CALL_OUTCOME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </Field>
                </div>
                <Field label="Note" htmlFor="jn-body"><textarea id="jn-body" name="body" rows={2} className={areaClass} /></Field>
              </ActionForm>
            ) : null}
            {notes.length ? (
              <ul className="mt-4 space-y-2 text-sm">
                {notes.map((n) => (
                  <li key={n.id} className="border-b border-zinc-100 pb-2">
                    <span className="font-medium">{n.kind === 'call' ? CALL_OUTCOME_LABELS[n.callOutcome ?? 'spoke'] : 'Note'}</span>
                    {n.body ? ` — ${n.body}` : ''}
                    <span className="block text-xs text-zinc-500">{`${n.authorName} · ${formatDateTime(n.createdAt)}`}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          {data.payments !== null ? (
            <Card title="Payments" description={<Link className="hover:underline" href={`/console/${slug}/${mode}/data/core.payment`}>All payments</Link>}>
              {data.payments.length === 0 ? (
                <p className="text-sm text-zinc-500">None yet.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {data.payments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate">{p.description}<span className="block text-xs text-zinc-500">{`${p.method}${p.cardLast4 ? ` ·· ${p.cardLast4}` : ''} · ${formatDateTime(p.paidAt ?? p.createdAt)}`}</span></span>
                      <span className={p.status === 'succeeded' ? 'tabular-nums' : 'text-red-700 tabular-nums'}>{p.status === 'succeeded' ? formatMoney(p.amountCents) : 'Failed'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          <Card title="Emails">
            {queue.length === 0 ? (
              <p className="text-sm text-zinc-500">No automatic emails.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {queue.map((q) => (
                  <li key={q.id}>
                    {q.ruleName}
                    <span className="block text-xs text-zinc-500">{q.status === 'queued' ? `Due ${formatDateTime(q.dueAt)}` : q.status === 'sent' ? `Sent ${formatDateTime(q.sentAt)}` : `${q.status}: ${q.cancelledReason ?? ''}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {activity ? (
            <Card title="Activity">
              {activity.length === 0 ? <p className="text-sm text-zinc-500">Nothing logged yet. (Demo data is loaded without log entries.)</p> : null}
              <ul className="space-y-2 text-sm">
                {activity.map((a) => (
                  <li key={a.id}>
                    {a.summary}
                    <span className="block text-xs text-zinc-500">{`${a.actorName} · ${formatDateTime(a.occurredAt)}`}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
