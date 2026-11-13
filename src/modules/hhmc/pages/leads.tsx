/** Leads (ref §3.2): the list, adding one, and one lead with disqualify / couldn't reach / convert. */
import Link from 'next/link';
import { Badge } from '@/ui/badge';
import type { PortalPageProps } from '@/core/modules/contract';
import { can } from '@/core/rbac/permissions';
import { ActionForm } from '@/ui/action-form';
import { buttonClass } from '@/ui/button';
import { ConfirmButton } from '@/ui/confirm-button';
import { formatDate, formatDateTime, formatRelative } from '@/ui/format';
import { Card, EmptyState, Field, PageHeader, Table, Td, Th, inputClass } from '@/ui/layout';
import { Pagination } from '@/ui/pagination';
import {
  addLeadNoteAction,
  convertLeadAction,
  createLeadAction,
  disqualifyLeadAction,
  noContactAction,
  reopenLeadAction,
  updateLeadAction,
} from '../actions';
import { listTrucks } from '../services/booking';
import { TruckPicker } from './jobs';
import { CORE, P } from '../permissions';
import { BEDROOMS, CALL_OUTCOME_LABELS, JOB_TYPES, LEAD_STATUS_LABELS, SERVICE_TYPE_LABELS } from '../rules';
import { LEAD_SOURCES, SERVICE_TYPES, type hhmcLeads, type LeadStatus } from '../schema';
import { conversionPreview, LEADS_PAGE_SIZE, listLeads } from '../services/leads';
import { leadPage } from '../services/views';
import { Disclosure } from './disclosure';
import { areaClass } from './jobs';
import { Check, Fact, LeadStatusBadge, Note, Select, formatDay, hrefWith } from './parts';
import { SourceRecords } from './source-records';
import { formatPhone } from '@/ui/format';

type Lead = typeof hhmcLeads.$inferSelect;

