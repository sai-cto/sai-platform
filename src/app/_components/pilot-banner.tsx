'use client';

/** The pilot bar for staff. Customers opening a link (/l/…) don't see it: it is about our setup. */
import { usePathname } from 'next/navigation';

export function PilotBanner() {
  const pathname = usePathname();
  if (pathname?.startsWith('/l/')) return null;
  return (
    <div
      role="note"
      data-testid="pilot-banner"
      className="sticky top-0 z-[60] bg-sky-700 px-3 py-1 text-center text-xs font-semibold tracking-wide text-white"
    >
      PILOT – not live yet: no email reaches customers and cards can&apos;t be charged. Test mode has practice data.
    </div>
  );
}
