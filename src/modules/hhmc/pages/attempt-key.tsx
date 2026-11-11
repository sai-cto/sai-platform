'use client';

/**
 * A hidden "attemptKey" field that gets a new value every time its form is submitted.
 * Pressing Pay twice in one submit cannot charge twice (the button is disabled while the
 * server works, and the server locks), and a retry after a declined card is a NEW attempt
 * instead of returning the declined one again (review round 1).
 */
import { useEffect, useRef } from 'react';

export function AttemptKey() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = ref.current;
    const form = input?.form;
    if (!input || !form) return;
    const renew = () => {
      input.value = crypto.randomUUID();
    };
    renew();
    // A native listener on the form runs before React's (delegated) submit handler reads the form.
    form.addEventListener('submit', renew);
    return () => form.removeEventListener('submit', renew);
  }, []);
  return <input ref={ref} type="hidden" name="attemptKey" defaultValue="" />;
}
