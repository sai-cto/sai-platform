import type { Metadata } from 'next';
import Link from 'next/link';
import { withScope } from '@/core/db/scope';
import { entitiesFor } from '@/core/modules/registry';
import { formatNumber } from '@/ui/format';
import { Card, EmptyState, PageHeader, Table, Td, Th } from '@/ui/layout';
import { guarded, parseMode, requireBusinessContext } from '@/server/session';

export const metadata: Metadata = { title: 'Data' };

export default async function DataIndexPage({
  params,
}: {
  params: Promise<{ business: string; mode: string }>;
}) {
  const { business, mode } = await params;
  const ctx = await requireBusinessContext(business, parseMode(mode));
  const entities = entitiesFor(ctx.business.moduleKey).filter((e) =>
    ctx.permissions.has(e.readPermission),
  );
  const counts = await guarded(() =>
    withScope(ctx, 'business.data.read', async (s) => {
      const rows = [];
      for (const entity of entities) {
        rows.push({
          entity,
          active: await s.db.$count(entity.table, s.where(entity.table)),
          archived: await s.db.$count(entity.table, s.where(entity.table, 'only')),
        });
      }
      return rows;
    }),
  );
  const base = `/console/${ctx.business.slug}/${ctx.environment}/data`;
  return (
    <>
      <PageHeader
        title="Data"
        description="Every kind of record this business has. Open one to browse, search, export, archive or restore."
      />
      <Card flush>
        {counts.length === 0 ? (
          <EmptyState title="Nothing you can browse">
            Ask a business admin to grant you access to records.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-full">Records</Th>
                <Th className="text-right">Active</Th>
                <Th className="text-right">Archived</Th>
              </tr>
            </thead>
            <tbody>
              {counts.map(({ entity, active, archived }) => (
                <tr key={entity.key} className="hover:bg-zinc-50">
                  <Td>
                    <Link
                      href={`${base}/${entity.key}`}
                      className="font-medium text-zinc-900 hover:underline"
                    >
                      {entity.labelPlural}
                    </Link>
                    <span className="ml-2 font-mono text-[11px] text-zinc-400">{entity.key}</span>
                  </Td>
                  <Td className="text-right tabular-nums">{formatNumber(active)}</Td>
                  <Td className="text-right tabular-nums">
                    {archived > 0 ? (
                      <Link
                        href={`${base}/${entity.key}?show=archived`}
                        className="hover:underline"
                      >
                        {formatNumber(archived)}
                      </Link>
                    ) : (
                      '0'
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
