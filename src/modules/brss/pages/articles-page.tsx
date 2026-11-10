/** Every article, to find a box by number, customer, status or warehouse. */
import Link from 'next/link';
import type { PortalPageProps } from '@/core/modules/contract';
import { can } from '@/core/rbac/permissions';
import { buttonClass } from '@/ui/button';
import { Card, EmptyState, Field, PageHeader, Table, Td, Th, inputClass } from '@/ui/layout';
import { Pagination } from '@/ui/pagination';
import { P } from '../permissions';
import { ARTICLE_STATUSES, ARTICLE_TYPES, labelOf } from '../rules';
import type { ArticleStatus } from '../schema';
import { ARTICLES_PAGE_SIZE, listArticles } from '../services/articles';
import { getPlaces } from '../services/catalog';
import { locationText } from './order/articles-card';
import { ArticleStatusBadge, Select } from './parts';

export async function ArticlesPage({ ctx, searchParams, basePath }: PortalPageProps) {
  const status =
    searchParams.status === 'none'
      ? 'none'
      : (ARTICLE_STATUSES.find((s) => s.key === searchParams.status)?.key as
          ArticleStatus | undefined);
  const parsedPage = Number.parseInt(searchParams.page ?? '1', 10);
  const [{ rows, total, page }, places] = await Promise.all([
    listArticles(ctx, {
      status,
      warehouseId: searchParams.warehouse || undefined,
      q: searchParams.q || undefined,
      page: Number.isInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 10_000) : 1,
    }),
    can(ctx, P.catalogRead) ? getPlaces(ctx) : null,
  ]);
  const base = `${basePath}/articles`;
  const hrefFor = (target: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams))
      if (value && key !== 'page') query.set(key, value);
    if (target > 1) query.set('page', String(target));
    const text = query.toString();
    return text ? `${base}?${text}` : base;
  };

  return (
    <>
      <PageHeader
        title="Articles"
        description="Every box and item BRSS is handling or has handled. Open one to change its status or location."
      />
      <Card flush>
        <form
          method="get"
          action={base}
          className="grid grid-cols-2 items-end gap-3 border-b border-zinc-200 p-3 md:grid-cols-5"
        >
          <Field label="Search" htmlFor="a-q" className="col-span-2">
            <input
              id="a-q"
              name="q"
              type="search"
              defaultValue={searchParams.q}
              placeholder="Article number, description, customer"
              className={inputClass}
            />
          </Field>
          <Field label="Status" htmlFor="a-status">
            <Select id="a-status" name="status" defaultValue={status ?? ''}>
              <option value="">Any</option>
              <option value="none">No status yet</option>
              {ARTICLE_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          {places ? (
            <Field label="Warehouse" htmlFor="a-warehouse">
              <Select id="a-warehouse" name="warehouse" defaultValue={searchParams.warehouse ?? ''}>
                <option value="">Any</option>
                {places.warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div className="flex gap-2">
            <button type="submit" className={buttonClass({ variant: 'primary' })}>
              Show
            </button>
            <Link href={base} className={buttonClass()}>
              Clear
            </Link>
          </div>
        </form>
        {rows.length === 0 ? (
          <EmptyState title="No articles match" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Article</Th>
                <Th>Customer</Th>
                <Th>Kind</Th>
                <Th className="w-full">Description</Th>
                <Th className="text-right">Billable</Th>
                <Th>Status</Th>
                <Th>Location</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((article) => (
                <tr key={article.id}>
                  <Td className="font-medium whitespace-nowrap">
                    <Link
                      href={`${base}/${article.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {article.articleNumber}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">{article.customerName}</Td>
                  <Td className="whitespace-nowrap">{labelOf(ARTICLE_TYPES, article.type)}</Td>
                  <Td>{article.description ?? '—'}</Td>
                  <Td className="text-right whitespace-nowrap tabular-nums">
                    {article.billableWeightLb > 0 ? `${article.billableWeightLb} lb` : '—'}
                  </Td>
                  <Td>
                    <ArticleStatusBadge status={article.status} />
                  </Td>
                  <Td className="whitespace-nowrap">
                    {locationText(article, article.warehouseName)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={ARTICLES_PAGE_SIZE} total={total} hrefFor={hrefFor} />
      </Card>
    </>
  );
}
