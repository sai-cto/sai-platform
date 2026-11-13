'use client';

import { ErrorScreen } from '@/ui/error-screen';

/** Inside the console the sidebar stays; only the page area shows the error. */
export default function ConsoleError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} />;
}
