import type { Metadata } from 'next';
import { listMembers } from '@/core/people/memberships';
import { grantableActions } from '@/core/rbac/permissions';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/core/rbac/roles';
import { ActionForm } from '@/ui/action-form';
import { Badge } from '@/ui/badge';
import { ConfirmButton } from '@/ui/confirm-button';
import { Card, EmptyState, Field, PageHeader, inputClass } from '@/ui/layout';
import { guarded, requireBusinessContext } from '../../../_lib/session';
import {
  addMemberAction,
  changeMemberRoleAction,
  removeMemberAction,
  setMemberPermissionsAction,
} from './actions';

export const metadata: Metadata = { title: 'People and access' };

export default async function PeoplePage({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
  const ctx = await requireBusinessContext(business);
  const members = await guarded(() => listMembers(ctx));
  const canManage = ctx.permissions.has('business.people.manage');
  const grantable = grantableActions(ctx.business.moduleKey);
  const active = members.filter((m) => m.isActive);
  const removed = members.filter((m) => !m.isActive);
  const slug = ctx.business.slug;

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 lg:px-6">
      <PageHeader
        title="People and access"
        description={`Who can use ${ctx.business.name} and what they can do. People with a platform role (super admin, tech team, executive) have access to every business and are not listed here.`}
      />

      <Card title={`Members (${active.length})`} flush>
        {active.length === 0 ? (
          <EmptyState title="Nobody has been given access yet" />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {active.map((m) => (
              <li key={m.membershipId} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-zinc-900">{m.name}</div>
                    <div className="truncate text-xs text-zinc-500">{m.email}</div>
                  </div>
                  <Badge tone={m.role === 'business_admin' ? 'blue' : 'neutral'}>
                    {ROLE_LABELS[m.role]}
                  </Badge>
                  {canManage ? (
                    <span className="flex gap-1.5">
                      <ConfirmButton
                        action={changeMemberRoleAction.bind(
                          null,
                          slug,
                          m.membershipId,
                          m.role === 'business_admin' ? 'business_staff' : 'business_admin',
                        )}
                        confirmTitle={
                          m.role === 'business_admin'
                            ? `Make ${m.name} staff?`
                            : `Make ${m.name} an admin?`
                        }
                        confirmBody={
                          m.role === 'business_admin'
                            ? ROLE_DESCRIPTIONS.business_staff
                            : ROLE_DESCRIPTIONS.business_admin
                        }
                        confirmLabel="Change role"
                      >
                        {m.role === 'business_admin' ? 'Make staff' : 'Make admin'}
                      </ConfirmButton>
                      <ConfirmButton
                        action={removeMemberAction.bind(null, slug, m.membershipId)}
                        variant="danger"
                        confirmTitle={`Remove ${m.name}?`}
                        confirmBody={`They will lose access to ${ctx.business.name} straight away. Their account and history are kept, and you can add them again later.`}
                        confirmLabel="Remove access"
                      >
                        Remove
                      </ConfirmButton>
                    </span>
                  ) : null}
                </div>

                {m.role === 'business_staff' ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-900">
                      Permissions: {m.grants.length} of {grantable.length} switched on
                    </summary>
                    {canManage ? (
                      <ActionForm
                        action={setMemberPermissionsAction.bind(null, slug, m.membershipId)}
                        submitLabel="Save permissions"
                        submitVariant="secondary"
                        resetOnSuccess={false}
                        className="mt-2"
                      >
                        <fieldset className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                          <legend className="sr-only">Permissions for {m.name}</legend>
                          {grantable.map((a) => (
                            <label
                              key={a.key}
                              className="flex items-start gap-2 text-sm text-zinc-800"
                            >
                              <input
                                type="checkbox"
                                name="permission"
                                value={a.key}
                                defaultChecked={m.grants.includes(a.key)}
                                className="mt-0.5 size-4 rounded border-zinc-300"
                              />
                              <span>{a.label}</span>
                            </label>
                          ))}
                        </fieldset>
                      </ActionForm>
                    ) : (
                      <ul className="mt-2 list-disc pl-5 text-sm text-zinc-700">
                        {grantable
                          .filter((a) => m.grants.includes(a.key))
                          .map((a) => (
                            <li key={a.key}>{a.label}</li>
                          ))}
                      </ul>
                    )}
                  </details>
                ) : (
                  <p className="mt-1 text-xs text-zinc-500">
                    Admins hold every day-to-day permission of this business.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canManage ? (
        <Card
          title="Add a person"
          description="If they do not have an account yet, one is created for them."
        >
          <ActionForm action={addMemberAction.bind(null, slug)} submitLabel="Add person">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Full name" htmlFor="name">
                <input id="name" name="name" required className={inputClass} />
              </Field>
              <Field label="Email" htmlFor="email">
                <input id="email" name="email" type="email" required className={inputClass} />
              </Field>
              <Field label="Role" htmlFor="role">
                <select id="role" name="role" defaultValue="business_staff" className={inputClass}>
                  <option value="business_staff">{ROLE_LABELS.business_staff}</option>
                  <option value="business_admin">{ROLE_LABELS.business_admin}</option>
                </select>
              </Field>
            </div>
          </ActionForm>
        </Card>
      ) : null}

      {removed.length > 0 ? (
        <Card
          title={`Removed (${removed.length})`}
          description="No longer have access. Add them again above to restore it."
        >
          <ul className="space-y-1 text-sm text-zinc-600">
            {removed.map((m) => (
              <li key={m.membershipId}>
                {m.name} <span className="text-zinc-400">· {m.email}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
