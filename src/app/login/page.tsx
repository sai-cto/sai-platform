import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { OAUTH_PROVIDERS, isDevLoginEnabled, listDevLoginUsers } from '@/core/auth/login';
import { ROLE_LABELS } from '@/core/rbac/roles';
import { devLoginAction } from '../_lib/auth-actions';
import { currentUserId } from '../_lib/session';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await currentUserId()) redirect('/console');
  const { error } = await searchParams;
  const devUsers = await listDevLoginUsers();
  const providers = OAUTH_PROVIDERS.filter((p) => p.isEnabled());

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6">
        <div className="text-xs font-semibold tracking-widest text-neutral-500 uppercase">
          Student Agencies Inc.
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">SAI Console</h1>
      </div>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          We could not sign you in. Ask the tech team to check that you have an account.
        </p>
      ) : null}

      {providers.length > 0 ? (
        <div className="mb-6 space-y-2">
          {providers.map((p) => (
            <a
              key={p.id}
              href={`/api/auth/${p.id}/start`}
              className="block rounded-md border border-neutral-300 bg-white px-3 py-2 text-center text-sm font-medium hover:bg-neutral-100"
            >
              Sign in with {p.label}
            </a>
          ))}
        </div>
      ) : null}

      {isDevLoginEnabled() ? (
        <section
          aria-labelledby="dev-login"
          className="rounded-lg border border-neutral-200 bg-white"
        >
          <div className="border-b border-neutral-200 px-4 py-3">
            <h2 id="dev-login" className="text-sm font-semibold">
              Dev login
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Local development only. Pick a fake test user to sign in as.
            </p>
          </div>
          <ul className="divide-y divide-neutral-100">
            {devUsers.map((u) => (
              <li key={u.id}>
                <form action={devLoginAction}>
                  <input type="hidden" name="userId" value={u.id} />
                  <button
                    type="submit"
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-neutral-50 focus-visible:bg-neutral-100 focus-visible:outline-none"
                  >
                    <span>
                      <span className="font-medium">{u.name}</span>
                      <span className="block text-xs text-neutral-500">{u.email}</span>
                    </span>
                    <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">
                      {u.platformRole
                        ? ROLE_LABELS[u.platformRole as keyof typeof ROLE_LABELS]
                        : 'Business role'}
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : providers.length === 0 ? (
        <p className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600">
          No sign-in method is configured. See the README (“Signing in”).
        </p>
      ) : null}
    </main>
  );
}
