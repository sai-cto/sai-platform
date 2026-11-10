import type { Metadata } from 'next';
import { getModuleConfig, type PortalKind } from '@/core/modules/config';
import { getModule } from '@/core/modules/registry';
import { ActionForm } from '@/ui/action-form';
import { Badge } from '@/ui/badge';
import { ConfirmButton } from '@/ui/confirm-button';
import { Card, Field, PageHeader, inputClass } from '@/ui/layout';
import { guarded, requireBusinessContext } from '@/server/session';
import { saveSettingsAction, setPortalAction } from './actions';

export const metadata: Metadata = { title: 'Settings' };

const PORTALS: { kind: PortalKind; label: string; description: string }[] = [
  {
    kind: 'staff',
    label: 'Staff portal',
    description: "The business's working app, shown in the App tab.",
  },
  {
    kind: 'customer',
    label: 'Customer portal',
    description: 'For customers: booking, paying, checking status.',
  },
  { kind: 'field', label: 'Field portal', description: 'For crews on a phone.' },
];

export default async function SettingsPage({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
  const ctx = await requireBusinessContext(business);
  const config = await guarded(() => getModuleConfig(ctx));
  const mod = getModule(config.moduleKey);
  const canWrite = ctx.permissions.has('business.settings.write');
  const slug = ctx.business.slug;

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 lg:px-6">
      <PageHeader
        title="Settings"
        description={
          canWrite
            ? 'Module configuration and portal switches. Every change is logged.'
            : 'You can see these settings. Only the tech team can change them.'
        }
      />

      <Card title="Module">
        {mod ? (
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500">Name</dt>
              <dd className="font-medium">{mod.name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500">Key</dt>
              <dd className="font-mono text-xs">{mod.key}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500">Version</dt>
              <dd className="font-mono text-xs">{mod.version}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500">Status</dt>
              <dd>
                <Badge>{mod.status.replace('_', ' ')}</Badge>
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-zinc-600">
            No module is registered for this business yet (expected key:{' '}
            <span className="font-mono text-xs">{config.moduleKey}</span>).
          </p>
        )}
      </Card>

      <Card
        title="Portals"
        description="A portal can be switched on only once the module has built it."
        flush
      >
        <ul className="divide-y divide-zinc-100">
          {PORTALS.map((p) => {
            const built = Boolean(mod?.portals[p.kind]);
            const on = config.portals[p.kind];
            return (
              <li key={p.kind} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-zinc-900">{p.label}</div>
                  <div className="text-xs text-zinc-500">{p.description}</div>
                </div>
                {!built ? (
                  <Badge>Not built</Badge>
                ) : on ? (
                  <Badge tone="green">On</Badge>
                ) : (
                  <Badge tone="amber">Off</Badge>
                )}
                {canWrite && built ? (
                  <ConfirmButton
                    action={setPortalAction.bind(null, slug, p.kind, !on)}
                    confirmTitle={`Turn the ${p.label.toLowerCase()} ${on ? 'off' : 'on'}?`}
                    confirmBody={
                      on
                        ? 'People will no longer be able to open it until it is switched back on.'
                        : 'People with access will be able to open it straight away.'
                    }
                    confirmLabel={on ? 'Turn off' : 'Turn on'}
                  >
                    {on ? 'Turn off' : 'Turn on'}
                  </ConfirmButton>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="Module settings">
        {mod?.settings && mod.settings.fields.length > 0 ? (
          canWrite ? (
            <ActionForm
              action={saveSettingsAction.bind(null, slug)}
              submitLabel="Save settings"
              resetOnSuccess={false}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {mod.settings.fields.map((f) =>
                  f.type === 'boolean' ? (
                    <label key={f.key} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        name={f.key}
                        defaultChecked={Boolean(config.settings[f.key])}
                        className="mt-0.5 size-4 rounded border-zinc-300"
                      />
                      <span>
                        {f.label}
                        {f.help ? (
                          <span className="block text-xs text-zinc-500">{f.help}</span>
                        ) : null}
                      </span>
                    </label>
                  ) : (
                    <Field key={f.key} label={f.label} htmlFor={f.key} help={f.help}>
                      <input
                        id={f.key}
                        name={f.key}
                        type={f.type === 'number' ? 'number' : 'text'}
                        step="any"
                        defaultValue={String(config.settings[f.key] ?? '')}
                        className={inputClass}
                      />
                    </Field>
                  ),
                )}
              </div>
            </ActionForm>
          ) : (
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              {mod.settings.fields.map((f) => (
                <div key={f.key} className="flex justify-between gap-3">
                  <dt className="text-zinc-500">{f.label}</dt>
                  <dd className="font-medium">{String(config.settings[f.key] ?? '—')}</dd>
                </div>
              ))}
            </dl>
          )
        ) : (
          <p className="text-sm text-zinc-600">This module has no settings yet.</p>
        )}
      </Card>
    </div>
  );
}
