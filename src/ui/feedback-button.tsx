'use client';

import { MessageSquarePlus, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useState } from 'react';
import { ActionForm, type ActionResult } from './action-form';

/**
 * "Send feedback", on every page of an app: a short message plus the page it was sent from.
 * The team reads them in Platform › Feedback.
 */
export function FeedbackButton({ action }: { action: (previous: ActionResult | null, form: FormData) => Promise<ActionResult> }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState('');
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setPage(`${window.location.pathname}${window.location.search}`);
        setOpen(next);
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          data-testid="feedback-button"
          className="fixed right-4 bottom-4 z-40 flex min-h-11 items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 shadow-md hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-zinc-900 print:hidden"
        >
          <MessageSquarePlus className="size-4" aria-hidden="true" />
          Send feedback
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-zinc-950/40" />
        <Dialog.Content
          aria-describedby="feedback-help"
          className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-200 bg-white p-5 shadow-xl focus:outline-none"
        >
          <div className="flex items-start justify-between gap-2">
            <Dialog.Title className="text-base font-semibold text-zinc-900">Send feedback</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="-mt-2 -mr-2 flex size-11 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100">
                <X className="size-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <p id="feedback-help" className="mt-1 text-sm text-zinc-600">
            Something confusing, broken or missing? Say what you were doing. The page you are on is sent with it.
          </p>
          <ActionForm action={action} submitLabel="Send">
            <input type="hidden" name="pageUrl" value={page} />
            <label htmlFor="feedback-message" className="sr-only">
              Your feedback
            </label>
            <textarea
              id="feedback-message"
              name="message"
              required
              maxLength={4000}
              rows={5}
              placeholder="e.g. I could not find where to change the move date."
              className="mt-3 w-full rounded-md border border-zinc-300 px-3 py-2 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none sm:text-sm"
            />
          </ActionForm>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
