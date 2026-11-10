import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listUsers } from '@/core/people/users';
import { PLATFORM_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/core/rbac/roles';
import { listAccessibleBusinesses } from '@/core/tenancy/context';
import { ActionForm } from '@/ui/action-form';
import { Badge } from '@/ui/badge';
import { ConfirmButton } from '@/ui/confirm-button';
import { formatDateTime } from '@/ui/format';
import { Card, Field, PageHeader, inputClass } from '@/ui/layout';
import { guarded, requirePlatformContext } from '@/server/session';
import { removeMemberAction } from '../../../[business]/people/actions';
import { addMembershipAction, setPlatformRoleAction, setUserActiveAction } from '../actions';

export const metadata: Metadata = { title: 'User' };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePlatformContext();
  const user = (await guarded(() => listUsers(ctx))).find((u) => u.id === id);
  if (!user) notFound();
  const businesses = await listAccessibleBusinesses(ctx.actor.id as string);
  const canManage = ctx.permissions.has('platform.users.manage');
  const canGrant = ctx.permissions.has('platform.roles.grant');
  const canToggle = canManage && (!user.platformRole || canGrant) && user.id !== ctx.actor.id;
  const active = user.memberships.filter((m) => m.isActive);
  const available = businesses.filter((b) => !active.some((m) => m.businessId === b.id));

  return (
    <>
      <PageHeader
        title={user.name}
        description={
          <>
            <Link href="/console/platform/users" className="hover:underline">
              ← Users and roles
            </Link>{' '}
            · {user.email} · last sign-in{' '}
            {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'never'}
          </>
        }
        actions={
          <>
            {user.isActive ? (
              <Badge tone="green">Active</Badge>
            ) : (
              <Badge tone="red">Deactivated</Badge>
            )}
            {canToggle ? (
              <ConfirmButton
                action={setUserActiveAction.bind(null, user.id, !user.isActive)}
                variant={user.isActive ? 'danger' : 'secondary'}
                confirmTitle={
                  user.isActive ? `Deactivate ${user.name}?` : `Reactivate ${user.name}?`
                }
                confirmBody={
                  user.isActive
                    ? 'They are signed out everywhere and cannot sign in again until reactivated. Nothing they did is deleted.'
                    : 'They will be able to sign in again with the roles they had.'
                }
                confirmLabel={user.isActive ? 'Deactivate' : 'Reactivate'}
              >
                {user.isActive ? 'Deactivate' : 'Reactivate'}
              </ConfirmButton>
            ) : null}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Platform role"
          description="Applies to every business. A person has a platform role or business roles, never both."
        >
          {canGrant ? (
            <ActionForm
              action={setPlatformRoleAction.bind(null, user.id)}
              submitLabel="Save platform role"
              resetOnSuccess={false}
            >
              <Field label="Role" htmlFor="platformRole">
                <select
                  id="platformRole"
                  name="platformRole"
                  defaultValue={user.platformRole ?? ''}
                  className={inputClass}
                >
                  <option value="">None (business roles only)</option>
                  {PLATFORM_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </Field>
              <ul className="space-y-1 text-xs text-zinc-500">
                {PLATFORM_ROLES.map((r) => (
                  <li key={r}>
                    <span className="font-medium text-zinc-700">{ROLE_LABELS[r]}:</span>{' '}
                    {ROLE_DESCRIPTIONS[r]}
                  </li>
                ))}
              </ul>
            </ActionForm>
          ) : (
            <p className="text-sm text-zinc-700">
              {user.platformRole ? ROLE_LABELS[user.platformRole] : 'None'}
              <span className="mt-1 block text-xs text-zinc-500">
                Only a super admin can change platform roles.
              </span>
            </p>
          )}
        </Card>

        <Card title="Business roles" flush>
          {user.platformRole ? (
            <p className="p-4 text-sm text-zinc-600">
              Has access to every business through their platform role.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-zinc-100">
                {active.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <Link
                      href={`/console/${businesses.find((b) => b.id === m.businessId)?.slug}/people`}
                      className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                    >
                      {m.businessName}
                    </Link>
                    <Badge tone={m.role === 'business_admin' ? 'blue' : 'neutral'}>
                      {ROLE_LABELS[m.role as 'business_admin' | 'business_staff']}
                    </Badge>
                    {canManage ? (
                      <ConfirmButton
                        action={removeMemberAction.bind(
                          null,
                          businesses.find((b) => b.id === m.businessId)?.slug ?? '',
                          m.id,
                        )}
                        variant="danger"
                        confirmTitle={`Remove ${user.name} from ${m.businessName}?`}
                        confirmBody="They lose access to this business straight away."
                        confirmLabel="Remove access"
                      >
                        Remove
                      </ConfirmButton>
                    ) : null}
                  </li>
                ))}
                {active.length === 0 ? (
                  <li className="px-4 py-3 text-sm text-zinc-500">No business roles yet.</li>
                ) : null}
              </ul>
              {canManage && available.length > 0 ? (
                <div className="border-t border-zinc-200 p-4">
                  <ActionForm
                    action={addMembershipAction.bind(null, user.id)}
                    submitLabel="Add to business"
                    submitVariant="secondary"
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Business" htmlFor="business">
                        <select id="business" name="business" className={inputClass}>
                          {available.map((b) => (
                            <option key={b.id} value={b.slug}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Role" htmlFor="role">
                        <select
                          id="role"
                          name="role"
                          defaultValue="business_staff"
                          className={inputClass}
                        >
                          <option value="business_staff">{ROLE_LABELS.business_staff}</option>
                          <option value="business_admin">{ROLE_LABELS.business_admin}</option>
                        </select>
                      </Field>
                    </div>
                  </ActionForm>
                </div>
              ) : null}
            </>
          )}
        </Card>
      </div>
      <p className="mt-4 text-xs text-zinc-500">
        Staff permissions are set per business, in that business&rsquo;s People and access tab.
      </p>
    </>
  );
}
