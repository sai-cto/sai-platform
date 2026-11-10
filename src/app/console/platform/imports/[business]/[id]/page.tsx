import type { Metadata } from 'next';
import Link from 'next/link';
import { getImportJob, liveImportOf } from '@/core/imports/imports';
import { ActionForm } from '@/ui/action-form';
import { Badge } from '@/ui/badge';
import { buttonClass } from '@/ui/button';
import { ConfirmButton } from '@/ui/confirm-button';
import { formatDateTime, formatNumber, formatValue } from '@/ui/format';
import { Card, Field, PageHeader, Table, Td, Th, inputClass } from '@/ui/layout';
import {
  guarded,
  requireBusinessContext,
  requirePlatformContext,
} from '@/server/session';
import { checkImportAction, importToLiveAction, importToSandboxAction } from '../../actions';
import { IMPORT_STATUS } from '../../_lib/status';

export const metadata: Metadata = { title: 'Import' };

export default async function ImportJobPage({
  params,
}: {
  params: Promise<{ business: string; id: string }>;
}) {
  const { business, id } = await params;
  const platform = await requirePlatformContext();
  const ctx = await requireBusinessContext(business, 'sandbox');
  const { job, entity, headers, preview } = await guarded(() => getImportJob(ctx, id));
  const fields = entity.import?.fields ?? [];
  const [statusLabel, statusTone] = IMPORT_STATUS[job.status] ?? [job.status, 'neutral'];
  const imported = job.status === 'imported';
  const live = imported ? await liveImportOf(ctx, job.fingerprint) : null;
  const canRun = platform.permissions.has('platform.imports.run');
  const canRunLive = platform.permissions.has('platform.imports.run_live');
  const slug = ctx.business.slug;

  return (
    <>
      <PageHeader
        title={job.filename}
        description={
          <>
            <Link href="/console/platform/imports" className="hover:underline">
              ← Data imports
            </Link>{' '}
            · {ctx.business.name} · {entity.labelPlural} · {formatNumber(job.rowCount)} rows
          </>
        }
        actions={<Badge tone={statusTone}>{statusLabel}</Badge>}
      />

      <div className="space-y-5">
        <Card
          title="2 · Match columns"
          description="For each of our fields, pick the column of your file that holds it."
        >
          {imported || !canRun ? (
            <dl className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.key} className="flex justify-between gap-3">
                  <dt className="text-zinc-500">{f.label}</dt>
                  <dd className="font-medium">{job.mapping[f.key] ?? '—'}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <ActionForm
              action={checkImportAction.bind(null, slug, job.id)}
              submitLabel="Save and check every row"
              resetOnSuccess={false}
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {fields.map((f) => (
                  <Field
                    key={f.key}
                    label={`${f.label}${f.required ? ' (required)' : ''}`}
                    htmlFor={`map-${f.key}`}
                  >
                    <select
                      id={`map-${f.key}`}
                      name={`map:${f.key}`}
                      defaultValue={job.mapping[f.key] ?? ''}
                      className={inputClass}
                    >
                      <option value="">— not in the file —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>
            </ActionForm>
          )}
        </Card>

        <Card
          title="3 · Check"
          description="A dry run: every row is validated, nothing is saved."
          flush
        >
          {job.status === 'uploaded' ? (
            <p className="p-4 text-sm text-zinc-600">
              Not checked yet. Save the mapping above to run the check.
            </p>
          ) : job.errorCount > 0 ? (
            <div>
              <p className="border-b border-zinc-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-800">
                {formatNumber(job.errorCount)} of {formatNumber(job.rowCount)} rows have problems
                {job.errors.length < job.errorCount ? ` (first ${job.errors.length} shown)` : ''}.
              </p>
              <Table>
                <thead>
                  <tr>
                    <Th>Line in file</Th>
                    <Th className="w-full">Problem</Th>
                  </tr>
                </thead>
                <tbody>
                  {job.errors.map((e) => (
                    <tr key={`${e.row}-${e.message}`}>
                      <Td className="tabular-nums">{e.row}</Td>
                      <Td>{e.message}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : (
            <div>
              <p className="border-b border-zinc-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800">
                All {formatNumber(job.rowCount)} rows passed. Preview of the first {preview.length}:
              </p>
              <Table>
                <thead>
                  <tr>
                    {fields.map((f) => (
                      <Th key={f.key}>{f.label}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, index) => (
                    <tr key={index}>
                      {fields.map((f) => (
                        <Td key={f.key} className="max-w-56 truncate">
                          {formatValue(row[f.key])}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card>

        <Card title="4 · Import into the sandbox">
          {imported ? (
            <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-700">
              <span>
                {formatNumber(job.importedCount)} {entity.labelPlural.toLowerCase()} imported into
                the {ctx.business.name} sandbox.
              </span>
              <Link href={`/console/${slug}/sandbox/data/${entity.key}`} className={buttonClass()}>
                Look at them in test mode
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-600">
              <span>
                {job.status === 'dry_run_ok'
                  ? 'Ready. All rows are imported, or none.'
                  : 'Available once the check passes.'}
              </span>
              {canRun ? (
                <ConfirmButton
                  action={importToSandboxAction.bind(null, slug, job.id)}
                  size="md"
                  variant="primary"
                  disabled={job.status !== 'dry_run_ok'}
                >
                  Import {formatNumber(job.rowCount)} rows into the sandbox
                </ConfirmButton>
              ) : null}
            </div>
          )}
        </Card>

        <Card
          title="5 · Import into live"
          description="Only after the sandbox import, and only once per file."
        >
          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-600">
            <span>
              {live
                ? `Done: ${formatNumber(live.importedCount)} ${entity.labelPlural.toLowerCase()} were imported into live on ${formatDateTime(live.createdAt)}. A file goes into live once.`
                : imported
                  ? 'Check the sandbox result first. This writes real records.'
                  : 'Available after step 4.'}
            </span>
            {live ? (
              <Link href={`/console/${slug}/live/data/${entity.key}`} className={buttonClass()}>
                Look at them in live
              </Link>
            ) : canRunLive ? (
              <ConfirmButton
                action={importToLiveAction.bind(null, slug, job.id)}
                size="md"
                variant="danger"
                disabled={!imported}
                confirmTitle={`Import ${formatNumber(job.rowCount)} ${entity.labelPlural.toLowerCase()} into LIVE ${ctx.business.name}?`}
                confirmBody="This creates real records in the live business. Every record is logged, and each can be archived afterwards, but there is no single undo."
                confirmLabel="Import into live"
              >
                Import into live
              </ConfirmButton>
            ) : null}
          </div>
        </Card>
      </div>
    </>
  );
}
