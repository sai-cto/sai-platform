/**
 * Contacts (managers' word for customers) and one contact's history. "Repeat customers: I want a
 * 'New estimate / work request' button on the customer's record that keeps their contact info
 * and lets me enter just the new addresses and dates." (Hired Hands Software Input, Nov 2026)
 */
import Link from 'next/link';
import type { PortalPageProps } from '@/core/modules/contract';
import { can } from '@/core/rbac/permissions';
import { customerName } from '@/core/records/core-entities';
import { buttonClass } from '@/ui/button';
import { formatDateTime, formatMoney } from '@/ui/format';
import { Card, EmptyState, Field, PageHeader, Table, Td, Th, inputClass } from '@/ui/layout';
import { Pagination } from '@/ui/pagination';
import { P } from '../permissions';
import { CONTACTS_PAGE_SIZE, contactPage, listContacts } from '../services/directory';
import { baseTotalCents } from '../services/pricing';
import { EstimateStatusBadge, Fact, InvoiceStatusBadge, LeadStatusBadge, StageBadge, formatDay, hrefWith } from './parts';

export async function ContactsPage({ ctx, searchParams, basePath }: PortalPageProps) {
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1);
  const { rows, total } = await listContacts(ctx, { q: searchParams.q, page });
  const base = `${basePath}/contacts`;
  const canNew = can(ctx, P.jobsWrite);
  return (
    <>
      <PageHeader title="Contacts" description="Everyone who has asked for or booked a move. Open one to see their history or start a new estimate for them." />
      <Card flush>
        <form className="flex flex-wrap items-end gap-3 border-b border-zinc-200 p-3" action={base}>
          <Field label="Search" htmlFor="c-q">
            <input id="c-q" name="q" defaultValue={searchParams.q ?? ''} placeholder="Name, email or phone" className={inputClass} />
          </Field>
          <button type="submit" className={buttonClass({ variant: 'secondary' })}>Show</button>
        </form>
        {rows.length === 0 ? (
          <EmptyState title="No contacts match." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email / phone</Th>
                <Th>Work requests</Th>
                <Th>Last move</Th>
                <Th className="relative"><span className="sr-only">Actions</span></Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ customer, jobs, lastMove }) => (
                <tr key={customer.id} className="hover:bg-zinc-50">
                  <Td><Link className="font-medium hover:underline" href={`${base}/${customer.id}`}>{customerName(customer)}</Link></Td>
                  <Td><span className="block break-all">{customer.email ?? '—'}</span><span className="block text-xs text-zinc-500">{customer.phone ?? ''}</span></Td>
                  <Td className="tabular-nums">{jobs}</Td>
                  <Td className="whitespace-nowrap">{lastMove ? formatDay(lastMove) : '—'}</Td>
                  <Td className="text-right">
                    {canNew ? <Link className="text-xs whitespace-nowrap underline" href={`${basePath}/jobs/new?customer=${customer.id}`}>New estimate / work request</Link> : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={CONTACTS_PAGE_SIZE} total={total} hrefFor={(p) => hrefWith(base, searchParams, { page: p > 1 ? String(p) : undefined })} />
      </Card>
    </>
  );
}

export async function ContactPage({ ctx, params, basePath }: PortalPageProps) {
  const { customer, leads, jobs, estimates, invoices } = await contactPage(ctx, params.id);
  const open = (invoices ?? []).reduce((sum, i) => sum + i.balanceCents, 0);
  return (
    <>
      <PageHeader
        title={customerName(customer)}
        description={<Link href={`${basePath}/contacts`} className="hover:underline">← All contacts</Link>}
        actions={can(ctx, P.jobsWrite) ? <Link href={`${basePath}/jobs/new?customer=${customer.id}`} className={buttonClass({ variant: 'primary' })}>New estimate / work request</Link> : null}
      />
      <div className="space-y-5">
        <Card title="Contact" flush>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 md:grid-cols-4">
            <Fact label="Email">{customer.email ?? '—'}</Fact>
            <Fact label="Phone">{customer.phone ?? '—'}</Fact>
            <Fact label="Work requests">{String(jobs?.length ?? 0)}</Fact>
            {invoices ? <Fact label="Still to pay">{formatMoney(open)}</Fact> : null}
            {customer.notes ? <Fact label="Notes">{customer.notes}</Fact> : null}
            <Fact label="Contact since">{formatDateTime(customer.createdAt)}</Fact>
          </dl>
        </Card>

        {jobs ? (
          <Card title="Work requests" flush>
            {jobs.length === 0 ? (
              <EmptyState title="No work requests yet." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Work request</Th>
                    <Th>Move date</Th>
                    <Th>From → to</Th>
                    <Th>Estimate</Th>
                    <Th>Stage</Th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => {
                    const est = estimates.find((e) => e.jobId === job.id && e.status !== 'void') ?? estimates.find((e) => e.jobId === job.id);
                    return (
                      <tr key={job.id} className="hover:bg-zinc-50">
                        <Td><Link className="font-medium hover:underline" href={`${basePath}/jobs/${job.id}`}>{job.jobNumber}</Link></Td>
                        <Td className="whitespace-nowrap">{formatDay(job.moveDate)}</Td>
                        <Td><span className="block max-w-[22rem] truncate">{[job.originAddress, job.destinationAddress].filter(Boolean).join(' → ') || '—'}</span></Td>
                        <Td>{est ? <span className="flex items-center gap-2"><span className="tabular-nums">{formatMoney(baseTotalCents(est))}</span><EstimateStatusBadge status={est.status} /></span> : '—'}</Td>
                        <Td><StageBadge stage={job.stage} /></Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        ) : null}

        {invoices ? (
          <Card title="Invoices" flush>
            {invoices.length === 0 ? (
              <EmptyState title="No invoices yet." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Invoice</Th>
                    <Th>Date</Th>
                    <Th>Total</Th>
                    <Th>Balance</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id} className="hover:bg-zinc-50">
                      <Td><Link className="font-medium hover:underline" href={`${basePath}/invoices/${i.id}`}>{i.invoiceNumber}</Link></Td>
                      <Td className="whitespace-nowrap">{formatDay(i.invoiceDate)}</Td>
                      <Td className="tabular-nums">{formatMoney(baseTotalCents(i))}</Td>
                      <Td className="tabular-nums">{formatMoney(i.balanceCents)}</Td>
                      <Td><InvoiceStatusBadge status={i.status} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        ) : null}

        {leads && leads.length ? (
          <Card title="Leads" flush>
            <ul className="divide-y divide-zinc-100">
              {leads.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                  <Link className="font-medium hover:underline" href={`${basePath}/leads/${l.id}`}>{l.leadNumber}</Link>
                  <LeadStatusBadge status={l.status} />
                  <span className="text-xs text-zinc-500">{`${l.source} · ${formatDateTime(l.createdAt)}`}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
