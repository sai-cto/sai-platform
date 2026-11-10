import type { Metadata } from 'next';
import Link from 'next/link';
import { moduleRegistryReport } from '@/core/modules/report';
import { Badge } from '@/ui/badge';
import { Card, PageHeader, Table, Td, Th } from '@/ui/layout';
import { Monogram } from '@/ui/monogram';
import { guarded, requirePlatformContext } from '@/server/session';

export const metadata: Metadata = { title: 'Module registry' };

const STATUS = {
  scaffold: ['Not built yet', 'neutral'],
  in_development: ['In development', 'blue'],
  live: ['Live', 'green'],
} as const;

export default async function ModulesPage() {
  const ctx = await requirePlatformContext();
  const report = await guarded(() => moduleRegistryReport(ctx));
  return (
    <>
      <PageHeader
        title="Module registry"
        description={`What each business runs on. ${report.registered} module${report.registered === 1 ? '' : 's'} registered in the code (src/modules/registry.ts).`}
      />
      {report.problems.length > 0 ? (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <p className="font-medium">
            The registry has {report.problems.length} problem
            {report.problems.length === 1 ? '' : 's'}:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {report.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <Card flush>
        <Table>
          <thead>
            <tr>
              <Th>Business</Th>
              <Th>Module</Th>
              <Th>Version</Th>
              <Th>Status</Th>
              <Th>Staff portal</Th>
              <Th>Customer portal</Th>
              <Th>Field portal</Th>
              <Th className="text-right">Records · Permissions</Th>
            </tr>
          </thead>
          <tbody>
            {report.installed.map((row) => {
              const status = row.manifest ? STATUS[row.manifest.status] : null;
              return (
                <tr key={row.businessId} className="hover:bg-zinc-50">
                  <Td>
                    <Link
                      href={`/console/${row.slug}/settings`}
                      className="flex items-center gap-2 font-medium text-zinc-900 hover:underline"
                    >
                      <Monogram code={row.code} color={row.accentColor} size="sm" />
                      <span className="whitespace-nowrap">{row.businessName}</span>
                    </Link>
                  </Td>
                  <Td>
                    {row.manifest ? (
                      row.manifest.name
                    ) : (
                      <span className="text-zinc-400">Not registered</span>
                    )}{' '}
                    <span className="font-mono text-[11px] text-zinc-400">{row.moduleKey}</span>
                  </Td>
                  <Td className="font-mono text-xs">{row.manifest?.version ?? '—'}</Td>
                  <Td>
                    {status ? (
                      <Badge tone={status[1]}>{status[0]}</Badge>
                    ) : (
                      <Badge tone="amber">Missing</Badge>
                    )}
                  </Td>
                  {(['staff', 'customer', 'field'] as const).map((p) => (
                    <Td key={p}>
                      {!row.portals[p].built ? (
                        <span className="text-xs text-zinc-400">Not built</span>
                      ) : row.portals[p].on ? (
                        <Badge tone="green">On</Badge>
                      ) : (
                        <Badge tone="amber">Off</Badge>
                      )}
                    </Td>
                  ))}
                  <Td className="text-right text-xs tabular-nums text-zinc-600">
                    {row.manifest
                      ? `${row.manifest.entities.length} · ${row.manifest.permissions.length}`
                      : '—'}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
