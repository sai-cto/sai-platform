/**
 * The move details at the top of the quote (managers' feedback round 1, Nov 2026): everything
 * stored about the move in one panel, so the estimate is built with it all in view. Replaces
 * the one-line mileage strip that used to open the estimate builder.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { customerName } from '@/core/records/core-entities';
import { formatPhone } from '@/ui/format';
import { SERVICE_TYPE_LABELS } from '../rules';
import type { hhmcJobs } from '../schema';
import { formatRoute, routeStops } from '../services/maps';
import { decideServiceType } from '../services/service-type';
import type { SourceRecord } from '../services/source';
import { ACCESS_LABELS } from './estimate-builder';
import { Fact, formatDay } from './parts';

type Job = typeof hhmcJobs.$inferSelect;
type Customer = Parameters<typeof customerName>[0] & { id: string; email: string | null; phone: string | null };

/** Volume and weight were kept by Movegistics only: shown from the imported record when there. */
function fromMovegistics(source: SourceRecord[], key: string): string | null {
  for (const type of ['work_order', 'work_request']) {
    const value = source.find((r) => r.type === type && r.data[key]?.trim())?.data[key];
    if (value) return value.trim();
  }
  return null;
}

const access = (flags: string[], notes: string | null) =>
  [flags.map((f) => ACCESS_LABELS[f as keyof typeof ACCESS_LABELS] ?? f).join(', '), notes].filter(Boolean).join(' — ');

