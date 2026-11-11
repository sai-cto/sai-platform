'use client';

/**
 * A hidden "attemptKey" field (the payment's idempotency key). It keeps its value while a
 * submit is in flight or re-sent, so a double submit charges once; it gets a new value only
 * once the form has shown a success or a refused card, so a retry after a declined card or a
 * second, separate payment is a NEW attempt (review rounds 1 and 2).
 */
import { useEffect, useRef } from 'react';

export function AttemptKey() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = ref.current;
    const form = input?.form;
    if (!input || !form) return;
    input.value = crypto.randomUUID();
    // ActionForm shows its result inside the form (role "alert" or "status").
    // Renew after a success, or after a card that was refused. Any OTHER error keeps the key:
    // the charge may have gone through before the error, and the same key finds it again.
    const renewAfterResult = () => {
      const done = form.querySelector('[role="status"]');
      const refused = [...form.querySelectorAll('[role="alert"]')].some((el) => /declined|did not go through/i.test(el.textContent ?? ''));
      if (done || refused) input.value = crypto.randomUUID();
    };
    // A native listener on the form runs before React's (delegated) submit handler reads the form.
    form.addEventListener('submit', renewAfterResult);
    return () => form.removeEventListener('submit', renewAfterResult);
  }, []);
  return <input ref={ref} type="hidden" name="attemptKey" defaultValue="" />;
}
