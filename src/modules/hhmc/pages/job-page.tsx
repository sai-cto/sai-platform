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
import { cn } from '@/ui/cn';
import { formatClock, formatDateTime, formatMoney } from '@/ui/format';
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
  rescheduleJobAction,
  removeJobDayAction,
  removeQuoteLineAction,
  reopenJobAction,
  resendEstimateAction,
  sendEstimateAction,
  updateJobAction,
  voidEstimateAction,
} from '../actions';
import { CORE, P } from '../permissions';
import { CALL_OUTCOME_LABELS, localDate, quoteEditable, TERMS_LABELS } from '../rules';
import { INVOICE_TERMS } from '../schema';
import { depositDueByCard } from '../services/estimates';
import { balanceOf } from '../services/invoices';
import { baseTotalCents } from '../services/pricing';
import { jobActivity, jobPage } from '../services/views';
import { CopyLinkButton } from './copy-link';
import { AttemptKey } from './attempt-key';
import { Disclosure } from './disclosure';
import { JobFields, areaClass } from './jobs';
import { ManualPaymentFields } from './payment-fields';
import { Check, EstimateStatusBadge, Fact, InvoiceStatusBadge, Note, Select, StageBadge, formatDay, formatTime } from './parts';
import { QuoteEditor } from './quote-editor';
import { MoveDetails } from './move-details';
import { EstimateBuilder } from './estimate-builder';
import { loadSettings } from '../settings';
import { directionsLink, embedMapUrl, formatRoute, mapsConfigured, routeStops } from '../services/maps';
import { depositCovered, listTrucks } from '../services/booking';
import { lookupMileageAction, setMileageAction } from '../actions';
import { SourceRecords } from './source-records';

