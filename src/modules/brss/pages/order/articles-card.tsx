/** The order page's "Articles" card: what is on the order, intake, and status for all at once. */
import Link from 'next/link';
import { can } from '@/core/rbac/permissions';
import type { BusinessContext } from '@/core/tenancy/context';
import { ActionForm } from '@/ui/action-form';
import { buttonClass } from '@/ui/button';
import { ConfirmButton } from '@/ui/confirm-button';
import { formatMoney } from '@/ui/format';
import { Card, EmptyState, Field, Table, Td, Th } from '@/ui/layout';
import {
  attachArticleAction,
  detachArticleAction,
  intakeArticleAction,
  setOrderArticlesStatusAction,
} from '../../actions';
import { P } from '../../permissions';
import {
  ARTICLE_STATUSES,
  ARTICLE_TYPES,
  articleTypeChoices,
  isOrderActive,
  labelOf,
} from '../../rules';
import type { brssArticles, brssProducts } from '../../schema';
import type { BrssSettings } from '../../settings';
import type { OrderDetail } from '../../services/orders';
import { IntakeForm } from '../forms/intake-form';
import { ArticleStatusBadge, Disclosure, Select } from '../parts';

export function locationText(
  article: Pick<typeof brssArticles.$inferSelect, 'section' | 'row' | 'pallet'>,
  warehouseName: string | null,
): string {
  const parts = [
    warehouseName,
    article.section,
    article.row ? `Row ${article.row}` : null,
    article.pallet !== null ? `Pallet ${article.pallet}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export function ArticlesCard({
  ctx,
  basePath,
  detail,
  settings,
  products,
  earlier,
}: {
  ctx: BusinessContext;
  basePath: string;
  detail: OrderDetail;
  settings: BrssSettings;
  products: (typeof brssProducts.$inferSelect)[];
  earlier: (typeof brssArticles.$inferSelect)[];
}) {
  const { order, articles } = detail;
  const slug = ctx.business.slug;
  const mode = ctx.environment;
  const active = isOrderActive(order.status);
  // Intake creates an article AND puts it on the order, so it needs both permissions.
  const canIntake = active && can(ctx, P.ordersWrite) && can(ctx, P.articlesWrite);
  const canMove = can(ctx, P.articlesWrite);

  if (articles === null) {
    return (
      <Card title="Articles">
        <p className="text-sm text-zinc-500">You do not have permission to see articles.</p>
      </Card>
    );
  }

  return (
    <Card title="Articles" description="The boxes and items on this order." flush>
      {articles.length === 0 ? (
        <EmptyState title="No articles yet">
          Articles are added when the crew picks up or receives the customer&apos;s things.
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Article</Th>
              <Th>Kind</Th>
              <Th className="w-full">Description</Th>
              <Th className="text-right">Billable</Th>
              <Th className="text-right">Insured for</Th>
              <Th>Status</Th>
              <Th>Location</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {articles.map(({ article, productName, warehouseName }) => (
              <tr key={article.id}>
                <Td className="font-medium whitespace-nowrap">
                  <Link
                    href={`${basePath}/articles/${article.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {article.articleNumber}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap">
                  {productName ?? labelOf(ARTICLE_TYPES, article.type)}
                </Td>
                <Td className="min-w-40">{article.description ?? '—'}</Td>
                <Td className="text-right whitespace-nowrap tabular-nums">
                  {article.billableWeightLb > 0 ? `${article.billableWeightLb} lb` : '—'}
                </Td>
                <Td className="text-right tabular-nums">
                  {article.additionalInsuranceCents > 0
                    ? formatMoney(article.additionalInsuranceCents)
                    : '—'}
                </Td>
                <Td>
                  <ArticleStatusBadge status={article.status} />
                </Td>
                <Td className="whitespace-nowrap">{locationText(article, warehouseName)}</Td>
                <Td>
                  {canIntake ? (
                    <span className="flex justify-end gap-2">
                      <Link
                        href={`${basePath}/orders/${order.id}/articles/${article.id}`}
                        className={buttonClass({ size: 'sm' })}
                      >
                        Correct
                      </Link>
                      <ConfirmButton
                        action={detachArticleAction.bind(null, slug, mode, order.id, article.id)}
                        confirmTitle={`Take ${article.articleNumber} off this order?`}
                        confirmBody="Its unpaid charges are removed. The article itself is kept and can be added to an order again."
                        confirmLabel="Take off"
                      >
                        Take off
                      </ConfirmButton>
                    </span>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {canMove && articles.length > 0 ? (
        <div className="border-t border-zinc-200 p-4">
          <ActionForm
            action={setOrderArticlesStatusAction.bind(null, slug, mode, order.id)}
            submitLabel="Set on every article"
            submitVariant="secondary"
            className="flex flex-wrap items-end gap-3 space-y-0"
            resetOnSuccess={false}
          >
            <Field label="Status for all articles on this order" htmlFor="all-status">
              <Select id="all-status" name="status" className="sm:w-64">
                {ARTICLE_STATUSES.map((status) => (
                  <option key={status.key} value={status.key}>
                    {status.label}
                  </option>
                ))}
              </Select>
            </Field>
          </ActionForm>
        </div>
      ) : null}

      {canIntake ? (
        <Disclosure summary="Take in an article" open={articles.length === 0}>
          <IntakeForm
            action={intakeArticleAction.bind(null, slug, mode, order.id)}
            types={articleTypeChoices(order.services)}
            products={products
              .filter(
                (p) => p.isActive && (p.kind === 'storage_item' || p.kind === 'flat_rate_box'),
              )
              .map((p) => ({
                id: p.id,
                name: p.name,
                kind: p.kind,
                role: p.role,
                unitPriceCents: p.unitPriceCents,
              }))}
            toCornell={order.services.includes('ship_to_cornell')}
            divisor={settings.dimensionalDivisor}
            maxBillableLb={settings.maxBillableWeightLb}
            submitLabel="Add article"
          />
        </Disclosure>
      ) : null}

      {canIntake && earlier.length > 0 ? (
        <Disclosure summary={`Add one of this customer's earlier articles (${earlier.length})`}>
          <ActionForm
            action={attachArticleAction.bind(null, slug, mode, order.id)}
            submitLabel="Add to this order"
            submitVariant="secondary"
            className="flex flex-wrap items-end gap-3 space-y-0"
          >
            <Field label="Earlier article" htmlFor="earlier-article">
              <Select id="earlier-article" name="articleId" className="sm:w-96">
                {earlier.map((article) => (
                  <option key={article.id} value={article.id}>
                    {article.articleNumber} · {labelOf(ARTICLE_TYPES, article.type)}
                    {article.description ? ` · ${article.description}` : ''}
                    {article.status ? ` · ${labelOf(ARTICLE_STATUSES, article.status)}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </ActionForm>
        </Disclosure>
      ) : null}
    </Card>
  );
}
