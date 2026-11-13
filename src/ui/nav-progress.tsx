'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * The loading state for every page: a thin bar at the top from the moment a link is pressed
 * until the next page is on screen. (A route-level loading.js would stream pages and turn a
 * "not found" into a 200 response, which the access tests rely on, so it is done here instead.)
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = search ? `${pathname}?${search}` : pathname;
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  // Pending until the address changes away from where the click happened.
  const pending = pendingFrom !== null && pendingFrom === here;

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const a = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const from = `${window.location.pathname}${window.location.search}`;
      if (`${url.pathname}${url.search}` === from) return;
      setPendingFrom(from);
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="nav-progress"
      data-pending={pending ? 'true' : undefined}
      className={`pointer-events-none fixed inset-x-0 top-0 z-[70] h-0.5 overflow-hidden print:hidden ${pending ? '' : 'invisible'}`}
    >
      <span className="sr-only">{pending ? 'Loading…' : ''}</span>
      <div className="h-full w-1/3 animate-[nav-progress_1s_ease-in-out_infinite] bg-zinc-900" />
    </div>
  );
}
