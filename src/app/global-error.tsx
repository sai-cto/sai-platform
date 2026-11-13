'use client';

import './globals.css';
import { ErrorScreen } from '@/ui/error-screen';

/** When even the outer layout fails. Must render its own document. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-full font-sans">
        <title>Something went wrong</title>
        <ErrorScreen error={error} retry={retry} />
      </body>
    </html>
  );
}
