'use client';

/** "Copy link": asks the server for the customer's estimate link, shows it and copies it. */
import { useState, useTransition } from 'react';
import type { ActionResult } from '@/ui/action-form';
import { Button } from '@/ui/button';

export function CopyLinkButton({ action, label = 'Copy link' }: { action: () => Promise<ActionResult>; label?: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await action();
            if (!result.ok || !result.message) {
              setError(result.message ?? 'Could not make the link.');
              return;
            }
            setError(null);
            setLink(result.message);
            await navigator.clipboard?.writeText(result.message).catch(() => undefined);
          })
        }
      >
        {pending ? 'Working…' : label}
      </Button>
      {link ? (
        <input readOnly value={link} aria-label="Customer link" onFocus={(e) => e.currentTarget.select()} className="h-7 w-56 rounded border border-zinc-300 px-2 text-xs" />
      ) : null}
      {error ? <span role="alert" className="text-xs text-red-700">{error}</span> : null}
    </span>
  );
}
