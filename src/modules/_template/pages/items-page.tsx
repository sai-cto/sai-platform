/**
 * TEMPLATE — a staff-portal page. A server component that receives the context, the route
 * parameters and `basePath` (the prefix for links inside this portal). It calls the
 * module's services and renders with the shared components in @/ui.
 */
import type { PortalPageProps } from '@/core/modules/contract';
import { formatMoney } from '@/ui/format';
import { Card, EmptyState, PageHeader, Table, Td, Th } from '@/ui/layout';
import { listItems } from '../services/items';

export async function ItemsPage({ ctx, searchParams }: PortalPageProps) {
  const { rows } = await listItems(ctx, { search: searchParams.q });
  return (
    <>
      <PageHeader title="Items" description="Everything this business sells." />
      <Card flush>
        {rows.length === 0 ? (
          <EmptyState title="No items yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-full">Name</Th>
                <Th className="text-right">Price</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id}>
                  <Td>{item.name}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(item.priceCents)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