export function MoveDetails({
  job,
  customer,
  dayDates,
  pickedTrucks,
  source,
  lead,
  basePath,
  localMaxMiles,
  extra,
}: {
  job: Job;
  customer: Customer | null;
  /** The move's job days ("yyyy-mm-dd"), in order. */
  dayDates: string[];
  pickedTrucks: string[];
  source: SourceRecord[];
  lead: { id: string; leadNumber: string } | null;
  basePath: string;
  localMaxMiles: number;
  /** More facts at the end (the follow-up emails switch). */
  extra?: ReactNode;
}) {
  const decision = decideServiceType({
    stops: routeStops(job),
    routeStates: job.routeChecked ? job.routeStates : null,
    distanceTenths: job.distanceTenths,
    localMaxMiles,
  });
  const overridden = job.serviceTypeSource === 'manual';
  const volume = fromMovegistics(source, 'Volume');
  const weight = fromMovegistics(source, 'Weight');
  const route = formatRoute(job.distanceTenths, job.driveMinutes);
  const days = dayDates.length > 1 ? dayDates : [];
  return (
    <section aria-label="Move details" className="border-b border-zinc-200">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 md:grid-cols-4">
        <Fact label="Customer">
          {customer ? (
            <>
              <Link className="inline-flex min-h-11 items-center hover:underline sm:min-h-0" href={`${basePath}/contacts/${customer.id}`}>{customerName(customer)}</Link>
              <span className="block text-xs break-all text-zinc-500">{customer.email ?? 'No email'}</span>
              <span className="block text-xs text-zinc-500">{customer.phone ? formatPhone(customer.phone) : 'No phone'}</span>
            </>
          ) : (
            'Hidden'
          )}
        </Fact>
        <Fact label={days.length ? 'Move dates' : 'Move date'}>
          {days.length ? days.map((d) => <span key={d} className="block">{formatDay(d)}</span>) : formatDay(job.moveDate)}
          {job.tentative ? <span className="block text-xs text-amber-700">Tentative</span> : null}
          {job.arrivalWindow ? <span className="block text-xs text-zinc-500">{`Arrival ${job.arrivalWindow}`}</span> : null}
        </Fact>
        <Fact label="Service type">
          {SERVICE_TYPE_LABELS[job.serviceType]}
          <span className="block text-xs text-zinc-500">
            {overridden
              ? `Chosen by staff${job.suggestedServiceType && job.suggestedServiceType !== job.serviceType ? ` (the addresses say ${SERVICE_TYPE_LABELS[job.suggestedServiceType]})` : ''}`
              : decision.reason}
          </span>
          {decision.states.length ? <span className="block text-xs text-zinc-500">{`States: ${decision.states.join(', ')}`}</span> : null}
          {!job.routeChecked && routeStops(job).length >= 2 ? <span className="block text-xs text-amber-700">Route not checked</span> : null}
        </Fact>
        <Fact label="Job type">{job.jobType || '—'}</Fact>
        <Fact label="From">
          {job.originAddress ?? '—'}
          {access(job.originAccess, job.originNotes) ? <span className="block text-xs text-zinc-500">{access(job.originAccess, job.originNotes)}</span> : null}
        </Fact>
        <Fact label="To">
          {job.destinationAddress ?? '—'}
          {access(job.destinationAccess, job.destinationNotes) ? <span className="block text-xs text-zinc-500">{access(job.destinationAccess, job.destinationNotes)}</span> : null}
        </Fact>
        {job.extraStops.length ? <Fact label="Extra stops">{job.extraStops.map((s, i) => <span key={`${i}-${s}`} className="block">{s}</span>)}</Fact> : null}
        <Fact label="Distance">
          {route ?? '—'}
          {job.distanceSource ? <span className="block text-xs text-zinc-500">{job.distanceSource === 'maps' ? 'From Google Maps' : 'Typed in'}</span> : null}
        </Fact>
        <Fact label="Volume">{volume ?? '—'}</Fact>
        <Fact label="Weight">{weight ?? '—'}</Fact>
        <Fact label="Bedrooms">{job.bedrooms ?? '—'}</Fact>
        <Fact label="Crew and trucks">
          {`${job.crewSize} movers · ${job.ownTruck ? "customer's own truck" : `${job.trucks} truck${job.trucks === 1 ? '' : 's'}`}`}
          <span className="block text-xs text-zinc-500">{pickedTrucks.length ? `Trucks: ${pickedTrucks.join(', ')}` : 'Any free truck'}</span>
          {job.cornellian ? <span className="block text-xs text-zinc-500">Cornellian</span> : null}
        </Fact>
        <Fact label="Source">
          {`${job.source}${job.sourceDetail ? ` · ${job.sourceDetail}` : ''}`}
          {lead ? <Link className="flex min-h-11 items-center text-xs hover:underline sm:block sm:min-h-0" href={`${basePath}/leads/${lead.id}`}>{`From lead ${lead.leadNumber}`}</Link> : null}
        </Fact>
        <Fact label="Owner">
          {job.ownerName ?? '—'}
          {job.coordinators.length ? <span className="block text-xs text-zinc-500">{`Coordinators: ${job.coordinators.join(', ')}`}</span> : null}
        </Fact>
        {job.rating ? <Fact label="Rating">{job.rating.charAt(0).toUpperCase() + job.rating.slice(1)}</Fact> : null}
        {job.companyName || job.poNumber ? <Fact label="Company / PO">{[job.companyName, job.poNumber].filter(Boolean).join(' · ')}</Fact> : null}
        {job.lostReason ? <Fact label="Lost because">{job.lostReason}</Fact> : null}
        {job.cancelledReason ? <Fact label="Cancelled because">{job.cancelledReason}</Fact> : null}
        {extra}
      </dl>
      {job.customerComments || job.scopeOfWork || job.internalNotes ? (
        <dl className="grid gap-x-6 gap-y-3 px-4 pb-4 md:grid-cols-3">
          {job.customerComments ? <Fact label="Customer comments">{job.customerComments}</Fact> : null}
          {job.scopeOfWork ? <Fact label="Scope of work">{job.scopeOfWork}</Fact> : null}
          {job.internalNotes ? <Fact label="Internal notes">{job.internalNotes}</Fact> : null}
        </dl>
      ) : null}
    </section>
  );
}
