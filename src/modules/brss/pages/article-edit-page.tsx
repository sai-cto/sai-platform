/** Correcting an article's details from its order (size, kind, insurance). */
import Link from 'next/link';
import { NotFoundError } from '@/core/errors';
import type { PortalPageProps } from '@/core/modules/contract';
import { authorize } from '@/core/rbac/permissions';
import { Card, PageHeader } from '@/ui/layout';
import { updateArticleAction } from '../actions';
import { P } from '../permissions';
import { articleTypeChoices } from '../rules';
import { loadSettings } from '../settings';
import { getPriceList } from '../services/catalog';
import { getOrder } from '../services/orders';
import { IntakeForm } from './forms/intake-form';

export async function ArticleEditPage({ ctx, params, basePath }: PortalPageProps) {
  authorize(ctx, P.articlesWrite);
  const [{ order, articles }, settings, priceList] = await Promise.all([
    getOrder(ctx, params.id),
    loadSettings(ctx),
    getPriceList(ctx),
  ]);
  const row = articles?.find((a) => a.article.id === params.articleId);
  if (!row) throw new NotFoundError();
  const { article } = row;
  const back = `${basePath}/orders/${order.id}`;

  return (
    <>
      <PageHeader
        title={`Correct ${article.articleNumber}`}
        description={
          <Link href={back} className="hover:underline">
            ← Order {order.orderNumber}
          </Link>
        }
      />
      <Card description="Charges that are not paid yet are worked out again when you save. Paid charges are not changed.">
        <IntakeForm
          action={updateArticleAction.bind(null, ctx.business.slug, ctx.environment, order.id, article.id)}
          types={articleTypeChoices(order.services)}
          products={priceList.products
            .filter((p) => p.isActive && (p.kind === 'storage_item' || p.kind === 'flat_rate_box'))
            .map((p) => ({ id: p.id, name: p.name, kind: p.kind, role: p.role, unitPriceCents: p.unitPriceCents }))}
          toCornell={order.services.includes('ship_to_cornell')}
          divisor={settings.dimensionalDivisor}
          maxBillableLb={settings.maxBillableWeightLb}
          initial={{
            type: article.type,
            description: article.description ?? '',
            weightLb: article.weightLb,
            lengthIn: article.lengthIn,
            widthIn: article.widthIn,
            heightIn: article.heightIn,
            productId: article.productId ?? '',
            insuranceCents: article.additionalInsuranceCents,
            otherStoragePrice:
              article.otherStoragePriceCents === null
                ? ''
                : (article.otherStoragePriceCents / 100).toFixed(2),
            cornellShippingAccount: row.cornellShippingAccount,
            receivedFromZip: row.receivedFromZip ?? '',
          }}
          submitLabel="Save corrections"
        />
      </Card>
    </>
  );
}
