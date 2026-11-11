import type { Metadata } from 'next';
import { isDemoMode } from '@/core/demo/demo';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'SAI Console', template: '%s · SAI Console' },
  description: 'Student Agencies Inc. — one platform for every business.',
  // The hosted demo is never indexed by search engines.
  robots: isDemoMode() ? { index: false, follow: false } : undefined,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full font-sans">
        {isDemoMode() ? (
          <div
            role="note"
            data-testid="demo-banner"
            className="sticky top-0 z-[60] bg-amber-400 px-3 py-1 text-center text-xs font-semibold tracking-wide text-amber-950"
          >
            TEST SITE – not real data. Payments are fake and no email is sent.
          </div>
        ) : null}
        {children}
      </body>
    </html>
  );
}
