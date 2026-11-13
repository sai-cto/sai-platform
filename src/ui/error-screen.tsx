'use client';

import Link from 'next/link';
import { buttonClass } from './button';

/**
 * What someone sees when a page fails: plain words, a way to try again, and a reference the
 * tech team can find in System health › Server errors.
 */
export function ErrorScreen({ error, retry, homeHref = '/console' }: { error: unknown; retry: () => void; homeHref?: string }) {
  const digest = typeof error === 'object' && error !== null && 'digest' in error ? String((error as { digest?: unknown }).digest ?? '') : '';
  return (
    <div role="alert" data-testid="error-screen" className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-lg font-semibold text-zinc-900">Something went wrong</h1>
      <p className="mt-1 max-w-sm text-sm text-zinc-600">
        This page could not be shown. It has been reported to the team. Try again; if it keeps happening, use Send feedback and say what you were doing.
      </p>
      {digest ? <p className="mt-2 text-xs text-zinc-500">Reference: <span className="font-mono">{digest}</span></p> : null}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => retry()} className={buttonClass({ variant: 'primary' })}>
          Try again
        </button>
        <Link href={homeHref} className={buttonClass({ variant: 'secondary' })}>
          Back to the start
        </Link>
      </div>
    </div>
  );
}
