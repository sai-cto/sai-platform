import { ROLE_LABELS } from '@/core/rbac/roles';
import { listAccessibleBusinesses } from '@/core/tenancy/context';
import { logoutAction } from '../_lib/auth-actions';
import { requirePlatformContext } from '../_lib/session';

/** Placeholder home. Phase 2 replaces this with the full console shell. */
export default async function ConsoleHome() {
  const ctx = await requirePlatformContext();
  const businesses = await listAccessibleBusinesses(ctx.actor.id as string);
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-xl font-semibold">SAI Console</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Signed in as{' '}
        <span data-testid="whoami" className="font-medium text-neutral-900">
          {ctx.actor.name}
        </span>
        {ctx.role ? (
          <>
            {' '}
            · <span data-testid="platform-role">{ROLE_LABELS[ctx.role]}</span>
          </>
        ) : null}
      </p>
      <h2 className="mt-6 text-sm font-semibold">Businesses you can open</h2>
      <ul
        data-testid="business-list"
        className="mt-2 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white"
      >
        {businesses.map((b) => (
          <li key={b.id} className="flex items-center justify-between px-4 py-2 text-sm">
            <span>
              <span className="font-mono text-xs text-neutral-500">{b.code}</span> {b.name}
            </span>
            <span className="text-xs text-neutral-500">{ROLE_LABELS[b.role]}</span>
          </li>
        ))}
      </ul>
      <form action={logoutAction} className="mt-6">
        <button
          type="submit"
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
