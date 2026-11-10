/** The orders dashboard: every order, filtered by status, service, campus, region and date. */
import Link from 'next/link';
import { can } from '@/core/rbac/permissions';
import type { PortalPageProps } from '@/core/modules/contract';
import { buttonClass } from '@/ui/button';
import { formatDate, formatMoney, formatNumber } from '@/ui/format';
import { Card, EmptyState, Field, PageHeader, Stat, Table, Td, Th, inputClass } from '@/ui/layout';
import { Pagination } from '@/ui/pagination';
import { P } from '../permissions';
import {
  APPOINTMENT_TYPES,
  ORDER_SERVICES,
  ORDER_STATUSES,
  labelOf,
  localDate,
  slotOf,
  TIME_SLOTS,
} from '../rules';
import type { AppointmentType, OrderService, OrderStatus } from '../schema';
import { getPlaces } from '../services/catalog';
import { ORDERS_PAGE_SIZE, listOrders, orderCounts, type OrderFilters } from '../services/orders';
import { CAMPUS_LABELS, OrderStatusBadge, Select, ServiceList, formatDay } from './parts';

const STATUS_CHOICES = ['active', 'all', ...ORDER_STATUSES.map((s) => s.key)] as const;

function readFilters(searchParams: PortalPageProps['searchParams']): OrderFilters {
  const status = STATUS_CHOICES.find((s) => s === searchParams.status);
  const service = ORDER_SERVICES.find((s) => s.key === searchParams.service)?.key;
  const campus = ['on_campus', 'off_campus', 'counter'].find((c) => c === searchParams.campus);
  const page = Number.parseInt(searchParams.page ?? '1', 10);
  return {
    status: status as OrderStatus | 'active' | 'all' | undefined,
    service: service as OrderService | undefined,
    campus: campus as OrderFilters['campus'],
    regionId: searchParams.region || undefined,
    from: searchParams.from || undefined,
    to: searchParams.to || undefined,
    q: searchParams.q || undefined,
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}

export async function OrdersPage({ ctx, searchParams, basePath }: PortalPageProps) {
  const filters = readFilters(searchParams);
  const [{ rows, total, page }, counts, places] = await Promise.all([
    listOrders(ctx, filters),
    orderCounts(ctx),
    can(ctx, P.catalogRead) ? getPlaces(ctx) : null,
  ]);
  const timeZone = ctx.business.timeZone;
  const hrefFor = (target: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams))
      if (value && key !== 'page') query.set(key, value);
    if (target > 1) query.set('page', String(target));
    const text = query.toString();
    return text ? `${basePath}?${text}` : basePath;
  };

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every storage, shipping, packing and supplies order."
        actions={
          can(ctx, P.ordersWrite) ? (
            <Link href={`${basePath}/orders/new`} className={buttonClass({ variant: 'primary' })}>
              New order
            </Link>
          ) : null
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open" value={formatNumber(counts.open)} />
        <Stat label="Activated" value={formatNumber(counts.activated)} />
        <Stat label="Closed" value={formatNumber(counts.closed)} />
        <Stat
          label="Waiting to be paid"
          value={formatMoney(counts.unpaidCents)}
          hint="Before tax, on open and activated orders"
        />
      </div>

      <Card flush>
        <form
          method="get"
          action={basePath}
          className="grid grid-cols-2 items-end gap-3 border-b border-zinc-200 p-3 md:grid-cols-4 xl:grid-cols-8"
        >
          <Field label="Search" htmlFor="f-q" className="col-span-2">
            <input
              id="f-q"
              name="q"
              type="search"
              defaultValue={filters.q}
              placeholder="Order number, customer, NetID"
              className={inputClass}
            />
          </Field>
          <Field label="Status" htmlFor="f-status">
            <Select id="f-status" name="status" defaultValue={filters.status ?? 'active'}>
              <option value="active">Open and activated</option>
              <option value="all">All</option>
              {ORDER_STATUSES.map((status) => (
                <option key={status.key} value={status.key}>
                  {status.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Service" htmlFor="f-service">
            <Select id="f-service" name="service" defaultValue={filters.service ?? ''}>
              <option value="">Any</option>
              {ORDER_SERVICES.map((service) => (
                <option key={service.key} value={service.key}>
                  {service.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Campus" htmlFor="f-campus">
            <Select id="f-campus" name="campus" defaultValue={filters.campus ?? ''}>
              <option value="">Any</option>
              {Object.entries(CAMPUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          {places ? (
            <Field label="Region" htmlFor="f-region">
              <Select id="f-region" name="region" defaultValue={filters.regionId ?? ''}>
                <option value="">Any</option>
                {places.regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Placed from" htmlFor="f-from">
            <input
              id="f-from"
              name="from"
              type="date"
              defaultValue={filters.from}
              className={inputClass}
            />
          </Field>
          <Field label="Placed to" htmlFor="f-to">
            <input
              id="f-to"
              name="to"
              type="date"
              defaultValue={filters.to}
              className={inputClass}
            />
          </Field>
          <div className="col-span-2 flex gap-2 md:col-span-4 xl:col-span-8">
            <button type="submit" className={buttonClass({ variant: 'primary' })}>
              Show
            </button>
            <Link href={basePath} className={buttonClass()}>
              Clear
            </Link>
          </div>
        </form>

        {rows.length === 0 ? (
          <EmptyState title="No orders match">Change the filters above, or clear them.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th>Services</Th>
                <Th>Campus</Th>
                <Th className="text-right">Articles</Th>
                <Th className="text-right">Charges</Th>
                <Th>Placed</Th>
                <Th>Storage ends</Th>
                <Th>Next appointment</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => {
                const next = order.nextAppointment;
                const slot = next ? slotOf(next.startsAt, timeZone) : null;
                return (
                  <tr key={order.id} className={order.status === 'closed' ? 'text-zinc-500' : ''}>
                    <Td className="font-medium whitespace-nowrap">
                      <Link
                        href={`${basePath}/orders/${order.id}`}
                        className="text-zinc-900 underline-offset-2 hover:underline"
                      >
                        {order.orderNumber}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap">{order.customerName}</Td>
                    <Td>
                      <OrderStatusBadge status={order.status} />
                    </Td>
                    <Td className="whitespace-nowrap">
                      <ServiceList services={order.services} />
                    </Td>
                    <Td className="whitespace-nowrap">
                      {order.campusCategory ? CAMPUS_LABELS[order.campusCategory] : '—'}
                    </Td>
                    <Td className="text-right tabular-nums">{order.articleCount}</Td>
                    <Td className="text-right whitespace-nowrap tabular-nums">
                      {formatMoney(order.totalCents)}
                      {order.unpaidCents > 0 ? (
                        <span className="block text-xs text-amber-800">
                          {formatMoney(order.unpaidCents)} to pay
                        </span>
                      ) : null}
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(order.createdAt)}</Td>
                    <Td className="whitespace-nowrap">
                      {formatDay(order.storageExpires)}
                      {order.deliveryScheduled ? (
                        <span className="block text-xs text-zinc-500">Delivery booked</span>
                      ) : null}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {next
                        ? `${labelOf(APPOINTMENT_TYPES, next.type as AppointmentType)} · ${formatDay(localDate(next.startsAt, timeZone))}${slot ? `, ${labelOf(TIME_SLOTS, slot)}` : ''}`
                        : '—'}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={ORDERS_PAGE_SIZE} total={total} hrefFor={hrefFor} />
      </Card>
    </>
  );
}
