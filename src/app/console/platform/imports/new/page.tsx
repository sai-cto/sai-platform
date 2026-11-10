import type { Metadata } from 'next';
import Link from 'next/link';
import { importableEntities } from '@/core/imports/imports';
import { authorize } from '@/core/rbac/permissions';
import { listAccessibleBusinesses } from '@/core/tenancy/context';
import { ActionForm } from '@/ui/action-form';
import { Card, Field, PageHeader, inputClass } from '@/ui/layout';
import { guarded, requirePlatformContext } from '@/server/session';
import { startImportAction } from '../actions';

export const metadata: Metadata = { title: 'New import' };

export default async function NewImportPage() {
  const ctx = await requirePlatformContext();
  await guarded(async () => authorize(ctx, 'platform.imports.run'));
  const businesses = await listAccessibleBusinesses(ctx.actor.id as string);
  const targets = businesses.flatMap((b) =>
    importableEntities(b.slug).map((e) => ({
      value: `${b.slug}|${e.key}`,
      label: `${b.name} — ${e.labelPlural}`,
      fields: e.import?.fields ?? [],
    })),
  );
  const example = targets[0];

  return (
    <>
      <PageHeader
        title="New import"
        description={
          <Link href="/console/platform/imports" className="hover:underline">
            ← Data imports
          </Link>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="1 · Choose what to import and upload the file" className="lg:col-span-2">
          <ActionForm
            action={startImportAction}
            submitLabel="Upload and continue"
            resetOnSuccess={false}
          >
            <Field label="Import into" htmlFor="target">
              <select id="target" name="target" required className={inputClass}>
                {targets.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="CSV file"
              htmlFor="file"
              help="The first line must name the columns. Up to 2,000 rows and 10 MB."
            >
              <input
                id="file"
                name="file"
                type="file"
                accept=".csv,text/csv"
                required
                className="block w-full text-sm text-zinc-700 file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-zinc-50"
              />
            </Field>
          </ActionForm>
        </Card>
        <Card title="What happens next">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-zinc-700">
            <li>You match the file&rsquo;s columns to our fields.</li>
            <li>Every row is checked. Nothing is saved yet.</li>
            <li>
              You import into the business&rsquo;s <strong>sandbox</strong> and look at the result
              there.
            </li>
            <li>Only then can the same file be imported into live.</li>
          </ol>
          {example ? (
            <p className="mt-3 text-xs text-zinc-500">
              Example: {example.label.split(' — ')[1]} can take{' '}
              {example.fields.map((f) => `${f.label}${f.required ? ' (required)' : ''}`).join(', ')}
              .
            </p>
          ) : null}
        </Card>
      </div>
    </>
  );
}
