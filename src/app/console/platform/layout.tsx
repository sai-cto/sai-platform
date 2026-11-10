import type { ReactNode } from 'react';

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-6xl px-4 py-6 lg:px-6">{children}</div>;
}
