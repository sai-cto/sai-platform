'use client';

import {
  useActionState,
  useEffect,
  useRef,
  useTransition,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Button, type ButtonProps } from './button';
import { cn } from './cn';

/** What every server action returns: did it work, and a message safe to show. */
export type ActionResult = { ok: boolean; message?: string };

type FormAction = (previous: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/**
 * A form wired to a server action. Shows the action's error (or success) message under the
 * fields. After a success the fields are cleared; after an error they are left exactly as
 * the person typed them, so they can correct the one thing that was wrong.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  submitVariant = 'primary',
  className,
  resetOnSuccess = true,
  onSuccess,
}: {
  action: FormAction;
  children: ReactNode;
  submitLabel: string;
  submitVariant?: ButtonProps['variant'];
  className?: string;
  resetOnSuccess?: boolean;
  /** Called after each successful submit (for forms that keep some values in React state). */
  onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  // Kept in a ref so the effect below runs once per result, not every time the parent re-renders.
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  });
  useEffect(() => {
    if (!state?.ok) return;
    if (resetOnSuccess) formRef.current?.reset();
    onSuccessRef.current?.();
  }, [state, resetOnSuccess]);

  // The form is submitted from this handler rather than through the form's "action"
  // attribute, because React empties a form after EVERY action it runs that way, including
  // one the server refused.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form ref={formRef} onSubmit={submit} className={cn('space-y-3', className)}>
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
