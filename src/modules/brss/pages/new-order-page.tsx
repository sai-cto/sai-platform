/** The form for a new order. */
import Link from 'next/link';
import type { PortalPageProps } from '@/core/modules/contract';
import { can } from '@/core/rbac/permissions';
import { ActionForm } from '@/ui/action-form';
import { Card, PageHeader } from '@/ui/layout';
import { createOrderAction } from '../actions';
import { CORE } from '../permissions';
import { findCustomers } from '../services/orders';
import { CustomerFields, OrderFields } from './order-fields';

export async function NewOrderPage({ ctx, basePath }: PortalPageProps) {
  const customers = can(ctx, CORE.customersRead) ? await findCustomers(ctx) : [];
  return (
    <>
      <PageHeader
        title="New order"
        description={
          <Link href={basePath} className="hover:underline">
            ← All orders
          </Link>
        }
      />
      <Card>
        <ActionForm
          action={createOrderAction.bind(null, ctx.business.slug, ctx.environment)}
          submitLabel="Create order"
          resetOnSuccess={false}
        >
          <CustomerFields customers={customers} canCreate={can(ctx, CORE.customersWrite)} />
          <OrderFields />
        </ActionForm>
      </Card>
    </>
  );
}
