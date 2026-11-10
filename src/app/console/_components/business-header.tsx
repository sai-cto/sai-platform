'use client';

import { FlaskConical } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/ui/cn';
import { Monogram } from '@/ui/monogram';

export type HeaderTab = { key: string; label: string; usesMode: boolean; shortcut: string };

/**
 * The top of every business page: who the business is, the live / test-mode switch,
 * and the tabs. The tabs passed in are already filtered to what this person may open.
 */
export function BusinessHeader({
  business,
  roleLabel,
  tabs,
  canUseSandbox,
}: {
  business: { slug: string; code: string; name: string; description: string; accentColor: string };
  roleLabel: string;
  tabs: HeaderTab[];
  canUseSandbox: boolean;
}) {
  const pathname = usePathname();
  const [, , , second, third] = pathname.split('/');
  const mode: 'live' | 'sandbox' = second === 'sandbox' ? 'sandbox' : 'live';
  const activeKey = second === 'live' || second === 'sandbox' ? third : second;
  const activeTab = tabs.find((t) => t.key === activeKey);
  const href = (tab: HeaderTab, m: 'live' | 'sandbox') => (tab.usesMode ? `/console/${business.slug}/${m}/${tab.key}` : `/console/${business.slug}/${tab.key}`);
  // Switching mode keeps you on the same tab when that tab has a live and a sandbox version.
  const switchTarget = (m: 'live' | 'sandbox') => {
    const tab = activeTab?.usesMode ? activeTab : (tabs.find((t) => t.usesMode) ?? tabs[0]);
    return tab ? href(tab, m) : `/console/${business.slug}`;
  };

  return (
    <div className="border-b border-zinc-200 bg-white">
      <div className="h-0.5" style={{ backgroundColor: business.accentColor }} aria-hidden="true" />
      <div className="mx-auto max-w-6xl px-4 pt-4 lg:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Monogram code={business.code} color={business.accentColor} size="lg" />
          <div className="min-w-0 flex-1 basis-48">
            <div className="truncate text-base font-semibold tracking-tight text-zinc-900">{business.name}</div>
            <div className="truncate text-xs text-zinc-500">
              <span className="hidden sm:inline">{business.description} · </span>You are: {roleLabel}
            </div>
          </div>
          {canUseSandbox ? (
            <div role="group" aria-label="Data mode" className="flex rounded-md border border-zinc-300 bg-zinc-50 p-0.5 text-xs font-medium">
              <Link
                href={switchTarget('live')}
                aria-current={mode === 'live' ? 'true' : undefined}
                className={cn('rounded px-2.5 py-1 text-zinc-600 hover:text-zinc-900', mode === 'live' && 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200')}
              >
                Live
              </Link>
              <Link
                href={switchTarget('sandbox')}
                aria-current={mode === 'sandbox' ? 'true' : undefined}
                className={cn('flex items-center gap-1 rounded px-2.5 py-1 text-zinc-600 hover:text-zinc-900', mode === 'sandbox' && 'bg-amber-300 text-amber-950 shadow-sm ring-1 ring-amber-400')}
              >
                <FlaskConical className="size-3" aria-hidden="true" />
                Test mode
              </Link>
            </div>
          ) : null}
        </div>

        <nav aria-label={`${business.name} sections`} className="-mb-px mt-3 flex gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const active = tab.key === activeKey;
            return (
              <Link
                key={tab.key}
                href={href(tab, mode)}
                data-business-tab={tab.key}
                data-shortcut={tab.shortcut}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'shrink-0 border-b-2 border-transparent px-2.5 pt-1 pb-2 text-[13px] whitespace-nowrap text-zinc-500 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-zinc-900',
                  active && 'font-medium text-zinc-900',
                )}
                style={active ? { borderBottomColor: business.accentColor } : undefined}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
