'use client';

import { AlertDialog } from 'radix-ui';
import { useState, useTransition, type ReactNode } from 'react';
import type { ActionResult } from './action-form';
import { Button, type ButtonProps } from './button';

/**
 * A button that asks "are you sure?" before running a server action. With no confirmTitle it
 * runs straight away. Errors from the action are shown to the person, never swallowed.
 */
export function ConfirmButton({
  action,
  children,
  confirmTitle,
  confirmBody,
  confirmLabel = 'Confirm',
  variant = 'secondary',
  size = 'sm',
  disabled,
  title,
}: {
  action: () => Promise<ActionResult>;
  children: ReactNode;
  confirmTitle?: string;
  confirmBody?: ReactNode;
  confirmLabel?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  disabled?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setError(null);
        setOpen(false);
      } else {
        setError(result.message ?? 'That did not work.');
        setOpen(true);
      }
    });

  if (!confirmTitle) {
    return (
      <span className="inline-flex items-center gap-2">
        <Button
          variant={variant}
          size={size}
          disabled={disabled || pending}
          title={title}
          onClick={run}
        >
          {pending ? 'Working…' : children}
        </Button>
        {error ? (
          <span role="alert" className="text-xs text-red-700">
            {error}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <AlertDialog.Trigger asChild>
        <Button variant={variant} size={size} disabled={disabled} title={title}>
          {children}
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-zinc-950/40" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-200 bg-white p-5 shadow-xl focus:outline-none">
          <AlertDialog.Title className="text-base font-semibold text-zinc-900">
            {confirmTitle}
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="mt-2 text-sm text-zinc-600">{confirmBody ?? 'Please confirm.'}</div>
          </AlertDialog.Description>
          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary" size="md">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <Button
              variant={variant === 'danger' ? 'dangerSolid' : 'primary'}
              size="md"
              disabled={pending}
              onClick={run}
            >
              {pending ? 'Working…' : confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
