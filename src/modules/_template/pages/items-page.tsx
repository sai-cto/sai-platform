/**
 * TEMPLATE — a staff-portal page. A server component that receives the context, the route
 * parameters and `basePath` (the prefix for links inside this portal). It calls the
 * module's services and renders with the shared components in @/ui.
 */
import { loadModuleSettings } from '@/core/modules/config';
import type { PortalPageProps } from '@/core/modules/contract';
import { ActionForm } from '@/ui/action-form';
import { formatMoney } from '@/ui/format';
import { Card, EmptyState, Field, PageHeader, Table, Td, Th, inputClass } from '@/ui/layout';
import { createItemAction } from '../actions';
import { P } from '../permissions';
import { listItems } from '../services/items';

export async function ItemsPage({ ctx }: PortalPageProps) {
  const { rows } = await listItems(ctx);
  // Settings are defined in the manifest and changed by the tech team in the Settings tab.
  const settings = await loadModuleSettings<{ taxPercent: number }>(ctx);
  const canWrite = ctx.permissions.has(P.itemsWrite);
  return (
    <>
      <PageHeader
        title="Items"
        description={`Everything this business sells. Prices are before ${settings.taxPercent}% tax.`}
      />
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
      {canWrite ? (
        <Card title="Add an item" className="mt-5">
          <ActionForm
            action={createItemAction.bind(null, ctx.business.slug, ctx.environment)}
            submitLabel="Add item"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" htmlFor="name">
                <input id="name" name="name" required className={inputClass} />
              </Field>
              <Field label="Price (dollars)" htmlFor="price">
                <input
                  id="price"
                  name="price"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  className={inputClass}
                />
              </Field>
            </div>
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}
