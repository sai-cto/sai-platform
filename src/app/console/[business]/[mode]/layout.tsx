import { FlaskConical } from 'lucide-react';
import type { ReactNode } from 'react';
import { parseMode, requireBusinessContext } from '@/server/session';

/**
 * Frame for pages that show live OR sandbox data. In test mode it adds the indicator that
 * must never be missing: a striped banner and a coloured frame around the whole page.
 */
export default async function ModeLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ business: string; mode: string }>;
}) {
  const { business, mode: rawMode } = await params;
  const mode = parseMode(rawMode);
  const ctx = await requireBusinessContext(business, mode);
  if (mode === 'live') return <div className="mx-auto max-w-6xl px-4 py-5 lg:px-6">{children}</div>;
  return (
    <div
      data-testid="sandbox-frame"
      className="min-h-[calc(100vh-10rem)] border-x-4 border-b-4 border-amber-400"
    >
      <div
        role="status"
        data-testid="sandbox-banner"
        className="sticky top-12 z-20 flex items-center justify-center gap-2 border-y border-amber-500 px-3 py-1.5 text-center text-xs font-semibold text-amber-950 lg:top-0"
        style={{
          backgroundImage: 'repeating-linear-gradient(135deg, #fcd34d 0 12px, #fde68a 12px 24px)',
        }}
      >
        <FlaskConical className="size-3.5 shrink-0" aria-hidden="true" />
        <span>
          TEST MODE — {ctx.business.name} sandbox. Fake data only; nothing here affects the real
          business.
        </span>
      </div>
      <div className="mx-auto max-w-6xl px-4 py-5 lg:px-6">{children}</div>
    </div>
  );
}