export async function JobPage({ ctx, params, basePath }: PortalPageProps) {
  const data = await jobPage(ctx, params.id);
  const { job, customer, quote, estimates, liveEstimate, days, booked, invoices, notes, queue, emailLog, source } = data;
  const depositPaid = data.depositPaid;
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
  // Confirmed = the 20% deposit is paid (managers' feedback round 1): bookJob refuses otherwise.
  const depositOk = signed !== null && depositCovered(depositPaid, signed.depositCents);
  const settings = await loadSettings(ctx);
  const fleet = await listTrucks(ctx);
  const pickedTrucks = job.truckIds.map((id) => fleet.find((t) => t.id === id)?.name).filter((n): n is string => Boolean(n));
  const stops = routeStops(job);
  const mapLink = directionsLink(stops);
  const embed = embedMapUrl(stops);
  const routeText = formatRoute(job.distanceTenths, job.driveMinutes);
  const mapsReady = mapsConfigured();
  const longDistance = job.distanceTenths !== null && job.distanceTenths > Math.round(settings.longDistanceMiles * 10);

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
            {data.readyToBook && depositOk ? <Badge tone="green">Ready to confirm</Badge> : null}
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
            {canBook && job.stage === 'estimate_sent' && signed && !depositOk ? (
              <span className="text-xs text-amber-800">{`Confirmed once the deposit (${formatMoney(signed.depositCents)}) is paid: only then does the move go on the calendar.`}</span>
            ) : null}
            {canBook && job.stage === 'estimate_sent' && signed && depositOk && days.length === 0 ? (
              <span className="text-xs text-amber-800">Add a job day (the move date) below before confirming.</span>
            ) : null}
            {canBook && job.stage === 'estimate_sent' && signed && depositOk && days.length > 0 ? (
              <ConfirmButton
                action={bookJobAction.bind(null, slug, mode, job.id)}
                variant="primary"
                confirmTitle="Confirm this move?"
                confirmBody={`The deposit is paid. Puts ${days.length} job day${days.length === 1 ? '' : 's'} on the calendar as the official work order and emails "You're booked". The balance stays due.`}
                confirmLabel="Confirm"
              >
                Confirm move
              </ConfirmButton>
            ) : null}
            {canBook && job.stage === 'estimate_sent' && signed && depositOk && days.length > 0 ? (
              <ConfirmButton
                action={bookJobAction.bind(null, slug, mode, job.id, true)}
                confirmTitle="Confirm without a truck for now?"
                confirmBody="Confirms the move even if no truck is free on a day; the calendar shows it as having no truck yet until you sort the trucks out."
                confirmLabel="Confirm without a truck"
              >
                Confirm without a truck
              </ConfirmButton>
            ) : null}
            {canBook && job.stage === 'booked' ? (
              <ConfirmButton action={releaseBookingAction.bind(null, slug, mode, job.id)} confirmTitle="Take it off the calendar?" confirmBody="Its appointments are cancelled and the job goes back to Estimate sent." confirmLabel="Release">
                Release (unconfirm)
              </ConfirmButton>
            ) : null}
            {canWrite && job.stage === 'lost' ? <ConfirmButton action={reopenJobAction.bind(null, slug, mode, job.id)}>Reopen</ConfirmButton> : null}
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="min-w-0 space-y-5 xl:col-span-2">
          <Card title="Quote" description={editable ? 'The one price for this move. Sending makes a frozen, versioned estimate.' : 'Locked: the signed estimate is the price.'} flush>
            <MoveDetails
              job={job}
              customer={customer}
              dayDates={days.map((d) => d.dayDate)}
              pickedTrucks={pickedTrucks}
              source={source}
              lead={data.lead}
              basePath={basePath}
              localMaxMiles={settings.localServiceMaxMiles}
              extra={
                <>
                  <Fact label="Follow-up emails">
                    {job.automationOptIn ? 'On' : 'Off'}
                    {canWrite ? (
                      <span className="ml-2">
                        <ConfirmButton action={optInAction.bind(null, slug, mode, job.id, !job.automationOptIn)} variant="ghost">{job.automationOptIn ? 'Turn off' : 'Turn on'}</ConfirmButton>
                      </span>
                    ) : null}
                  </Fact>
                </>
              }
            />
            {canWrite && job.stage !== 'closed' && job.stage !== 'cancelled' ? (
              <Disclosure summary="Edit move details">
                <ActionForm action={updateJobAction.bind(null, slug, mode, job.id)} submitLabel="Save" resetOnSuccess={false}>
                  <JobFields show="details" job={job} trucks={fleet} dateLocked={job.stage === 'booked' ? 'Confirmed: change the date with Reschedule.' : job.stage === 'completed' ? 'The move is done.' : undefined} />
                </ActionForm>
              </Disclosure>
            ) : null}
            {editable ? (
              <Disclosure summary="Build the estimate from the move details" startOpen={quote.lines.length === 0}>
                <EstimateBuilder
                  slug={slug}
                  mode={mode}
                  job={job}
                  catalog={data.catalog.map((c) => ({ id: c.id, name: c.name, section: c.section, unit: c.unit, rateCents: c.rateCents, category: c.category }))}
                  hasLines={quote.lines.length > 0}
                  pickedTrucks={pickedTrucks}
                  cornellianPerHour={settings.cornellianDiscountPerHour}
                  route={{ text: routeText, embed }}
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

          <Card title="Locations" flush>
            {canWrite && job.stage !== 'closed' && job.stage !== 'cancelled' ? (
              <Disclosure summary="Change details">
                <ActionForm action={updateJobAction.bind(null, slug, mode, job.id)} submitLabel="Save" resetOnSuccess={false}>
                  <JobFields show="locations" job={job} />
                </ActionForm>
              </Disclosure>
            ) : (
              <p className="p-4 text-sm text-zinc-500">{routeStops(job).join(' → ') || 'No addresses.'}</p>
            )}
            {canBook && job.stage === 'booked' ? (
              <Disclosure summary="Reschedule">
                <ActionForm action={rescheduleJobAction.bind(null, slug, mode, job.id)} submitLabel="Reschedule">
                  <p className="text-sm text-zinc-600">{`Every day moves by the same number of days (now ${days.map((d) => formatDay(d.dayDate)).join(', ')}). Trucks are checked again for the new days.`}</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="New move date" htmlFor="rs-date"><input id="rs-date" name="date" type="date" required min={localDate(new Date(), ctx.business.timeZone)} defaultValue={days[0]?.dayDate ?? ''} className={inputClass} /></Field>
                    <Field label="New start time (optional)" htmlFor="rs-time"><input id="rs-time" name="startTime" type="time" className={inputClass} /></Field>
                    <Field label="Reason (optional)" htmlFor="rs-reason"><input id="rs-reason" name="reason" maxLength={300} className={inputClass} placeholder="e.g. Customer asked" /></Field>
                  </div>
                  <Check name="allowNoTruck" label="Book without a truck if none is free" />
                </ActionForm>
              </Disclosure>
            ) : null}
          </Card>

          <Card title="Route and mileage" flush>
            <div className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0 space-y-1 text-sm">
                <p className="text-2xl font-semibold tabular-nums" data-testid="route-miles">
                  {routeText ?? 'Mileage not set'}
                </p>
                <p className="text-xs text-zinc-500">
                  {job.distanceSource === 'maps'
                    ? `From Google Maps, through ${stops.length} stop${stops.length === 1 ? '' : 's'}.`
                    : job.distanceSource === 'manual'
                      ? 'Typed in by staff.'
                      : stops.length < 2
                        ? 'Add both addresses to get the mileage.'
                        : mapsReady
                          ? 'Google Maps could not find a driving route through these addresses. Check the addresses, or a manager can enter the miles below.'
                          : 'Automatic mileage is not set up yet. A manager can enter the miles below.'}
                  {routeText ? (longDistance ? ` Long distance (over ${settings.longDistanceMiles} mi).` : ` Local (up to ${settings.longDistanceMiles} mi).`) : ''}
                </p>
                <ol className="mt-2 space-y-0.5 text-sm">
                  {stops.map((stop, i) => (
                    <li key={`${i}-${stop}`}>
                      <span className="mr-1.5 inline-block w-14 text-xs text-zinc-500">{i === 0 ? 'Pick-up' : i === stops.length - 1 ? 'Drop-off' : `Stop ${i}`}</span>
                      {stop}
                    </li>
                  ))}
                </ol>
              </div>
              <div className="flex flex-wrap gap-2">
                {mapLink ? (
                  <a href={mapLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 sm:min-h-0">
                    Open in Google Maps ↗
                  </a>
                ) : null}
                {mapsReady && editable && stops.length >= 2 ? (
                  <ConfirmButton action={lookupMileageAction.bind(null, slug, mode, job.id)} variant="secondary">
                    {job.distanceTenths === null ? 'Look up mileage' : 'Look up again'}
                  </ConfirmButton>
                ) : null}
              </div>
            </div>
            {canBook && editable && stops.length >= 2 ? (
              <div className="border-t border-zinc-200 px-4 py-3">
                <Disclosure summary={job.distanceTenths === null ? 'Enter the miles by hand' : 'Override the miles'}>
                  <ActionForm action={setMileageAction.bind(null, slug, mode, job.id)} submitLabel="Set miles" resetOnSuccess={false}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Miles" htmlFor="mi-miles"><input id="mi-miles" name="miles" inputMode="decimal" required className={inputClass} placeholder="e.g. 212.4" defaultValue={job.distanceTenths !== null ? (job.distanceTenths / 10).toFixed(1) : ''} /></Field>
                      <Field label="Drive time in minutes (optional)" htmlFor="mi-minutes"><input id="mi-minutes" name="driveMinutes" inputMode="numeric" className={inputClass} placeholder="e.g. 245" defaultValue={job.driveMinutes ?? ''} /></Field>
                    </div>
                    <p className="text-xs text-zinc-500">Used for pricing and the service type. The change is logged in the notes.</p>
                  </ActionForm>
                </Disclosure>
              </div>
            ) : null}
            {embed ? (
              <iframe
                title="Route map"
                src={embed}
                className="h-72 w-full border-t border-zinc-200"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
              />
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
                          <Note title={`Deposit not paid yet: ${formatMoney(due.depositCents)}${due.totalDueCents !== due.depositCents ? ` (${formatMoney(due.totalDueCents)} by card)` : ''}`}>
                            {can(ctx, CORE.paymentsWrite) && canWrite && can(ctx, P.estimatesWrite) && (job.stage === 'estimate_sent' || job.stage === 'booked') && !openInvoice ? (
                              <ActionForm action={recordDepositAction.bind(null, slug, mode, e.id)} submitLabel="Record deposit" submitVariant="secondary">
                                <AttemptKey />
                                <ManualPaymentFields id={`dep-${e.id}`} today={localDate(new Date(), ctx.business.timeZone)} amountFor={(m) => formatMoney(m === 'card' ? due.totalDueCents : due.depositCents)} />
                              </ActionForm>
                            ) : null}
                          </Note>
                        )
                      ) : null}
                      {e.status === 'void' && e.voidReason ? <p className="text-xs text-zinc-500">{e.voidReason}</p> : null}
                      <Link href={`${basePath}/estimates/${e.id}/print`} className="inline-flex min-h-11 items-center text-xs text-zinc-600 underline hover:text-zinc-900 sm:min-h-0">
                        Print / PDF
                      </Link>
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
                        <Td className="whitespace-nowrap">{formatClock(d.startTime)}</Td>
                        <Td>{(d.durationMinutes / 60).toFixed(1)}</Td>
                        <Td className="whitespace-nowrap">{`M:${d.crewSize} / T:${d.trucks}`}</Td>
                        <Td>{appts.length ? appts.map((a) => `${formatTime(a.appointment.startsAt, tz)} ${a.truck ?? 'no truck free'}`).join(', ') : '—'}</Td>
                        <Td>
                          {canWrite && (job.stage === 'booked' || job.stage === 'completed') && !openInvoice ? (
                            <ActionForm action={actualTimeAction.bind(null, slug, mode, job.id, d.id)} submitLabel="Save" submitVariant="ghost" resetOnSuccess={false} className="flex items-center gap-2 space-y-0">
                              <input aria-label={`Actual hours ${d.dayDate}`} name="hours" inputMode="decimal" defaultValue={d.actualMinutes !== null ? String(d.actualMinutes / 60) : ''} placeholder="h" className={cn(inputClass, 'w-20 shrink-0')} />
                            </ActionForm>
                          ) : d.actualMinutes !== null ? (
                            `${(d.actualMinutes / 60).toFixed(2)} h`
                          ) : (
                            '—'
                          )}
                        </Td>
                        <Td className="sticky right-0 bg-white text-right">
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
                      <Link className="inline-flex min-h-11 items-center font-medium hover:underline sm:min-h-0" href={`${basePath}/invoices/${i.id}`}>{i.invoiceNumber}</Link>
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
          {canWrite && ['qualified', 'estimate_sent', 'booked'].includes(job.stage) ? (
            <Card title="Close this work request" flush>
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
                  {depositPaid > 0 ? (
                    <Field label={`The deposit (${formatMoney(depositPaid)})`} htmlFor="cancel-deposit" help="Nothing is refunded by the software: refund it where it was taken (Shopify, check) and record it here.">
                      <Select id="cancel-deposit" name="deposit" required defaultValue="">
                        <option value="" disabled>Choose…</option>
                        <option value="kept">Kept (not refunded)</option>
                        <option value="refund">To be refunded outside the software</option>
                      </Select>
                    </Field>
                  ) : null}
                </ActionForm>
              </Disclosure>
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
            <LeadNotes lead={data.lead} job={job} />
            {notes.length ? (
              <ul className="mt-4 space-y-2 text-sm">
                {notes.map((n) => (
                  <li key={n.id} className="border-b border-zinc-100 pb-2">
                    <span className="font-medium">{n.kind === 'call' ? CALL_OUTCOME_LABELS[n.callOutcome ?? 'spoke'] : 'Note'}</span>
                    {n.body ? ` — ${n.body}` : ''}
                    <span className="block text-xs text-zinc-500">{`${n.authorName} · ${formatDateTime(n.createdAt)}${n.jobId !== job.id && data.lead ? ` · from lead ${data.lead.leadNumber}` : ''}`}</span>
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
                      <span className="min-w-0 truncate">{p.description}<span className="block text-xs text-zinc-500">{`${p.method ? p.method.charAt(0).toUpperCase() + p.method.slice(1) : ''}${p.cardLast4 ? ` ·· ${p.cardLast4}` : ''} · ${formatDateTime(p.paidAt ?? p.createdAt)}`}</span></span>
                      <span className={p.status === 'succeeded' ? 'tabular-nums' : 'text-red-700 tabular-nums'}>{p.status === 'succeeded' ? formatMoney(p.amountCents) : 'Failed'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          <Card title="Emails">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Automatic emails</h3>
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
            {emailLog ? (
              <>
                <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Emails sent</h3>
                {emailLog.length === 0 ? (
                  <p className="text-sm text-zinc-500">None yet.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {emailLog.map((m) => (
                      <li key={m.id}>
                        {m.subject}
                        <span className="block text-xs text-zinc-500">
                          {formatDateTime(m.createdAt)} · to {m.recipient} ·{' '}
                          {m.status === 'failed' ? `not sent: ${m.error ?? 'failed'}` : m.adapter === 'console-email' ? 'held, not emailed (real email is switched off for this address)' : 'emailed'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : null}
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
          <SourceRecords records={source} />
        </div>
      </div>
    </>
  );
}

/** The notes typed on the lead, when the work request does not already carry them word for word. */
function LeadNotes({ lead, job }: { lead: { leadNumber: string; customerNote: string | null; internalNote: string | null } | null; job: { customerComments: string | null; internalNotes: string | null } }) {
  if (!lead) return null;
  const rows = [
    { label: 'Customer note', text: lead.customerNote, kept: job.customerComments },
    { label: 'Internal note', text: lead.internalNote, kept: job.internalNotes },
  ].filter((r) => r.text?.trim() && r.text.trim() !== r.kept?.trim());
  if (!rows.length) return null;
  return (
    <ul className="mt-4 space-y-2 text-sm">
      {rows.map((r) => (
        <li key={r.label} className="border-b border-zinc-100 pb-2">
          <span className="font-medium">{r.label}</span>
          {` — ${r.text}`}
          <span className="block text-xs text-zinc-500">{`From lead ${lead.leadNumber}`}</span>
        </li>
      ))}
    </ul>
  );
}
