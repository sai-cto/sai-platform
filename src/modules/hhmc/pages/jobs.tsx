/** Work requests (jobs): the list and a new one. The Job page itself is job-page.tsx. */
import Link from 'next/link';
import { listCustomers } from '@/core/customers/customers';
import type { PortalPageProps } from '@/core/modules/contract';
import { can } from '@/core/rbac/permissions';
import { customerName } from '@/core/records/core-entities';
import { ActionForm } from '@/ui/action-form';
import { buttonClass } from '@/ui/button';

import { Card, EmptyState, Field, PageHeader, Table, Td, Th, inputClass } from '@/ui/layout';
import { Pagination } from '@/ui/pagination';
import { createJobAction } from '../actions';
import { CORE, P } from '../permissions';
import { BEDROOMS, JOB_TYPES, SERVICE_TYPE_LABELS, STAGE_LABELS } from '../rules';
import { LEAD_SOURCES, SERVICE_TYPES, STAGES, type hhmcJobs, type Stage } from '../schema';
import { contactPage } from '../services/directory';
import { JOBS_PAGE_SIZE, listJobs } from '../services/jobs';
import { Check, Select, StageBadge, formatDay, hrefWith } from './parts';

export const areaClass = `${inputClass} h-auto py-1.5`;

export async function JobsPage({ ctx, searchParams, basePath }: PortalPageProps) {
  const choices = ['open', 'all', ...STAGES] as const;
  const stage = choices.find((c) => c === searchParams.stage) ?? 'open';
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1);
  const { rows, total } = await listJobs(ctx, { stage: stage as Stage | 'open' | 'all', q: searchParams.q, page });
  const base = `${basePath}/jobs`;
  return (
    <>
      <PageHeader
        title="Work requests"
        description="One record per move, from first estimate to closed (Movegistics' work request and work order in one)."
        actions={can(ctx, P.jobsWrite) && can(ctx, CORE.customersRead) ? <Link href={`${base}/new`} className={buttonClass({ variant: 'primary' })}>New work request</Link> : null}
      />
      <Card flush>
        <form className="flex flex-wrap items-end gap-3 border-b border-zinc-200 p-3" action={base}>
          <Field label="Stage" htmlFor="job-stage">
            <Select id="job-stage" name="stage" defaultValue={stage}>
              <option value="open">In progress</option>
              <option value="all">All</option>
              {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
            </Select>
          </Field>
          <Field label="Search" htmlFor="job-q">
            <input id="job-q" name="q" defaultValue={searchParams.q ?? ''} placeholder="Customer, address, J-number" className={inputClass} />
          </Field>
          <button type="submit" className={buttonClass({ variant: 'secondary' })}>Show</button>
        </form>
        {rows.length === 0 ? (
          <EmptyState title="No work requests match." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Work request</Th>
                <Th>Customer</Th>
                <Th>Move date</Th>
                <Th>Service</Th>
                <Th>Crew</Th>
                <Th>Stage</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ job, customer }) => (
                <tr key={job.id} className="hover:bg-zinc-50">
                  <Td><Link className="font-medium hover:underline" href={`${base}/${job.id}`}>{job.jobNumber}</Link></Td>
                  <Td>{customerName(customer)}<span className="block max-w-[16rem] truncate text-xs text-zinc-500">{job.originAddress ?? ''}</span></Td>
                  <Td className="whitespace-nowrap">{formatDay(job.moveDate)}{job.tentative ? <span className="block text-xs text-amber-700">Tentative</span> : null}</Td>
                  <Td>{SERVICE_TYPE_LABELS[job.serviceType]}<span className="block text-xs text-zinc-500">{job.jobType}</span></Td>
                  <Td className="whitespace-nowrap">M:{job.crewSize} / T:{job.trucks}</Td>
                  <Td><StageBadge stage={job.stage} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={JOBS_PAGE_SIZE} total={total} hrefFor={(p) => hrefWith(base, searchParams, { page: p > 1 ? String(p) : undefined })} />
      </Card>
    </>
  );
}

/** The fields of a job, used by "New job" and "Change details" on the Job page. */
export function JobFields({ job }: { job?: typeof hhmcJobs.$inferSelect }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Service type" htmlFor="jf-service">
          <Select id="jf-service" name="serviceType" defaultValue={job?.serviceType ?? 'local'}>
            {SERVICE_TYPES.map((t) => <option key={t} value={t}>{SERVICE_TYPE_LABELS[t]}</option>)}
          </Select>
        </Field>
        <Field label="Job type" htmlFor="jf-type">
          <Select id="jf-type" name="jobType" defaultValue={job?.jobType ?? 'Local Full Service Move'}>
            {SERVICE_TYPES.map((t) => (
              <optgroup key={t} label={SERVICE_TYPE_LABELS[t]}>
                {JOB_TYPES[t].map((j) => <option key={j} value={j}>{j}</option>)}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Move date" htmlFor="jf-date"><input id="jf-date" name="moveDate" type="date" defaultValue={job?.moveDate ?? ''} className={inputClass} /></Field>
        <Field label="Arrival window" htmlFor="jf-window"><input id="jf-window" name="arrivalWindow" defaultValue={job?.arrivalWindow ?? ''} placeholder="8:00–9:00 AM" className={inputClass} /></Field>
        <Field label="Movers" htmlFor="jf-crew"><input id="jf-crew" name="crewSize" type="number" min={1} max={20} defaultValue={job?.crewSize ?? 2} className={inputClass} /></Field>
        <Field label="Trucks" htmlFor="jf-trucks"><input id="jf-trucks" name="trucks" type="number" min={0} max={10} defaultValue={job?.trucks ?? 1} className={inputClass} /></Field>
        <Field label="Bedrooms" htmlFor="jf-bed">
          <Select id="jf-bed" name="bedrooms" defaultValue={job?.bedrooms ?? ''}>
            <option value="">—</option>
            {BEDROOMS.map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
        </Field>
        <div className="flex items-end pb-2"><Check name="tentative" label="Date is tentative" defaultChecked={job?.tentative} /></div>
        <Field label="From address" htmlFor="jf-from" className="sm:col-span-2"><input id="jf-from" name="originAddress" defaultValue={job?.originAddress ?? ''} className={inputClass} /></Field>
        <Field label="To address" htmlFor="jf-to" className="sm:col-span-2"><input id="jf-to" name="destinationAddress" defaultValue={job?.destinationAddress ?? ''} className={inputClass} /></Field>
        <Field label="Extra stops" htmlFor="jf-stops" help="One per line." className="sm:col-span-2"><textarea id="jf-stops" name="extraStops" rows={2} defaultValue={(job?.extraStops ?? []).join('\n')} className={areaClass} /></Field>
        <Field label="Company" htmlFor="jf-company"><input id="jf-company" name="companyName" defaultValue={job?.companyName ?? ''} className={inputClass} /></Field>
        <Field label="PO number" htmlFor="jf-po"><input id="jf-po" name="poNumber" defaultValue={job?.poNumber ?? ''} className={inputClass} /></Field>
        <Field label="Source" htmlFor="jf-source">
          <Select id="jf-source" name="source" defaultValue={job?.source ?? 'Other'}>
            {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Source detail" htmlFor="jf-sdetail"><input id="jf-sdetail" name="sourceDetail" defaultValue={job?.sourceDetail ?? ''} className={inputClass} /></Field>
        <Field label="Owner" htmlFor="jf-owner"><input id="jf-owner" name="ownerName" defaultValue={job?.ownerName ?? ''} placeholder="You" className={inputClass} /></Field>
        <Field label="Coordinators" htmlFor="jf-coord" help="Names, separated by commas."><input id="jf-coord" name="coordinators" defaultValue={(job?.coordinators ?? []).join(', ')} className={inputClass} /></Field>
        <Field label="Rating" htmlFor="jf-rating">
          <Select id="jf-rating" name="rating" defaultValue={job?.rating ?? ''}>
            <option value="">—</option>
            <option value="hot">Hot</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Customer comments" htmlFor="jf-cc"><textarea id="jf-cc" name="customerComments" rows={3} defaultValue={job?.customerComments ?? ''} className={areaClass} /></Field>
        <Field label="Scope of work" htmlFor="jf-scope" help="Shown on the estimate."><textarea id="jf-scope" name="scopeOfWork" rows={3} defaultValue={job?.scopeOfWork ?? ''} className={areaClass} /></Field>
        <Field label="Internal notes" htmlFor="jf-notes"><textarea id="jf-notes" name="internalNotes" rows={3} defaultValue={job?.internalNotes ?? ''} className={areaClass} /></Field>
      </div>
    </>
  );
}

export async function NewJobPage({ ctx, basePath, searchParams }: PortalPageProps) {
  const { rows } = await listCustomers(ctx, { limit: 500 });
  // Repeat customer (Contacts → "New estimate / work request"): keep who they are and how they
  // usually move; only the new addresses and dates need entering.
  const repeat = searchParams.customer ? await contactPage(ctx, searchParams.customer).catch(() => null) : null;
  const last = repeat?.lastJob ?? null;
  const prefill = last
    ? { ...last, moveDate: null, tentative: false, originAddress: null, destinationAddress: null, extraStops: [], source: 'Repeat Customer' as const, sourceDetail: last.jobNumber, customerComments: null, scopeOfWork: null, internalNotes: null, arrivalWindow: null }
    : undefined;
  const choices = repeat && !rows.some((c) => c.id === repeat.customer.id) ? [repeat.customer, ...rows] : rows;
  return (
    <>
      <PageHeader
        title={repeat ? `New estimate / work request for ${customerName(repeat.customer)}` : 'New work request'}
        description={
          <>
            <Link href={repeat ? `${basePath}/contacts/${repeat.customer.id}` : `${basePath}/jobs`} className="hover:underline">{repeat ? '← Back to the contact' : '← All work requests'}</Link>
            {repeat ? ' · Their contact details are kept. Enter the new addresses and date.' : ' · Most work requests start from a lead (Leads → Convert). For a repeat customer, open them under Contacts.'}
          </>
        }
      />
      <Card>
        <ActionForm action={createJobAction.bind(null, ctx.business.slug, ctx.environment)} submitLabel="Create work request">
          <Field label="Customer" htmlFor="nj-customer" help={<>Not listed? Add a lead, or add them under <Link className="underline" href={`/console/${ctx.business.slug}/${ctx.environment}/data/core.customer`}>Data → Customers</Link>.</>}>
            <Select id="nj-customer" name="customerId" defaultValue={repeat?.customer.id ?? ''}>
              <option value="" disabled>Choose a customer…</option>
              {choices.map((c) => <option key={c.id} value={c.id}>{`${customerName(c)}${c.email ? ` · ${c.email}` : ''}`}</option>)}
            </Select>
          </Field>
          {last ? (
            <p className="text-xs text-zinc-500">{`Last move (${last.jobNumber}, ${formatDay(last.moveDate)}): ${[last.originAddress, last.destinationAddress].filter(Boolean).join(' → ') || 'no addresses'}`}</p>
          ) : null}
          <JobFields job={prefill} />
        </ActionForm>
      </Card>
    </>
  );
}
