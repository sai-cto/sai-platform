import type { Metadata } from 'next';
import Link from 'next/link';
import { listImportJobs } from '@/core/imports/imports';
import { Badge } from '@/ui/badge';
import { buttonClass } from '@/ui/button';
import { formatDateTime, formatNumber } from '@/ui/format';
import { Card, EmptyState, PageHeader, Table, Td, Th } from '@/ui/layout';
import { guarded, requirePlatformContext } from '../../../_lib/session';
import { IMPORT_STATUS } from './_lib/status';

export const metadata: Metadata = { title: 'Data imports' };

export default async function ImportsPage() {
  const ctx = await requirePlatformContext();
  const jobs = await guarded(() => listImportJobs(ctx));
  const canRun = ctx.permissions.has('platform.imports.run');
  return (
    <>
      <PageHeader
        title="Data imports"
        description="Bring records in from a spreadsheet. A file is always imported into a business's sandbox first; only after checking it there can the same file be imported into live."
        actions={
          canRun ? (
            <Link
              href="/console/platform/imports/new"
              className={buttonClass({ variant: 'primary' })}
            >
              New import
            </Link>
          ) : null
        }
      />
      <Card flush>
        {jobs.length === 0 ? (
          <EmptyState title="No imports yet">
            Start with “New import”. You will need a CSV file whose first line names the columns.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Started</Th>
                <Th>Business</Th>
                <Th>File</Th>
                <Th>Into</Th>
                <Th>Where</Th>
                <Th>Status</Th>
                <Th className="text-right">Rows</Th>
                <Th className="text-right">Errors</Th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const [label, tone] = IMPORT_STATUS[job.status] ?? [job.status, 'neutral'];
                return (
                  <tr key={job.id} className="hover:bg-zinc-50">
                    <Td className="text-xs whitespace-nowrap text-zinc-500">
                      {formatDateTime(job.createdAt)}
                    </Td>
                    <Td>{job.businessCode}</Td>
                    <Td>
                      {job.environment === 'sandbox' ? (
                        <Link
                          href={`/console/platform/imports/${job.businessSlug}/${job.id}`}
                          className="font-medium text-zinc-900 hover:underline"
                        >
                          {job.filename}
                        </Link>
                      ) : (
                        job.filename
                      )}
                    </Td>
                    <Td className="font-mono text-xs">{job.entityKey}</Td>
                    <Td>
                      {job.environment === 'sandbox' ? (
                        <Badge tone="amber">Sandbox</Badge>
                      ) : (
                        <Badge tone="green">Live</Badge>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={tone}>{label}</Badge>
                    </Td>
                    <Td className="text-right tabular-nums">{formatNumber(job.rowCount)}</Td>
                    <Td className="text-right tabular-nums">{formatNumber(job.errorCount)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