export async function LeadsPage({ ctx, searchParams, basePath }: PortalPageProps) {
  const statuses = ['new', 'disqualified', 'converted', 'all'] as const;
  const status = statuses.find((s) => s === searchParams.status) ?? 'new';
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1);
  const { rows, total } = await listLeads(ctx, {
    status: status as LeadStatus | 'all',
    source: searchParams.source,
    q: searchParams.q,
    page,
  });
  const base = `${basePath}/leads`;
  return (
    <>
      <PageHeader
        title="Leads"
        description="Inquiries before a job exists. Convert a lead to start its job."
        actions={can(ctx, P.leadsWrite) ? <Link href={`${base}/new`} className={buttonClass({ variant: 'primary' })}>Add lead</Link> : null}
      />
      <Card flush>
        <form className="flex flex-wrap items-end gap-3 border-b border-zinc-200 p-3" action={base}>
          <Field label="Status" htmlFor="lead-status">
            <Select id="lead-status" name="status" defaultValue={status}>
              {statuses.map((s) => (
                <option key={s} value={s}>{s === 'all' ? 'All' : LEAD_STATUS_LABELS[s]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Source" htmlFor="lead-source">
            <Select id="lead-source" name="source" defaultValue={searchParams.source ?? ''}>
              <option value="">Any</option>
              {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Search" htmlFor="lead-q">
            <input id="lead-q" name="q" defaultValue={searchParams.q ?? ''} placeholder="Name, email, phone, L-number" className={inputClass} />
          </Field>
          <button type="submit" className={buttonClass({ variant: 'secondary' })}>Show</button>
        </form>
        {rows.length === 0 ? (
          <EmptyState title="No leads match." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Lead</Th>
                <Th>Name</Th>
                <Th>Source</Th>
                <Th>Move date</Th>
                <Th>Status</Th>
                <Th>Waiting</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((lead) => (
                <tr key={lead.id} className="hover:bg-zinc-50">
                  <Td><Link className="font-medium hover:underline" href={`${base}/${lead.id}`}>{lead.leadNumber}</Link></Td>
                  <Td>
                    {`${lead.firstName} ${lead.lastName}`.trim()}
                    <span className="block text-xs text-zinc-500">{lead.email ?? formatPhone(lead.phone)}</span>
                  </Td>
                  <Td>{lead.source}{lead.sourceDetail ? <span className="block text-xs text-zinc-500">{lead.sourceDetail}</span> : null}</Td>
                  <Td className="whitespace-nowrap">{formatDay(lead.moveDate)}</Td>
                  <Td><LeadStatusBadge status={lead.status} />{lead.status === 'new' && lead.noContactStartedAt ? <span className="ml-1"><Badge tone="amber">No contact</Badge></span> : null}</Td>
                  <Td className="whitespace-nowrap text-zinc-500">{formatRelative(lead.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={LEADS_PAGE_SIZE} total={total} hrefFor={(p) => hrefWith(base, searchParams, { page: p > 1 ? String(p) : undefined })} />
      </Card>
    </>
  );
}

function LeadFields({ lead }: { lead?: Lead }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="First name" htmlFor="lf-first"><input id="lf-first" name="firstName" defaultValue={lead?.firstName} className={inputClass} /></Field>
        <Field label="Last name" htmlFor="lf-last"><input id="lf-last" name="lastName" defaultValue={lead?.lastName} className={inputClass} /></Field>
        <Field label="Email" htmlFor="lf-email"><input id="lf-email" name="email" type="email" defaultValue={lead?.email ?? ''} className={inputClass} /></Field>
        <Field label="Phone" htmlFor="lf-phone"><input id="lf-phone" name="phone" type="tel" defaultValue={lead?.phone ?? ''} className={inputClass} /></Field>
        <Field label="Source" htmlFor="lf-source">
          <Select id="lf-source" name="source" defaultValue={lead?.source ?? 'Website'}>
            {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Source detail" htmlFor="lf-detail" help="Free text, e.g. who referred them."><input id="lf-detail" name="sourceDetail" defaultValue={lead?.sourceDetail ?? ''} className={inputClass} /></Field>
        <Field label="Move date" htmlFor="lf-date"><input id="lf-date" name="moveDate" type="date" defaultValue={lead?.moveDate ?? ''} className={inputClass} /></Field>
        <Field label="Bedrooms" htmlFor="lf-bed">
          <Select id="lf-bed" name="bedrooms" defaultValue={lead?.bedrooms ?? ''}>
            <option value="">—</option>
            {BEDROOMS.map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
        </Field>
        <Field label="Move type" htmlFor="lf-type">
          <Select id="lf-type" name="moveType" defaultValue={lead?.moveType ?? 'residential'}>
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
          </Select>
        </Field>
        <Field label="Rating" htmlFor="lf-rating">
          <Select id="lf-rating" name="rating" defaultValue={lead?.rating ?? ''}>
            <option value="">—</option>
            <option value="hot">Hot</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
          </Select>
        </Field>
        <Field label="Owner" htmlFor="lf-owner"><input id="lf-owner" name="ownerName" defaultValue={lead?.ownerName ?? ''} placeholder="You" className={inputClass} /></Field>
        <div className="flex items-end pb-2"><Check name="storage" label="Needs storage" defaultChecked={lead?.storage} /></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From address" htmlFor="lf-from"><input id="lf-from" name="originAddress" defaultValue={lead?.originAddress ?? ''} className={inputClass} /></Field>
        <Field label="To address" htmlFor="lf-to"><input id="lf-to" name="destinationAddress" defaultValue={lead?.destinationAddress ?? ''} className={inputClass} /></Field>
        <Field label="Customer note" htmlFor="lf-cnote"><textarea id="lf-cnote" name="customerNote" rows={3} defaultValue={lead?.customerNote ?? ''} className={areaClass} /></Field>
        <Field label="Internal note" htmlFor="lf-inote"><textarea id="lf-inote" name="internalNote" rows={3} defaultValue={lead?.internalNote ?? ''} className={areaClass} /></Field>
      </div>
      <Disclosure summary="Tracking (UTM and click ids)">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {(
            [
              ['utmSource', 'UTM source'],
              ['utmMedium', 'UTM medium'],
              ['utmCampaign', 'UTM campaign'],
              ['gclid', 'GCLID'],
              ['fbclid', 'FBCLID'],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label} htmlFor={`lf-${key}`}>
              <input id={`lf-${key}`} name={key} defaultValue={lead?.[key] ?? ''} className={inputClass} />
            </Field>
          ))}
        </div>
      </Disclosure>
    </>
  );
}

export async function NewLeadPage({ ctx, basePath }: PortalPageProps) {
  return (
    <>
      <PageHeader title="Add lead" description={<Link href={`${basePath}/leads`} className="hover:underline">← All leads</Link>} />
      <Card>
        <ActionForm action={createLeadAction.bind(null, ctx.business.slug, ctx.environment)} submitLabel="Add lead">
          <LeadFields />
        </ActionForm>
      </Card>
    </>
  );
}

export async function LeadPage({ ctx, params, basePath }: PortalPageProps) {
  const { lead, job, notes, queue, source } = await leadPage(ctx, params.id);
  const slug = ctx.business.slug;
  const mode = ctx.environment;
  const canWrite = can(ctx, P.leadsWrite);
  const canConvert = canWrite && can(ctx, P.jobsWrite) && can(ctx, CORE.customersRead) && lead.status === 'new';
  const preview = canConvert ? await conversionPreview(ctx, lead.id) : null;
  const trucks = canConvert ? await listTrucks(ctx) : [];

  return (
    <>
      <PageHeader
        title={`${lead.leadNumber} · ${`${lead.firstName} ${lead.lastName}`.trim()}`}
        description={<Link href={`${basePath}/leads`} className="hover:underline">← All leads</Link>}
        actions={
          <>
            <LeadStatusBadge status={lead.status} />
            {lead.status === 'new' && lead.noContactStartedAt ? <Badge tone="amber">No contact: follow-up emails running</Badge> : null}
            {canWrite && lead.status === 'new' && lead.email && !lead.noContactStartedAt ? (
              <ConfirmButton
                action={noContactAction.bind(null, slug, mode, lead.id)}
                confirmTitle="Start the couldn't-reach emails?"
                confirmBody="Three emails: one now, one tomorrow and one in two days. They stop when the lead is converted or disqualified."
                confirmLabel="Start emails"
              >
                Couldn&apos;t reach
              </ConfirmButton>
            ) : null}
            {canWrite && lead.status === 'disqualified' ? <ConfirmButton action={reopenLeadAction.bind(null, slug, mode, lead.id)}>Reopen</ConfirmButton> : null}
            {job ? <Link className={buttonClass({ variant: 'secondary', size: 'sm' })} href={`${basePath}/jobs/${job.id}`}>Open job {job.jobNumber}</Link> : null}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Lead" flush>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 md:grid-cols-3">
              <Fact label="Email">{lead.email ?? '—'}</Fact>
              <Fact label="Phone">{formatPhone(lead.phone)}</Fact>
              <Fact label="Source">{lead.source}{lead.sourceDetail ? ` · ${lead.sourceDetail}` : ''}</Fact>
              <Fact label="Move date">{formatDay(lead.moveDate)}</Fact>
              <Fact label="Bedrooms">{lead.bedrooms ?? '—'}</Fact>
              <Fact label="Owner">{lead.ownerName ?? '—'}</Fact>
              <Fact label="From">{lead.originAddress ?? '—'}</Fact>
              <Fact label="To">{lead.destinationAddress ?? '—'}</Fact>
              <Fact label="Arrived">{formatDateTime(lead.createdAt)}</Fact>
              {lead.status === 'disqualified' ? <Fact label="Disqualified">{`${lead.disqualifiedReason} (${formatDate(lead.disqualifiedAt)})`}</Fact> : null}
              {lead.customerNote ? <Fact label="Customer note">{lead.customerNote}</Fact> : null}
              {lead.utmSource || lead.gclid || lead.fbclid ? (
                <Fact label="Tracking">{[lead.utmSource, lead.utmMedium, lead.utmCampaign, lead.gclid && `gclid ${lead.gclid}`, lead.fbclid && `fbclid ${lead.fbclid}`].filter(Boolean).join(' · ')}</Fact>
              ) : null}
            </dl>
            {canWrite && lead.status !== 'converted' ? (
              <Disclosure summary="Change details">
                <ActionForm action={updateLeadAction.bind(null, slug, mode, lead.id)} submitLabel="Save" resetOnSuccess={false}>
                  <LeadFields lead={lead} />
                </ActionForm>
              </Disclosure>
            ) : null}
          </Card>

          {preview ? (
            <Card title="Convert to a job" description="Creates the job and its quote. Booking stays a separate step.">
              {preview.match ? (
                <Note tone="green" title={`Uses the existing customer ${preview.match.firstName} ${preview.match.lastName}`}>
                  <p>Matched by {preview.match.email?.toLowerCase() === lead.email?.toLowerCase() ? 'email' : 'phone'}: {preview.match.email ?? preview.match.phone}.</p>
                </Note>
              ) : preview.duplicates.length ? (
                <Note title="Probable duplicate customer">
                  <p>
                    {preview.duplicates.length === 1 ? 'A customer' : `${preview.duplicates.length} customers`} named {lead.firstName} {lead.lastName} already
                    exist{preview.duplicates.length === 1 ? 's' : ''} with different contact details ({preview.duplicates.map((d) => d.email ?? (d.phone ? formatPhone(d.phone) : 'no contact')).join(', ')}).
                    Tick the box below only if this is a different person.
                  </p>
                </Note>
              ) : (
                <p className="mb-3 text-sm text-zinc-600">No customer has this email or phone yet: a new customer will be created.</p>
              )}
              <ActionForm action={convertLeadAction.bind(null, slug, mode, lead.id)} submitLabel="Convert to job" className="mt-3">
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="Service type" htmlFor="cv-service">
                    <Select id="cv-service" name="serviceType" defaultValue="local">
                      {SERVICE_TYPES.map((t) => <option key={t} value={t}>{SERVICE_TYPE_LABELS[t]}</option>)}
                    </Select>
                  </Field>
                  <Field label="Job type" htmlFor="cv-type" help="Must match the service type.">
                    <Select id="cv-type" name="jobType" defaultValue="Local Full Service Move">
                      {SERVICE_TYPES.map((t) => (
                        <optgroup key={t} label={SERVICE_TYPE_LABELS[t]}>
                          {JOB_TYPES[t].map((j) => <option key={j} value={j}>{j}</option>)}
                        </optgroup>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Movers" htmlFor="cv-crew"><input id="cv-crew" name="crewSize" type="number" min={1} max={20} defaultValue={2} className={inputClass} /></Field>
                  <Field label="Trucks" htmlFor="cv-trucks"><input id="cv-trucks" name="trucks" type="number" min={0} max={10} defaultValue={1} className={inputClass} /></Field>
                  <TruckPicker trucks={trucks} idPrefix="cv-truck" />
                </div>
                {preview.duplicates.length && !preview.match ? <Check name="confirmNewCustomer" label="This is a different person: create a new customer" /> : null}
              </ActionForm>
            </Card>
          ) : null}

          {canWrite && lead.status === 'new' ? (
            <Card title="Disqualify">
              <ActionForm action={disqualifyLeadAction.bind(null, slug, mode, lead.id)} submitLabel="Disqualify" submitVariant="danger">
                <Field label="Reason" htmlFor="dq-reason"><input id="dq-reason" name="reason" required className={inputClass} placeholder="e.g. Outside our area" /></Field>
              </ActionForm>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card title="Notes and calls">
            {canWrite ? (
              <ActionForm action={addLeadNoteAction.bind(null, slug, mode, lead.id)} submitLabel="Save" className="mb-4">
                <Field label="Kind" htmlFor="ln-kind">
                  <Select id="ln-kind" name="kind" defaultValue="call">
                    <option value="call">Call</option>
                    <option value="note">Note</option>
                  </Select>
                </Field>
                <Field label="Call outcome" htmlFor="ln-outcome">
                  <Select id="ln-outcome" name="callOutcome" defaultValue="spoke">
                    {Object.entries(CALL_OUTCOME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
                <Field label="Note" htmlFor="ln-body"><textarea id="ln-body" name="body" rows={2} className={areaClass} /></Field>
              </ActionForm>
            ) : null}
            {notes.length === 0 ? <p className="text-sm text-zinc-500">Nothing yet.</p> : (
              <ul className="space-y-2 text-sm">
                {notes.map((n) => (
                  <li key={n.id} className="border-b border-zinc-100 pb-2">
                    <span className="font-medium">{n.kind === 'call' ? CALL_OUTCOME_LABELS[n.callOutcome ?? 'spoke'] : 'Note'}</span>
                    {n.body ? ` — ${n.body}` : ''}
                    <span className="block text-xs text-zinc-500">{n.authorName} · {formatDateTime(n.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {queue.length ? (
            <Card title="Emails">
              <ul className="space-y-1 text-sm">
                {queue.map((q) => (
                  <li key={q.id}>{q.ruleName} · <span className="text-zinc-500">{q.status} {q.status === 'queued' ? formatDateTime(q.dueAt) : q.sentAt ? formatDateTime(q.sentAt) : q.cancelledReason ?? ''}</span></li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
        <div className="lg:col-span-3"><SourceRecords records={source} /></div>
      </div>
    </>
  );
}
