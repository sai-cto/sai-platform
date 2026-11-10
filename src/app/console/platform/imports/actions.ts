'use server';

import { redirect } from 'next/navigation';
import { ValidationError } from '@/core/errors';
import { MAX_FILE_BYTES } from '@/core/files/files';
import {
  createImportJob,
  dryRunImport,
  runLiveImport,
  runSandboxImport,
} from '@/core/imports/imports';
import { authorize } from '@/core/rbac/permissions';
import type { ActionResult } from '@/ui/action-form';
import { act, text } from '@/server/actions';
import { requireBusinessContext, requirePlatformContext } from '@/server/session';

/** Step 1: upload a CSV for one business and one kind of record. Always starts in the sandbox. */
export async function startImportAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  let target = '';
  const result = await act(async () => {
    authorize(await requirePlatformContext(), 'platform.imports.run');
    const [slug, entityKey] = text(formData, 'target').split('|');
    const file = formData.get('file');
    if (!slug || !entityKey) throw new ValidationError('Choose what to import.');
    if (!(file instanceof File) || file.size === 0) throw new ValidationError('Choose a CSV file.');
    if (file.size > MAX_FILE_BYTES)
      throw new ValidationError('That file is larger than 10 MB. Split it into smaller files.');
    const ctx = await requireBusinessContext(slug, 'sandbox');
    const job = await createImportJob(ctx, {
      entityKey,
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    target = `/console/platform/imports/${slug}/${job.id}`;
  });
  if (result.ok && target) redirect(target);
  return result;
}

/** Steps 2 and 3: save the column mapping and check every row. Nothing is imported. */
export async function checkImportAction(
  slug: string,
  jobId: string,
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return act(async () => {
    authorize(await requirePlatformContext(), 'platform.imports.run');
    const mapping: Record<string, string> = {};
    for (const [name, value] of formData.entries()) {
      if (name.startsWith('map:') && typeof value === 'string' && value !== '')
        mapping[name.slice(4)] = value;
    }
    const job = await dryRunImport(await requireBusinessContext(slug, 'sandbox'), jobId, mapping);
    return job.errorCount === 0
      ? `All ${job.rowCount} rows passed the check.`
      : `${job.errorCount} of ${job.rowCount} rows have problems. Fix the file or the mapping and check again.`;
  });
}

/** Step 4: import into the sandbox. */
export async function importToSandboxAction(slug: string, jobId: string): Promise<ActionResult> {
  return act(async () => {
    authorize(await requirePlatformContext(), 'platform.imports.run');
    await runSandboxImport(await requireBusinessContext(slug, 'sandbox'), jobId);
  });
}

/** Step 5: import the same file into live. Only after the sandbox import, and only once. */
export async function importToLiveAction(slug: string, jobId: string): Promise<ActionResult> {
  return act(async () => {
    const platform = await requirePlatformContext();
    await runLiveImport(platform, await requireBusinessContext(slug, 'live'), jobId);
  });
}
