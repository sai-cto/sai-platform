/** One article: where it is, what state it is in, and the orders it has been on. */
import Link from 'next/link';
import type { PortalPageProps } from '@/core/modules/contract';
import { can } from '@/core/rbac/permissions';
import { ActionForm } from '@/ui/action-form';
import { formatDate, formatMoney } from '@/ui/format';
import { Card, Field, PageHeader, inputClass } from '@/ui/layout';
import { setArticleLocationAction, setArticleStatusAction } from '../actions';
import { P } from '../permissions';
import { ARTICLE_STATUSES, ARTICLE_TYPES, ROWS, SECTIONS, labelOf } from '../rules';
import { getArticle } from '../services/articles';
import { getPlaces } from '../services/catalog';
import { ArticleStatusBadge, Fact, OrderStatusBadge, Select, ServiceList } from './parts';

export async function ArticlePage({ ctx, params, basePath }: PortalPageProps) {
  const [{ article, customerName, productName, orders }, places] = await Promise.all([
    getArticle(ctx, params.id),
    can(ctx, P.catalogRead) ? getPlaces(ctx) : null,
  ]);
  const slug = ctx.business.slug;
  const mode = ctx.environment;
  const canWrite = can(ctx, P.articlesWrite);
  // The status the screen suggests next: the one after the current one in the usual order.
  const currentIndex = ARTICLE_STATUSES.findIndex((s) => s.key === article.status);
  const suggested = ARTICLE_STATUSES[Math.min(currentIndex + 1, ARTICLE_STATUSES.length - 1)].key;
  const warehouses =
    places?.warehouses.filter((w) => w.isActive || w.id === article.warehouseId) ?? [];

  return (
    <>
      <PageHeader
        title={`Article ${article.articleNumber}`}
        description={
          <Link href={`${basePath}/articles`} className="hover:underline">
            ← All articles
          </Link>
        }
        actions={<ArticleStatusBadge status={article.status} />}
      />
      <div className="space-y-5">
        <Card title="Details">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
            <Fact label="Customer">{customerName ?? '—'}</Fact>
            <Fact label="Kind">{productName ?? labelOf(ARTICLE_TYPES, article.type)}</Fact>
            <Fact label="Description">{article.description ?? '—'}</Fact>
            <Fact label="Added">{formatDate(article.createdAt)}</Fact>
            <Fact label="Size">
              {article.lengthIn > 0
                ? `${article.lengthIn} × ${article.widthIn} × ${article.heightIn} in, ${article.weightLb} lb`
                : '—'}
            </Fact>
            <Fact label="Billable weight">
              {article.billableWeightLb > 0 ? `${article.billableWeightLb} lb` : '—'}
            </Fact>
            <Fact label="Extra insurance">
              {article.additionalInsuranceCents > 0
                ? formatMoney(article.additionalInsuranceCents)
                : 'None'}
            </Fact>
            {article.otherStoragePriceCents !== null ? (
              <Fact label="Storage price a month">
                {formatMoney(article.otherStoragePriceCents)}
              </Fact>
            ) : null}
          </dl>
        </Card>

        {canWrite ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card
              title="Status"
              description="Any status can be set. Every change is kept in the activity log."
            >
              <ActionForm
                action={setArticleStatusAction.bind(null, slug, mode, article.id)}
                submitLabel="Save status"
                submitVariant="secondary"
                resetOnSuccess={false}
              >
                <Field label="Status" htmlFor="article-status">
                  <Select
                    id="article-status"
                    name="status"
                    defaultValue={suggested}
                    key={article.status ?? 'none'}
                  >
                    {ARTICLE_STATUSES.map((status) => (
                      <option key={status.key} value={status.key}>
                        {status.label}
                        {status.key === article.status ? ' (now)' : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              </ActionForm>
            </Card>
            <Card
              title="Warehouse location"
              description="Giving a location to an article that has none marks it Stored."
            >
              {places ? (
                <ActionForm
                  action={setArticleLocationAction.bind(null, slug, mode, article.id)}
                  submitLabel="Save location"
                  resetOnSuccess={false}
                >
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Warehouse" htmlFor="loc-warehouse">
                      <Select
                        id="loc-warehouse"
                        name="warehouseId"
                        defaultValue={article.warehouseId ?? ''}
                      >
                        <option value="">None</option>
                        {warehouses.map((warehouse) => (
                          <option key={warehouse.id} value={warehouse.id}>
                            {warehouse.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Section" htmlFor="loc-section">
                      <Select id="loc-section" name="section" defaultValue={article.section ?? ''}>
                        <option value="">None</option>
                        {SECTIONS.map((section) => (
                          <option key={section} value={section}>
                            {section}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Row" htmlFor="loc-row">
                      <Select id="loc-row" name="row" defaultValue={article.row ?? ''}>
                        <option value="">None</option>
                        {ROWS.map((row) => (
                          <option key={row} value={row}>
                            {row}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Pallet number" htmlFor="loc-pallet">
                      <input
                        id="loc-pallet"
                        name="pallet"
                        type="number"
                        min="0"
                        max="99"
                        defaultValue={article.pallet ?? ''}
                        className={inputClass}
                      />
                    </Field>
                  </div>
                </ActionForm>
              ) : (
                <p className="text-sm text-zinc-500">
                  Setting a location needs permission to see warehouses.
                </p>
              )}
            </Card>
          </div>
        ) : null}

        <Card title="Orders this article has been on" flush>
          {orders.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">None that you can see.</p>
          ) : (
            <ul className="divide-y divide-zinc-200">
              {orders.map((order) => (
                <li
                  key={order.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"
                >
                  <Link
                    href={`${basePath}/orders/${order.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {order.orderNumber}
                  </Link>
                  <OrderStatusBadge status={order.status} />
                  <span className="text-zinc-600">
                    <ServiceList services={order.services} /> · placed {formatDate(order.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
