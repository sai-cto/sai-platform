import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { accessGateEnabled } from '@/core/demo/demo';
import { accessAction } from '@/server/access-actions';

export const metadata: Metadata = { title: 'Test site', robots: { index: false, follow: false } };

/** The hosted demo's shared access password (src/proxy.ts). "Not found" anywhere else. */
export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  if (!accessGateEnabled()) notFound();
  const { error, next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Test site</h1>
      <p className="mt-1 text-sm text-neutral-600">Enter the access password you were given.</p>
      {error ? (
        <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          That password is not right.
        </p>
      ) : null}
      <form action={accessAction} className="mt-4 space-y-3">
        <input type="hidden" name="next" value={next ?? '/'} />
        <label htmlFor="access-password" className="block text-xs font-medium text-neutral-700">
          Access password
        </label>
        <input
          id="access-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-9 w-full rounded-md border border-neutral-300 px-2.5 text-sm"
        />
        <button type="submit" className="h-9 w-full rounded-md bg-neutral-900 text-sm font-medium text-white">
          Continue
        </button>
      </form>
    </main>
  );
}
