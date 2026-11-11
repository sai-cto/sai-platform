/**
 * One order: its customer and details, its articles with their status and location, its
 * charges and payments, and its appointments. Each part is a card in ./order/.
 */
import crypto from 'node:crypto';
import Link from 'next/link';
import type { PortalPageProps } from '@/core/modules/contract';
import { can } from '@/core/rbac/permissions';
import { ActionForm } from '@/ui/action-form';
import { ConfirmButton } from '@/ui/confirm-button';
import { formatDateTime } from '@/ui/format';
import { Card, PageHeader } from '@/ui/layout';
import { setOrderStatusAction, updateOrderAction } from '../actions';
import { CORE, P } from '../permissions';
import { canCancelOrder, earliestBookableDate, isOrderActive, localDate } from '../rules';
import { loadSettings } from '../settings';
import { listTrucks } from '../services/appointments';
import { earlierArticles } from '../services/articles';
import { getPlaces, getPriceList } from '../services/catalog';
import { pricingProblems } from '../services/charges';
import { getOrder } from '../services/orders';
import { AppointmentsCard } from './order/appointments-card';
import { ArticlesCard } from './order/articles-card';
import { ChargesCard } from './order/charges-card';
import { OrderFields } from './order-fields';
import { CAMPUS_LABELS, Fact, OrderStatusBadge, ServiceList, formatDay } from './parts';
import { Disclosure } from './disclosure';

export async function OrderPage({ ctx, params, basePath }: PortalPageProps) {
  const detail = await getOrder(ctx, params.id);
  const { order, customer } = detail;
  const slug = ctx.business.slug;
  const mode = ctx.environment;
  const canWrite = can(ctx, P.ordersWrite);
  const active = isOrderActive(order.status);
  const seesCatalog = can(ctx, P.catalogRead);

  const [settings, problems, priceList, places, trucks, earlier] = await Promise.all([
    loadSettings(ctx),
    pricingProblems(ctx, order.id),
    seesCatalog ? getPriceList(ctx) : null,
    seesCatalog ? getPlaces(ctx) : null,
    can(ctx, CORE.schedulingRead) ? listTrucks(ctx) : [],
    canWrite && active && can(ctx, P.articlesRead) ? earlierArticles(ctx, order.id) : [],
  ]);
  const today = localDate(new Date(), ctx.business.timeZone);
  const status = (next: string) => setOrderStatusAction.bind(null, slug, mode, order.id, next);

  return (
    <>
      <PageHeader
        title={`Order ${order.orderNumber}`}
        description={
          <Link href={basePath} className="hover:underline">
            ← All orders
          </Link>
        }
        actions={
          <>
            <OrderStatusBadge status={order.status} />
            {canWrite && order.status === 'open' ? (
              <ConfirmButton action={status('activated')}>Activate</ConfirmButton>
            ) : null}
            {canWrite && active ? (
              <ConfirmButton
                action={status('closed')}
                confirmTitle="Close this order?"
                confirmBody="Every article on the order will be marked Delivered. You can reopen the order afterwards, but the articles stay Delivered until someone changes them."
                confirmLabel="Close order"
              >
                Close
              </ConfirmButton>
            ) : null}
            {canWrite && canCancelOrder(order.status) ? (
              <ConfirmButton
                action={status('cancelled')}
                variant="danger"
                confirmTitle="Cancel this order?"
                confirmBody="Its appointments will be cancelled too. Nothing is refunded automatically: refund any payment below first if the customer is owed money."
                confirmLabel="Cancel order"
              >
                Cancel order
              </ConfirmButton>
            ) : null}
            {canWrite && !active ? (
              <ConfirmButton action={status('open')}>Reopen</ConfirmButton>
            ) : null}
          </>
        }
      />

      <div className="space-y-5">
        <Card title="Customer and details" flush>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 md:grid-cols-4">
            <Fact label="Customer">
              {customer ? (
                <>
                  {`${customer.firstName} ${customer.lastName}`.trim() || 'Unnamed customer'}
                  <span className="block text-xs break-all text-zinc-500">
                    {customer.email ?? 'No email'}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {customer.phone ?? 'No phone'}
                  </span>
                </>
              ) : (
                <span className="text-zinc-500">You do not have permission to see customers.</span>
              )}
            </Fact>
            <Fact label="Services">
              <ServiceList services={order.services} />
            </Fact>
            <Fact label="Campus category">
              {order.campusCategory
                ? CAMPUS_LABELS[order.campusCategory]
                : 'Set by the first appointment'}
            </Fact>
            <Fact label="NetID">{order.netId ?? '—'}</Fact>
            <Fact label="Placed">{formatDateTime(order.createdAt)}</Fact>
            <Fact label="Storage term">
              {order.storageTermMonths ? `${order.storageTermMonths} months` : '—'}
            </Fact>
            <Fact label="Storage started">
              {order.storageEffectiveDate
                ? formatDay(order.storageEffectiveDate)
                : order.services.includes('storage')
                  ? 'Starts with the first payment'
                  : '—'}
            </Fact>
            <Fact label="Storage ends">{formatDay(detail.storageExpires)}</Fact>
            {order.services.includes('ship_to_home') || order.shipToAddress1 ? (
              <Fact label="Ship to">
                {[
                  order.shipToName,
                  order.shipToAddress1,
                  order.shipToAddress2,
                  order.shipToCity,
                  order.shipToState,
                  order.shipToZip,
                ]
                  .filter(Boolean)
                  .join(', ') || '—'}
                <span className="block text-xs text-zinc-500">
                  {order.shipToZone === null
                    ? 'No shipping zone for this zip'
                    : `Shipping zone ${order.shipToZone}`}
                </span>
              </Fact>
            ) : null}
            {order.notes ? <Fact label="Notes">{order.notes}</Fact> : null}
          </dl>
          {canWrite && active ? (
            <Disclosure summary="Change details">
              <ActionForm
                action={updateOrderAction.bind(null, slug, mode, order.id)}
                submitLabel="Save details"
                resetOnSuccess={false}
              >
                <OrderFields order={order} />
              </ActionForm>
            </Disclosure>
          ) : null}
        </Card>

        <ArticlesCard
          ctx={ctx}
          basePath={basePath}
          detail={detail}
          settings={settings}
          products={priceList?.products ?? []}
          earlier={earlier}
        />
        <ChargesCard
          ctx={ctx}
          detail={detail}
          settings={settings}
          problems={problems}
          products={priceList?.products ?? []}
          idempotencyKey={crypto.randomUUID()}
        />
        <AppointmentsCard
          ctx={ctx}
          detail={detail}
          places={places}
          trucks={trucks}
          earliest={earliestBookableDate(today, settings.appointmentLeadDays)}
        />
      </div>
    </>
  );
}
