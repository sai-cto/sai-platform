'use client';

import { useState, type ReactNode } from 'react';

/**
 * A fold-out section ("Change details ›"). `startOpen` decides only how it first appears;
 * after that it stays the way the person left it, so a section does not snap shut (hiding
 * the "Saved" message inside it) when the page refreshes after a save.
 */
export function Disclosure({
  summary,
  children,
  startOpen = false,
}: {
  summary: string;
  children: ReactNode;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group border-t border-zinc-200"
    >
      <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-medium text-zinc-700 select-none hover:text-zinc-900 [&::-webkit-details-marker]:hidden">
        <span className="mr-1.5 inline-block text-zinc-400 transition-transform group-open:rotate-90">
          ›
        </span>
        {summary}
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}
