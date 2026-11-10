import type { Metadata } from 'next';
import Link from 'next/link';
import { listUsers } from '@/core/people/users';
import { ROLE_LABELS } from '@/core/rbac/roles';
import { ActionForm } from '@/ui/action-form';
import { Badge } from '@/ui/badge';
import { buttonClass } from '@/ui/button';
import { cn } from '@/ui/cn';
import { formatRelative } from '@/ui/format';
import { Card, Field, PageHeader, Table, Td, Th, inputClass } from '@/ui/layout';
import { guarded, requirePlatformContext } from '@/server/session';
import { createUserAction } from './actions';

export const metadata: Metadata = { title: 'Users and roles' };

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await requirePlatformContext();
  const { q } = await searchParams;
  const all = await guarded(() => listUsers(ctx));
  const term = q?.trim().toLowerCase() ?? '';
  const users = term ? all.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(term)) : all;
  const canManage = ctx.permissions.has('platform.users.manage');

  return (
    <>
      <PageHeader
        title="Users and roles"
        description="Everyone with an account, their platform role and the businesses they are assigned to."
      />
      <Card flush>
        <form method="get" className="flex flex-wrap gap-2 border-b border-zinc-200 p-3">
          <label htmlFor="q" className="sr-only">
            Search users
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Search by name or email"
            className={cn(inputClass, 'sm:w-72')}
          />
          <button type="submit" className={buttonClass({ variant: 'primary' })}>
            Search
          </button>
        </form>
        <Table>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th>Platform role</Th>
              <Th className="w-full">Businesses</Th>
              <Th>Last sign-in</Th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-zinc-50">
                <Td>
                  <Link
                    href={`/console/platform/users/${u.id}`}
                    className="font-medium text-zinc-900 hover:underline"
                  >
                    {u.name}
                  </Link>
                  <div className="text-xs text-zinc-500">{u.email}</div>
                </Td>
                <Td className="whitespace-nowrap">
                  {u.platformRole ? (
                    <Badge tone="blue">{ROLE_LABELS[u.platformRole]}</Badge>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                  {!u.isActive ? (
                    <Badge tone="red" className="ml-1">
                      Deactivated
                    </Badge>
                  ) : null}
                </Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {u.platformRole ? (
                      <span className="text-xs text-zinc-500">All businesses</span>
                    ) : null}
                    {u.memberships
                      .filter((m) => m.isActive)
                      .map((m) => (
                        <Badge key={m.id}>
                          {m.businessCode} · {m.role === 'business_admin' ? 'admin' : 'staff'}
                        </Badge>
                      ))}
                    {!u.platformRole && u.memberships.every((m) => !m.isActive) ? (
                      <span className="text-xs text-zinc-400">No access</span>
                    ) : null}
                  </span>
                </Td>
                <Td className="text-xs whitespace-nowrap text-zinc-500">
                  {u.lastLoginAt ? formatRelative(u.lastLoginAt) : 'Never'}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {canManage ? (
        <Card
          title="Create a user"
          description="Creates the account only. Open the person afterwards to give them a role."
          className="mt-5"
        >
          <ActionForm action={createUserAction} submitLabel="Create user">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name" htmlFor="name">
                <input id="name" name="name" required className={inputClass} />
              </Field>
              <Field label="Email" htmlFor="email">
                <input id="email" name="email" type="email" required className={inputClass} />
              </Field>
            </div>
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}
