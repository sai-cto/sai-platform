/**
 * Estimates: every sent estimate version, with who made it (managers: "you can always tell who
 * made which estimate"). Estimates are made on a work request (the Job page); this is the list.
 */
import Link from 'next/link';
import type { PortalPageProps } from '@/core/modules/contract';
import { customerName } from '@/core/records/core-entities';
import { buttonClass } from '@/ui/button';
import { formatDateTime, formatMoney } from '@/ui/format';
import { Card, EmptyState, Field, PageHeader, Table, Td, Th, inputClass } from '@/ui/layout';
import { Pagination } from '@/ui/pagination';
import { ESTIMATES_PAGE_SIZE, listEstimates, type EstimateFilter } from '../services/directory';
import { baseTotalCents } from '../services/pricing';
import { EstimateStatusBadge, Select, formatDay, hrefWith } from './parts';

const FILTERS: { value: EstimateFilter; label: string }[] = [
  { value: 'open', label: 'In force (sent, viewed, signed)' },
  { value: 'sent', label: 'Sent' },
  { value: 'viewed', label: 'Viewed' },
  { value: 'signed', label: 'Signed' },
  { value: 'void', label: 'Void' },
  { value: 'all', label: 'All' },
];

export async function EstimatesPage({ ctx, searchParams, basePath }: PortalPageProps) {
  const status = FILTERS.find((f) => f.value === searchParams.status)?.value ?? 'open';
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1);
  const { rows, total } = await listEstimates(ctx, { status, q: searchParams.q, page });
  const base = `${basePath}/estimates`;
  return (
    <>
      <PageHeader
        title="Estimates"
        description="Every estimate sent, newest first. To make one, open a work request (or start one from a contact) and use “Build the estimate”."
        actions={<Link href={`${basePath}/jobs`} className={buttonClass({ variant: 'secondary' })}>Work requests</Link>}
      />
      <Card flush>
        <form className="flex flex-wrap items-end gap-3 border-b border-zinc-200 p-3" action={base}>
          <Field label="Status" htmlFor="e-status">
            <Select id="e-status" name="status" defaultValue={status}>
              {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </Select>
          </Field>
          <Field label="Search" htmlFor="e-q">
            <input id="e-q" name="q" defaultValue={searchParams.q ?? ''} placeholder="Customer, E- or J-number, made by" className={inputClass} />
          </Field>
          <button type="submit" className={buttonClass({ variant: 'secondary' })}>Show</button>
        </form>
        {rows.length === 0 ? (
          <EmptyState title="No estimates match." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Estimate</Th>
                <Th>Customer</Th>
                <Th>Move date</Th>
                <Th>Total</Th>
                <Th>Deposit</Th>
                <Th>Status</Th>
                <Th>Made by</Th>
                <Th>Sent</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ estimate: e, job, customer }) => (
                <tr key={e.id} className="hover:bg-zinc-50">
                  <Td className="whitespace-nowrap"><Link className="font-medium hover:underline" href={`${basePath}/jobs/${job.id}`}>{`${e.estimateNumber} v${e.version}`}</Link><span className="block text-xs text-zinc-500">{job.jobNumber}</span></Td>
                  <Td>{customerName(customer)}</Td>
                  <Td className="whitespace-nowrap">{formatDay(job.moveDate)}</Td>
                  <Td className="tabular-nums">{formatMoney(baseTotalCents(e))}</Td>
                  <Td className="tabular-nums">{e.depositPaidCents > 0 ? formatMoney(e.depositPaidCents) : <span className="text-zinc-500">{e.status === 'signed' ? 'Not paid' : '—'}</span>}</Td>
                  <Td><EstimateStatusBadge status={e.status} /></Td>
                  <Td>{e.createdByName ?? '—'}</Td>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(e.sentAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={ESTIMATES_PAGE_SIZE} total={total} hrefFor={(p) => hrefWith(base, searchParams, { page: p > 1 ? String(p) : undefined })} />
      </Card>
    </>
  );
}
