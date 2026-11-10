'use client';

import { useActionState, useEffect, useRef, type ReactNode } from 'react';
import { Button, type ButtonProps } from './button';
import { cn } from './cn';

/** What every server action returns: did it work, and a message safe to show. */
export type ActionResult = { ok: boolean; message?: string };

type FormAction = (previous: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/**
 * A form wired to a server action. Shows the action's error (or success) message under the
 * fields and clears the fields after a success.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  submitVariant = 'primary',
  className,
  resetOnSuccess = true,
}: {
  action: FormAction;
  children: ReactNode;
  submitLabel: string;
  submitVariant?: ButtonProps['variant'];
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={formRef} action={formAction} className={cn('space-y-3', className)}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={submitVariant} disabled={pending}>
          {pending ? 'Working…' : submitLabel}
        </Button>
        {state?.message ? (
          <p
            role={state.ok ? 'status' : 'alert'}
            className={cn('text-sm', state.ok ? 'text-emerald-700' : 'text-red-700')}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
