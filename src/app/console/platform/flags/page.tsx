import type { Metadata } from 'next';
import { listFlags } from '@/core/flags/flags';
import { getModules } from '@/core/modules/registry';
import { listAccessibleBusinesses } from '@/core/tenancy/context';
import { ActionForm } from '@/ui/action-form';
import { Badge } from '@/ui/badge';
import { ConfirmButton } from '@/ui/confirm-button';
import { Card, EmptyState, Field, PageHeader, Table, Td, Th, inputClass } from '@/ui/layout';
import { guarded, requirePlatformContext } from '../../../_lib/session';
import { saveFlagAction, toggleFlagAction } from './actions';

export const metadata: Metadata = { title: 'Feature flags' };

export default async function FlagsPage() {
  const ctx = await requirePlatformContext();
  const flags = await guarded(() => listFlags(ctx));
  const businesses = await listAccessibleBusinesses(ctx.actor.id as string);
  const canWrite = ctx.permissions.has('platform.flags.write');
  const declared = getModules().flatMap((m) =>
    (m.featureFlags ?? []).map((f) => ({ ...f, module: m.name })),
  );

  return (
    <>
      <PageHeader
        title="Feature flags"
        description="Switch a feature on or off for every business, or override it for one. A business-specific flag wins over the all-businesses one."
      />
      <Card flush>
        {flags.length === 0 ? (
          <EmptyState title="No flags yet">
            A flag appears here the first time it is set.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Flag</Th>
                <Th>Applies to</Th>
                <Th className="w-full">Description</Th>
                <Th>State</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.id}>
                  <Td className="font-mono text-xs whitespace-nowrap">{f.key}</Td>
                  <Td className="whitespace-nowrap">{f.businessCode ?? 'All businesses'}</Td>
                  <Td className="text-zinc-600">{f.description || '—'}</Td>
                  <Td>{f.enabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}</Td>
                  <Td className="text-right">
                    {canWrite ? (
                      <ConfirmButton
                        action={toggleFlagAction.bind(null, f.key, f.businessId, !f.enabled)}
                      >
                        {f.enabled ? 'Turn off' : 'Turn on'}
                      </ConfirmButton>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {canWrite ? (
        <Card title="Set a flag" className="mt-5">
          <ActionForm action={saveFlagAction} submitLabel="Save flag">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Flag key" htmlFor="key" help="Lowercase, e.g. brss.new-intake">
                <input id="key" name="key" required list="declared-flags" className={inputClass} />
                <datalist id="declared-flags">
                  {declared.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.module}: {d.description}
                    </option>
                  ))}
                </datalist>
              </Field>
              <Field label="Applies to" htmlFor="businessId">
                <select id="businessId" name="businessId" className={inputClass}>
                  <option value="">All businesses</option>
                  {businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Description" htmlFor="description" className="lg:col-span-2">
                <input id="description" name="description" className={inputClass} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" className="size-4 rounded border-zinc-300" />{' '}
              Switched on
            </label>
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}
